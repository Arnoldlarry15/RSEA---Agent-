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

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const PORT = parseInt(process.env.PORT ?? '3000', 10);

  const isProduction = process.env.NODE_ENV === 'production';

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

  app.use(express.json());

  // SEC-8: Security response headers — applied to every response
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:"
    );
    next();
  });

  // Bearer token middleware for protected endpoints.
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

  // Simple in-memory rate limiter for POST /api/command: max 20 requests per IP per minute
  const commandRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const COMMAND_RATE_LIMIT = 20;
  const COMMAND_RATE_WINDOW_MS = 60_000;

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = commandRateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      commandRateLimitMap.set(ip, { count: 1, resetAt: now + COMMAND_RATE_WINDOW_MS });
      return false;
    }
    if (entry.count >= COMMAND_RATE_LIMIT) return true;
    entry.count++;
    return false;
  }

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
      // SEC-4: Sanitize webhook content — strip privileged command tokens before injecting
      // into the agent instruction queue to prevent prompt-injection attacks.
      const sanitizedContent = event.content
        ? event.content.replace(/override\s+goal\s*:/gi, '[BLOCKED]:')
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
        config: {
          verbosity: VERBOSITY,
          decisionAggressiveness: DECISION_AGGRESSIVENESS,
          confidenceThreshold: CONFIDENCE_THRESHOLD,
          dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
          killSwitch: agentLoop.isKillSwitchActive(),
        },
        nodeEnv: process.env.NODE_ENV || 'development'
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch debug state' });
    }
  });

  app.post('/api/command', requireAuth, (req, res) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded: max 20 requests per minute per IP' });
      }
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
