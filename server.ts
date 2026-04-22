import 'dotenv/config';
import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentLoop } from './server/core/loop';
import { getLogs, subscribeToLogs } from './server/utils/logger';
import { registerAgent, setMoltbookToken, getHome } from './server/adapters/moltbook';
import { createApp } from './server/app';


async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const PORT = parseInt(process.env.PORT ?? '3000', 10);

  // SEC-5: Fail fast in production when API_SECRET is not set
  if (isProduction && !process.env.API_SECRET) {
    console.error('[FATAL] API_SECRET is required in production. Set the API_SECRET environment variable and restart.');
    process.exit(1);
  }

  // Validate Moltbook API URL if explicitly overridden: the hostname must be
  // exactly www.moltbook.com to avoid the redirect that strips Authorization.
  if (process.env.MOLTBOOK_API_URL) {
    try {
      const overrideHostname = new URL(process.env.MOLTBOOK_API_URL).hostname;
      if (overrideHostname !== 'www.moltbook.com') {
        console.warn(
          `[Moltbook] WARNING: MOLTBOOK_API_URL hostname "${overrideHostname}" is not "www.moltbook.com". ` +
          'The adapter uses the hardcoded base https://www.moltbook.com/api/v1. ' +
          'Requests via moltbook.com (without www) redirect and strip the Authorization header.'
        );
      }
    } catch {
      console.warn('[Moltbook] WARNING: MOLTBOOK_API_URL is not a valid URL — ignored.');
    }
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
    // Register this agent with Moltbook if the API token is configured.
    // Captures the api_key returned by the registration endpoint and stores it
    // for all subsequent requests. Also logs claim_url so the human operator
    // can verify ownership in the Moltbook dashboard.
    if (process.env.MOLTBOOK_API_TOKEN) {
      const agentMeta = {
        name: 'RSEA Agent',
        description: 'RSEA autonomous agent — research, scan, execute, act',
      };
      registerAgent(agentMeta)
        .then((result) => {
          const { api_key, claim_url, verification_code } = result.agent;
          if (api_key) {
            setMoltbookToken(api_key);
            console.log('[Moltbook] Registered. API key captured and stored.');
          }
          if (claim_url) {
            console.log(`[Moltbook] Claim URL (verify ownership): ${claim_url}`);
          }
          if (verification_code) {
            console.log(`[Moltbook] Verification code: ${verification_code}`);
          }
        })
        .catch((err: Error) => {
          console.warn('[Moltbook] Agent registration failed (non-fatal):', err.message);
        });

      // Poll /home on a heartbeat timer instead of waiting for inbound webhooks.
      // Moltbook v1 uses polling — there is no push-webhook mechanism in the spec.
      const rawPollInterval = parseInt(process.env.MOLTBOOK_POLL_INTERVAL_MS ?? '30000', 10);
      const MOLTBOOK_POLL_INTERVAL_MS = rawPollInterval > 0 && Number.isFinite(rawPollInterval)
        ? rawPollInterval
        : 30_000;
      const moltbookPoller = setInterval(() => {
        getHome()
          .then((data) => {
            const instruction = `moltbook_home_update: ${JSON.stringify(data)}`;
            agentLoop.getAgent().addInstruction(instruction);
          })
          .catch((err: Error) => {
            console.warn('[Moltbook] Home poll failed:', err.message);
          });
      }, MOLTBOOK_POLL_INTERVAL_MS);
      // Ensure the polling timer does not prevent graceful shutdown
      moltbookPoller.unref();
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
