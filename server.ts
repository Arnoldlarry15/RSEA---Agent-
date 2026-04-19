import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentLoop } from './server/core/loop';
import { getLogs, subscribeToLogs, getLogsByTraceId } from './server/utils/logger';
import { ingestWebhookEvent } from './server/adapters/moltbook';
import { VERBOSITY, DECISION_AGGRESSIVENESS, CONFIDENCE_THRESHOLD } from './server/core/config';

// ── Production startup guard ─────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.API_SECRET) {
  console.error('[FATAL] API_SECRET must be set in production. Exiting.');
  process.exit(1);
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const PORT = parseInt(process.env.PORT ?? '3000', 10);

  console.log(`[INIT] Starting RSEA Server in ${process.env.NODE_ENV || 'development'} mode`);

  app.use(express.json());

  // ── Security response headers ──────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // CSP: allow same-origin scripts/styles (React SPA uses inline styles via Tailwind)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self' ws: wss:; font-src 'self';"
    );
    next();
  });

  // ── Bearer token middleware for protected endpoints ────────────────────────
  // In production API_SECRET must be set; requests are rejected if it is missing.
  const requireAuth = (req: any, res: any, next: any) => {
    const secret = process.env.API_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[AUTH] API_SECRET is not configured — rejecting request');
        return res.status(503).json({ error: 'Server misconfigured: API_SECRET not set' });
      }
      // Development only: allow unauthenticated access when no secret is configured
      return next();
    }
    const authHeader: string = req.headers['authorization'] ?? '';
    const expected = `Bearer ${secret}`;
    const headerBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length !== expectedBuf.length || !timingSafeEqual(headerBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };

  // Log all requests for debugging
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API REQUEST] ${req.method} ${req.url}`);
    }
    next();
  });

  // Initialize Agent
  const agentLoop = new AgentLoop();

  // Moltbook webhook — receives platform events and forwards them to the agent
  app.post('/api/webhooks/moltbook', (req, res) => {
    try {
      const rawBody = JSON.stringify(req.body); // body already parsed by express.json()
      const secretHeader = req.headers['x-moltbook-secret'] as string | undefined;
      const event = ingestWebhookEvent(rawBody, secretHeader);
      if (!event) {
        // Duplicate or invalid — acknowledge silently so the platform stops retrying
        return res.status(200).json({ acknowledged: true, processed: false });
      }
      // Translate the webhook event into an agent instruction.
      // Strip 'override goal:' prefix to prevent external actors from hijacking
      // the agent's primary goal via crafted webhook payloads (prompt injection).
      const sanitizedContent = event.content
        ? event.content.replace(/override\s+goal\s*:/gi, '[goal-override-blocked]:')
        : undefined;
      const instruction = sanitizedContent
        ? `moltbook_event(${event.type}): ${sanitizedContent}`
        : `moltbook_event(${event.type}): ${JSON.stringify(event)}`;
      agentLoop.getAgent().addInstruction(instruction);
      res.status(200).json({ acknowledged: true, processed: true, eventId: event.id });
    } catch (err) {
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Root test route
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  // API Routes
  app.get('/api/status', (req, res) => {
    try {
      res.json({
        status: 'active',
        framework: 'RSEA',
        version: '1.0.0',
        uptime: process.uptime(),
        goals: agentLoop.getAgent().getGoals().getGoals(),
        config: {
          verbosity: VERBOSITY,
          decisionAggressiveness: DECISION_AGGRESSIVENESS,
          confidenceThreshold: CONFIDENCE_THRESHOLD,
          dryRun: (process.env.DRY_RUN ?? '').toLowerCase() === 'true',
          killSwitch: agentLoop.isKillSwitchActive(),
        }
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate status' });
    }
  });

  app.get('/api/health', (req, res) => {
    try {
      const health = agentLoop.getAgent().checkHealth();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (err) {
      res.status(500).json({ status: 'unhealthy', error: 'Internal health check failure' });
    }
  });

  app.get('/api/logs', requireAuth, (req, res) => {
    try {
      const { traceId } = req.query;
      if (traceId && typeof traceId === 'string') {
        const traced = getLogsByTraceId(traceId);
        return res.json(traced);
      }
      const logs = getLogs();
      res.json(logs.reverse().slice(0, 100)); // Last 100 logs
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/memory', requireAuth, (req, res) => {
    try {
      const memory = agentLoop.getAgent().getMemory().getSnapshot();
      res.json(memory);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.get('/api/debug/state', requireAuth, (req, res) => {
    try {
      const agent = agentLoop.getAgent();
      res.json({
        loop: agentLoop.getTelemetry(),
        goals: agent.getGoals().getGoals(),
        memoryStats: {
          shortTermCount: agent.getMemory().getSnapshot().shortTerm.length,
          longTermCount: Object.keys(agent.getMemory().getSnapshot().longTerm).length
        },
        nodeEnv: process.env.NODE_ENV || 'development'
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch debug state' });
    }
  });

  app.post('/api/command', requireAuth, (req, res) => {
    try {
      const { command } = req.body;
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: typeof command !== 'string' ? 'Command must be a string' : 'No command provided' });
      }
      const trimmed = command.trim();
      if (trimmed.length === 0 || trimmed.length > 2000) {
        return res.status(400).json({ error: 'Command must be between 1 and 2000 characters' });
      }
      agentLoop.getAgent().addInstruction(trimmed);
      res.json({ message: 'Instruction queued' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to process command' });
    }
  });

  app.post('/api/control', requireAuth, (req, res) => {
    try {
      const { action, interval } = req.body;
      if (action === 'start') {
        agentLoop.start();
        res.json({ message: 'Agent started' });
      } else if (action === 'stop') {
        agentLoop.stop();
        res.json({ message: 'Agent stopped' });
      } else if (action === 'set_interval') {
        if (interval && typeof interval === 'number') {
          agentLoop.setInterval(interval);
          res.json({ message: `Agent interval set to ${interval}ms` });
        } else {
          res.status(400).json({ error: 'Invalid interval value' });
        }
      } else if (action === 'kill_switch_on') {
        agentLoop.activateKillSwitch();
        res.json({ message: 'Kill switch activated — agent cycles paused' });
      } else if (action === 'kill_switch_off') {
        agentLoop.deactivateKillSwitch();
        res.json({ message: 'Kill switch deactivated — agent cycles resumed' });
      } else {
        res.status(400).json({ error: 'Invalid action' });
      }
    } catch (err) {
      res.status(500).json({ error: 'Control action failed' });
    }
  });

  // ── WebSocket server for real-time log streaming ─────────────────────────
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/logs' });
  wss.on('connection', (ws, request) => {
    // Authenticate WebSocket connections using the same API_SECRET.
    // Clients supply the token via the `?token=` query parameter or
    // an `Authorization: Bearer <secret>` upgrade header.
    const secret = process.env.API_SECRET;
    if (secret) {
      const reqUrl = new URL(request.url ?? '/', 'http://localhost');
      const queryToken = reqUrl.searchParams.get('token') ?? '';
      const authHeader = (request.headers['authorization'] as string) ?? '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const providedToken = queryToken || bearerToken;
      if (providedToken !== secret) {
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
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RSEA Server running at http://localhost:${PORT}`);
    // Start agent after server is successfully listening
    agentLoop.start();
  });

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    console.log(`[SHUTDOWN] ${signal} received — shutting down gracefully…`);
    agentLoop.stop();
    wss.close();
    httpServer.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 10 s if connections are still open
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
