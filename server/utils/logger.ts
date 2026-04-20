import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export interface LogEntry {
  time: string;
  stage: string;
  data: any;
  traceId?: string;
}

const LOG_FILE = path.join(process.cwd(), 'data', 'logs.json');
const MAX_LOG_LINES = 500;

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// In-process subscribers for real-time WebSocket streaming
type LogSubscriber = (entry: LogEntry) => void;
const subscribers = new Set<LogSubscriber>();

export function subscribeToLogs(fn: LogSubscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

// SEC-7: Use AsyncLocalStorage so trace IDs are scoped to each async call chain
// and do not bleed between concurrent requests or agent cycles.
interface TraceContext { traceId: string }
const traceStorage = new AsyncLocalStorage<TraceContext>();

export function setTraceId(id: string | undefined) {
  const store = traceStorage.getStore();
  if (store) {
    store.traceId = id ?? '';
  }
  // When called outside an ALS context (e.g. from synchronous setup code) we
  // fall back to the module-level variable so existing call-sites keep working.
  _fallbackTraceId = id;
}

export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId ?? _fallbackTraceId;
}

/** Generate a new random trace ID and activate it. Returns the new ID. */
export function newTraceId(): string {
  const id = randomUUID();
  const store = traceStorage.getStore();
  if (store) {
    store.traceId = id;
  } else {
    _fallbackTraceId = id;
  }
  return id;
}

/**
 * Run a callback inside a fresh trace context.
 * All logEvent() calls within `fn` will automatically use `traceId`.
 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}

/** Module-level fallback for code paths that run outside an ALS context. */
let _fallbackTraceId: string | undefined;

/** Lazy verbosity read so tests can set VERBOSITY_LEVEL before importing this module. */
function getVerbosity(): string {
  return (process.env.VERBOSITY_LEVEL ?? 'normal').toLowerCase();
}

/** Counter for log events — rotation is triggered every 100 writes. */
let _logEventCount = 0;

/** Reset the log-event counter. Exposed for testing purposes only. */
export function _resetLogEventCounter() {
  _logEventCount = 0;
}

export function logEvent(stage: string, data: any, traceId?: string) {
  const verbosity = getVerbosity();
  // In silent mode only critical/error stages are logged to the console
  const isCritical = stage.includes('error') || stage.includes('fail') || stage.includes('blocked') || stage.includes('kill');
  if (verbosity === 'silent' && !isCritical) {
    // Still persist to file and notify subscribers so the audit trail is intact
  } else {
    if (verbosity === 'verbose') {
      console.log(`[${stage.toUpperCase()}]`, JSON.stringify(data));
    } else {
      // normal: log without full data payload to keep stdout readable
      console.log(`[${stage.toUpperCase()}]`, typeof data === 'object' ? JSON.stringify(data) : data);
    }
  }

  const entry: LogEntry = {
    time: new Date().toISOString(),
    stage,
    data,
    traceId: traceId ?? getTraceId(),
  };

  // Notify real-time subscribers before file I/O
  for (const fn of subscribers) {
    try { fn(entry); } catch (e) { console.error('Log subscriber error:', e); }
  }

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write log:', err);
    return;
  }

  // Rotation is expensive (read + rewrite entire file); only run every 100 events.
  // Deferred via setImmediate so it does not block the event loop on the hot
  // logging path — the rotation I/O happens after the current call stack unwinds.
  _logEventCount++;
  if (_logEventCount % 100 === 0) {
    setImmediate(rotateLogs);
  }
}

function rotateLogs() {
  // Async read-then-rewrite so neither the read nor the write stalls the event loop.
  fs.readFile(LOG_FILE, 'utf-8', (readErr, content) => {
    if (readErr) { console.error('Log rotation read failed:', readErr); return; }
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > MAX_LOG_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LOG_LINES).join('\n') + '\n';
      fs.writeFile(LOG_FILE, trimmed, (writeErr) => {
        if (writeErr) console.error('Log rotation write failed:', writeErr);
      });
    }
  });
}

export function getLogs(): LogEntry[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    return content.trim().split('\n').filter(Boolean).map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(Boolean) as LogEntry[];
  } catch (err) {
    return [];
  }
}

export function getLogsByTraceId(traceId: string): LogEntry[] {
  return getLogs().filter(e => e.traceId === traceId);
}
