import 'dotenv/config';
import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentLoop } from './server/core/loop';
import { getLogs, subscribeToLogs } from './server/utils/logger';
import { registerAgent } from './server/adapters/moltbook';
import { createApp } from './server/app';


async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = parseInt(process.env.PORT ?? '3000', 10);

  // SEC-5: Fail fast in production when API_SECRET is not set
  if (isProduction && !process.env.API_SECRET) {
    console.error('[FATAL] API_SECRET is required in production. Set the API_SECRET environment variable and restart.');
    process.exit(1);
  }

  // SEC-4: Fail fast in production when Moltbook is configured without webhook secret
  if (isProduction && process.env.MOLTBOOK_API_URL && !process.env.MOLTBOOK_WEBHOOK_SECRET) {
    console.error('[FATAL] MOLTBOOK_WEBHOOK_SECRET is required in production when MOLTBOOK_API_URL is set. Incoming Moltbook webhooks cannot be authenticated without it.');
    process.exit(1);
  }

  console.log(`[INIT] Starting RSEA Server in ${process.env.NODE_ENV || 'development'} mode`);

  // Trust the first proxy hop (e.g. nginx / Render / Railway) when explicitly opted in.
  // Set TRUST_PROXY=1 (or a specific IP/CIDR) in production behind a reverse proxy.
  const rawTrustProxy = process.env.TRUST_PROXY;
  const trustProxy = rawTrustProxy
    ? (isNaN(Number(rawTrustProxy)) ? rawTrustProxy : Number(rawTrustProxy))
    : undefined;

  // Initialize Agent and create the fully-configured Express application.
  const agentLoop = new AgentLoop();
  const app = createApp(agentLoop, { isProduction, trustProxy });
  const httpServer = createHttpServer(app);

  // SEC-2: WebSocket server with bearer-token authentication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/logs' });
  wss.on('connection', (ws, req) => {
    // Validate token from ?token=<secret> query parameter or Authorization header
    const secret = process.env.API_SECRET;
    if (secret) {
      const rawUrl = req.url ?? '';
      const qs = new URLSearchParams(rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '');
      const tokenParam = qs.get('token') ?? '';
      const authHeader = (req.headers['authorization'] ?? '') as string;
      const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const candidate = tokenParam || headerToken;
      const secretBuf = Buffer.from(secret);
      const candidateBuf = Buffer.from(candidate);
      const authorized =
        candidateBuf.length === secretBuf.length && timingSafeEqual(candidateBuf, secretBuf);
      if (!authorized) {
        ws.close(1008, 'Unauthorized');
        return;
      }
    }

    // Send the last 100 logs on connect
    const initial = getLogs().slice(-100);
    ws.send(JSON.stringify({ type: 'history', logs: initial }));

    // Subscribe to new log events and push to this client
    const unsubscribe = subscribeToLogs((entry) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'log', entry }));
      }
    });

    ws.on('close', () => unsubscribe());
    ws.on('error', () => unsubscribe());
  });

  // Vite middleware setup
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RSEA Server running at http://localhost:${PORT}`);
    // Start agent after server is successfully listening
    agentLoop.start();
    // Register this agent with Moltbook if the adapter is configured
    if (process.env.MOLTBOOK_API_URL && process.env.MOLTBOOK_API_TOKEN) {
      const agentMeta = {
        name: 'RSEA Agent',
        version: '1.0.0',
        capabilities: ['autonomous_agent', 'market_analysis', 'task_execution', 'webhook_receiver'],
        webhookUrl: process.env.APP_URL ? `${process.env.APP_URL}/api/webhooks/moltbook` : undefined,
      };
      registerAgent(agentMeta).catch((err: Error) => {
        console.warn('[Moltbook] Agent registration failed (non-fatal):', err.message);
      });
    }
  });

  // DEPLOY-4: Graceful shutdown — stop agent loop and drain connections before exiting
  const shutdown = (signal: string) => {
    console.log(`[SHUTDOWN] Received ${signal} — shutting down gracefully`);
    agentLoop.stop();
    wss.close(() => {
      httpServer.close(() => {
        console.log('[SHUTDOWN] Server closed. Exiting.');
        process.exit(0);
      });
    });
    // Force exit after 10 s if clean shutdown stalls
    setTimeout(() => {
      console.error('[SHUTDOWN] Forced exit after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
