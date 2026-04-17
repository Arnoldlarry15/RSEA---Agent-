import fs from 'fs';
import path from 'path';

export interface LogEntry {
  time: string;
  stage: string;
  data: any;
}

const LOG_FILE = path.join(process.cwd(), 'data', 'logs.json');

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function logEvent(stage: string, data: any) {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    stage,
    data
  };

  console.log(`[${stage.toUpperCase()}]`, JSON.stringify(data));

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write log:', err);
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
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}
