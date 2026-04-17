import fs from 'fs';
import path from 'path';

export interface LogEntry {
  time: string;
  stage: string;
  data: any;
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

export function logEvent(stage: string, data: any) {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    stage,
    data
  };

  console.log(`[${stage.toUpperCase()}]`, JSON.stringify(data));

  // Notify real-time subscribers before file I/O
  for (const fn of subscribers) {
    try { fn(entry); } catch (e) { console.error('Log subscriber error:', e); }
  }

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    rotateLogs();
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

function rotateLogs() {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > MAX_LOG_LINES) {
      const trimmed = lines.slice(lines.length - MAX_LOG_LINES).join('\n') + '\n';
      fs.writeFileSync(LOG_FILE, trimmed);
    }
  } catch (e) {
    console.error('Log rotation failed:', e);
    // Non-critical: rotation failure doesn't stop the agent
  }
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
