/**
 * WebSocket /ws/logs — authentication unit tests
 * ─────────────────────────────────────────────────────────────────────────────
 * Spins up a real HTTP + WebSocket server using the same auth logic as server.ts
 * and verifies the token-validation path end-to-end.
 *
 *   1. No API_SECRET set → any connection is accepted (dev mode)
 *   2. API_SECRET set, no token → connection rejected with close code 1008
 *   3. API_SECRET set, wrong token via ?token= → rejected
 *   4. API_SECRET set, wrong token via Authorization header → rejected
 *   5. API_SECRET set, correct token via ?token= → accepted + deprecation warning
 *   6. API_SECRET set, correct token via Authorization header → accepted, no warning
 *   7. Accepted connection receives a history frame on connect
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { timingSafeEqual } from 'crypto';
import { getLogs, _resetLogBuffer } from '../../server/utils/logger';

vi.mock('../../server/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/logger')>();
  return { ...actual, logEvent: vi.fn() };
});

// ── Minimal WS server matching the server.ts auth logic ──────────────────────

function createTestWss(secret: string | undefined) {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/logs' });

  wss.on('connection', (ws, req) => {
    if (secret) {
      const rawUrl = req.url ?? '';
      const qs = new URLSearchParams(rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '');
      const tokenParam = qs.get('token') ?? '';
      const authHeader = (req.headers['authorization'] ?? '') as string;
      const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const candidate = tokenParam || headerToken;

      if (tokenParam && !headerToken) {
        console.warn('[WS] API secret passed as URL query parameter (?token=). ' +
          'This exposes the secret in access logs. Use the Authorization: Bearer header instead.');
      }

      const secretBuf = Buffer.from(secret);
      const candidateBuf = Buffer.from(candidate);
      const authorized =
        candidateBuf.length === secretBuf.length && timingSafeEqual(candidateBuf, secretBuf);
      if (!authorized) {
        ws.close(1008, 'Unauthorized');
        return;
      }
    }

    ws.send(JSON.stringify({ type: 'history', logs: getLogs().slice(-100) }));
  });

  return { httpServer, wss };
}

/**
 * Connect and collect the first message (or the close event).
 * The client closes immediately after receiving the first message so that
 * accepted connections do not time out.
 */
function connect(url: string, headers?: Record<string, string>): Promise<{ closeCode: number; messages: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    const messages: any[] = [];

    ws.on('message', (data) => {
      try { messages.push(JSON.parse(data.toString())); } catch {}
      // Close after the first message so accepted connections don't hang.
      ws.close();
    });

    ws.on('close', (code) => resolve({ closeCode: code, messages }));
    ws.on('error', () => resolve({ closeCode: -1, messages }));
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebSocket /ws/logs — authentication', () => {
  let httpServer: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(() => {
    _resetLogBuffer();
    delete process.env.API_SECRET;
  });

  afterEach(() => {
    delete process.env.API_SECRET;
  });

  async function startServer(secret: string | undefined) {
    const r = createTestWss(secret);
    httpServer = r.httpServer;
    wss = r.wss;
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', res));
    port = (httpServer.address() as { port: number }).port;
  }

  async function stopServer() {
    await new Promise<void>((res) => wss.close(() => httpServer.close(() => res())));
  }

  it('1. No API_SECRET → any connection is accepted (dev / open mode)', async () => {
    await startServer(undefined);
    try {
      const { closeCode } = await connect(`ws://127.0.0.1:${port}/ws/logs`);
      expect(closeCode).not.toBe(1008);
    } finally {
      await stopServer();
    }
  });

  it('2. API_SECRET set, no credentials → rejected with code 1008', async () => {
    await startServer('test-secret');
    try {
      const { closeCode } = await connect(`ws://127.0.0.1:${port}/ws/logs`);
      expect(closeCode).toBe(1008);
    } finally {
      await stopServer();
    }
  });

  it('3. API_SECRET set, wrong ?token= → rejected with code 1008', async () => {
    await startServer('correct-secret');
    try {
      const { closeCode } = await connect(`ws://127.0.0.1:${port}/ws/logs?token=wrong-secret`);
      expect(closeCode).toBe(1008);
    } finally {
      await stopServer();
    }
  });

  it('4. API_SECRET set, wrong Authorization header → rejected with code 1008', async () => {
    await startServer('correct-secret');
    try {
      const { closeCode } = await connect(`ws://127.0.0.1:${port}/ws/logs`, {
        Authorization: 'Bearer wrong-secret',
      });
      expect(closeCode).toBe(1008);
    } finally {
      await stopServer();
    }
  });

  it('5. Correct ?token= → accepted and deprecation warning emitted', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startServer('correct-secret');
    try {
      const { closeCode, messages } = await connect(
        `ws://127.0.0.1:${port}/ws/logs?token=correct-secret`,
      );
      expect(closeCode).not.toBe(1008);
      expect(messages.some((m) => m.type === 'history')).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('query parameter'));
    } finally {
      warnSpy.mockRestore();
      await stopServer();
    }
  });

  it('6. Correct Authorization header → accepted, no deprecation warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startServer('correct-secret');
    try {
      const { closeCode, messages } = await connect(`ws://127.0.0.1:${port}/ws/logs`, {
        Authorization: 'Bearer correct-secret',
      });
      expect(closeCode).not.toBe(1008);
      expect(messages.some((m) => m.type === 'history')).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await stopServer();
    }
  });

  it('7. Accepted connection receives a history frame on connect', async () => {
    await startServer(undefined);
    try {
      const { messages } = await connect(`ws://127.0.0.1:${port}/ws/logs`);
      const historyMsg = messages.find((m) => m.type === 'history');
      expect(historyMsg).toBeDefined();
      expect(Array.isArray(historyMsg.logs)).toBe(true);
    } finally {
      await stopServer();
    }
  });
});
