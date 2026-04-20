/**
 * Express application factory
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracted from server.ts so the fully-wired HTTP layer can be instantiated
 * in integration tests without pulling in Vite, WebSocket, or process-lifecycle
 * concerns.
 *
 * Fixes applied here:
 *   P0 — express.json() body parser wired before all routes so req.body is
 *        always populated on POST requests.
 *   P2 — Moltbook webhook-secret comparison uses timing-safe equality (done in
 *        server/adapters/moltbook.ts) — see below for auth header comparison.
 *   P3 — Strict-Transport-Security header emitted in production only.
 */

import express, { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getLogs, getLogsByTraceId } from './utils/logger';
import { ingestWebhookEvent } from './adapters/moltbook';
import { VERBOSITY, getDecisionAggressiveness, getConfidenceThreshold } from './core/config';
import { cycleMetrics } from './core/metrics';
import type { AgentLoop } from './core/loop';

export interface CreateAppOptions {
  /** Whether the app is running in production mode. Affects HSTS and auth. */
  isProduction?: boolean;
  /**
   * Value forwarded to Express `trust proxy` setting.
   * Set to 1 (or a CIDR string) when running behind a reverse proxy
   * so `req.ip` reflects the real client address.
   */
  trustProxy?: string | number;
}

/**
 * Builds and returns a fully-configured Express application.
 * Does NOT start listening — the caller is responsible for that.
 *
 * @param agentLoop  The running AgentLoop instance to expose via the API.
 * @param options    Optional production / proxy settings.
 */
export function createApp(agentLoop: AgentLoop, options: CreateAppOptions = {}): express.Application {
  const { isProduction = false, trustProxy } = options;

  const app = express();

  // ── Trust proxy ────────────────────────────────────────────────────────────
  // Set TRUST_PROXY=1 (or a specific IP/CIDR) in production behind a reverse
  // proxy so req.ip reflects the real client address for rate limiting.
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  // ── P0: JSON body parser ───────────────────────────────────────────────────
  // MUST come before all route handlers.  Without this, req.body is undefined
  // on every POST, silently breaking /api/command, /api/control, and
  // /api/webhooks/moltbook (including the injection-sanitisation guard).
  app.use(express.json({ limit: '1mb' }));

  // ── Security response headers ──────────────────────────────────────────────
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // P3: HSTS — only meaningful over TLS; emit in production only so dev
    // localhost HTTP traffic is not affected.
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // CSP: 'unsafe-inline' and 'unsafe-eval' are required because the React SPA
    // uses Tailwind (which generates inline styles) and Vite's dev server uses
    // eval.  A stricter nonce-based CSP would need server-rendered HTML; that
    // refactor is tracked separately.  This still blocks third-party script injection.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self' ws: wss:; font-src 'self';"
    );
    next();
  });

  // ── Bearer-token middleware for protected endpoints ────────────────────────
  // In production API_SECRET must be set; requests are rejected if it is missing.
  const requireAuth = (_req: any, res: any, next: any) => {
    const secret = process.env.API_SECRET;
    if (!secret) {
      if (isProduction) {
        console.error('[AUTH] API_SECRET is not configured — rejecting request');
        return res.status(503).json({ error: 'Server misconfigured: API_SECRET not set' });
      }
      // Development only: allow unauthenticated access when no secret is configured
      return next();
    }
    const authHeader: string = (_req as Request).headers['authorization'] ?? '';
    const expected = `Bearer ${secret}`;
    const headerBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expected);
    if (headerBuf.length !== expectedBuf.length || !timingSafeEqual(headerBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  };

  // ── Request logger ─────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API REQUEST] ${req.method} ${req.url}`);
    }
    next();
  });

  // ── Rate limiter: POST /api/command and POST /api/control ─────────────────
  // Simple in-memory limiter: max 20 requests per IP per minute.
  const commandRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const COMMAND_RATE_LIMIT = 20;
  const COMMAND_RATE_WINDOW_MS = 60_000;

  function getClientIp(req: Request): string {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

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

  // ── Routes ─────────────────────────────────────────────────────────────────

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
      // SEC-4: Sanitize webhook content — strip privileged command tokens before
      // injecting into the agent instruction queue to prevent prompt-injection attacks.
      // Covers common jailbreak / goal-hijack patterns targeting this agent's capabilities.
      const INJECTION_PATTERNS: RegExp[] = [
        /override\s+goal\s*:/gi,
        /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/gi,
        /forget\s+(your\s+)?(previous\s+)?instructions?/gi,
        /new\s+(primary\s+)?goal\s*:/gi,
        /you\s+are\s+now\s+(a|an)\s+/gi,
        /\bsystem\s*:/gi,
        /ALLOW_SELF_MODIFICATION/g,
        /ALLOW_CODE_EVAL/g,
        /DRY_RUN\s*=\s*false/gi,
      ];
      const sanitizedContent = event.content
        ? INJECTION_PATTERNS.reduce(
            (s, re) => s.replace(re, '[BLOCKED]'),
            event.content
          )
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
  app.get('/ping', (_req, res) => {
    res.send('pong');
  });

  app.get('/api/status', (_req, res) => {
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

  app.get('/api/health', (_req, res) => {
    try {
      const health = agentLoop.getAgent().checkHealth();
      res.status(health.status === 'healthy' ? 200 : 503).json(health);
    } catch (err) {
      res.status(500).json({ status: 'unhealthy', error: 'Internal health check failure' });
    }
  });

  /**
   * GET /api/health/live — Kubernetes liveness probe.
   *
   * Returns 200 as long as the process is running and the HTTP server is
   * accepting requests.  A liveness failure causes the orchestrator to restart
   * the container.  This probe intentionally does NOT check DB connectivity —
   * a temporary DB hiccup should not restart the container.
   */
  app.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'alive', uptime: process.uptime() });
  });

  /**
   * GET /api/health/ready — Kubernetes readiness probe.
   *
   * Returns 200 only when all critical subsystems (DB, ideally LLM) are
   * operational.  A readiness failure causes the orchestrator to stop routing
   * traffic to this pod without restarting it.
   */
  app.get('/api/health/ready', (_req, res) => {
    try {
      const health = agentLoop.getAgent().checkHealth();
      if (health.status === 'healthy') {
        res.status(200).json({ status: 'ready', components: health.components });
      } else {
        res.status(503).json({ status: 'not_ready', components: health.components });
      }
    } catch (err) {
      res.status(503).json({ status: 'not_ready', error: 'Health check failed' });
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

  app.get('/api/memory', requireAuth, (_req, res) => {
    try {
      const memory = agentLoop.getAgent().getMemory().getSnapshot();
      res.json(memory);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  app.get('/api/debug/state', requireAuth, (_req, res) => {
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
          decisionAggressiveness: getDecisionAggressiveness(),
          confidenceThreshold: getConfidenceThreshold(),
          dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false',
          killSwitch: agentLoop.isKillSwitchActive(),
        },
        nodeEnv: process.env.NODE_ENV || 'development'
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch debug state' });
    }
  });

  /**
   * GET /api/metrics — Operational observability endpoint.
   *
   * Returns aggregated per-cycle execution metrics:
   *   - overall success rate and score distribution
   *   - risk gate block frequency
   *   - per-tool execution outcomes
   *   - last 10 cycle samples
   *
   * Protected by requireAuth so internal performance data is not public.
   */
  app.get('/api/metrics', requireAuth, (_req, res) => {
    try {
      res.json(cycleMetrics.getSummary());
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch metrics' });
    }
  });

  /**
   * GET /api/metrics/prometheus — Prometheus text format metrics scrape endpoint.
   *
   * Exposes the same data as /api/metrics but in the standard Prometheus
   * exposition format so it can be scraped directly by Prometheus, Grafana
   * Agent, or any OpenMetrics-compatible collector without a custom adapter.
   *
   * Protected by requireAuth so internal performance data is not public.
   */
  app.get('/api/metrics/prometheus', requireAuth, (_req, res) => {
    try {
      const m = cycleMetrics.getSummary();
      const lines: string[] = [];

      const g = (name: string, help: string, type: string, value: number, labels = '') => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(labels ? `${name}{${labels}} ${value}` : `${name} ${value}`);
      };

      g('rsea_cycles_total',         'Total number of agent cycles recorded in the current window', 'gauge',   m.totalCycles);
      g('rsea_evaluations_total',     'Total evaluation records across all recorded cycles',         'gauge',   m.totalEvaluations);
      g('rsea_success_rate_percent',  'Overall evaluation success rate (0–100)',                     'gauge',   m.overallSuccessRate);
      g('rsea_risk_gate_blocks_total','Total PreExecutionRiskGate hard-blocks in the current window','gauge',   m.riskGateBlocks);
      g('rsea_score_avg',             'Average comparator score across recent cycles (0–100)',        'gauge',   m.scoreDistribution.avg);
      g('rsea_score_min',             'Minimum comparator score observed in recent cycles (0–100)',   'gauge',   m.scoreDistribution.min);
      g('rsea_score_max',             'Maximum comparator score observed in recent cycles (0–100)',   'gauge',   m.scoreDistribution.max);
      g('rsea_score_p50',             'Median (p50) comparator score across recent cycles (0–100)',   'gauge',   m.scoreDistribution.p50);

      lines.push('# HELP rsea_tool_successes_total Per-tool success count in the current window');
      lines.push('# TYPE rsea_tool_successes_total gauge');
      for (const [tool, stats] of Object.entries(m.toolOutcomes)) {
        const safe = tool.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`rsea_tool_successes_total{tool="${safe}"} ${stats.success}`);
      }

      lines.push('# HELP rsea_tool_failures_total Per-tool failure count in the current window');
      lines.push('# TYPE rsea_tool_failures_total gauge');
      for (const [tool, stats] of Object.entries(m.toolOutcomes)) {
        const safe = tool.replace(/[^a-zA-Z0-9_]/g, '_');
        lines.push(`rsea_tool_failures_total{tool="${safe}"} ${stats.failure}`);
      }

      lines.push('');
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(lines.join('\n'));
    } catch (err) {
      res.status(500).send('# Error generating metrics\n');
    }
  });

  app.post('/api/command', requireAuth, (req, res) => {
    try {
      const ip = getClientIp(req);
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
      const ip = getClientIp(req);
      if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Rate limit exceeded: max 20 requests per minute per IP' });
      }
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

  return app;
}
