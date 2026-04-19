import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import the logger statically — it writes to data/logs.json relative to cwd
import { logEvent, getLogs, subscribeToLogs, getLogsByTraceId, setTraceId, newTraceId } from '../../../server/utils/logger';

const LOG_FILE = path.join(process.cwd(), 'data', 'logs.json');

function clearLogFile() {
  if (fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
  }
}

describe('Logger', () => {
  beforeEach(() => {
    clearLogFile();
  });

  afterEach(() => {
    clearLogFile();
    vi.restoreAllMocks();
  });

  it('logEvent writes an entry to the log file', () => {
    logEvent('test_stage', { value: 42 });
    const content = fs.readFileSync(LOG_FILE, 'utf-8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.stage).toBe('test_stage');
    expect(parsed.data).toEqual({ value: 42 });
    expect(typeof parsed.time).toBe('string');
  });

  it('getLogs returns an empty array when the log file is empty', () => {
    clearLogFile();
    const logs = getLogs();
    expect(Array.isArray(logs)).toBe(true);
    expect(logs).toHaveLength(0);
  });

  it('getLogs returns all logged entries', () => {
    logEvent('stage_a', 1);
    logEvent('stage_b', 2);
    const logs = getLogs();
    const stages = logs.map((l: any) => l.stage);
    expect(stages).toContain('stage_a');
    expect(stages).toContain('stage_b');
  });

  it('subscribeToLogs fires the callback when logEvent is called', () => {
    const received: any[] = [];
    const unsubscribe = subscribeToLogs((entry) => received.push(entry));

    logEvent('sub_stage', { ping: true });
    expect(received).toHaveLength(1);
    expect(received[0].stage).toBe('sub_stage');

    unsubscribe();
  });

  it('unsubscribing stops future notifications', () => {
    const received: any[] = [];
    const unsubscribe = subscribeToLogs((entry) => received.push(entry));
    unsubscribe();

    logEvent('after_unsub', {});
    expect(received).toHaveLength(0);
  });

  it('log rotation trims to MAX_LOG_LINES (500)', () => {
    for (let i = 0; i < 510; i++) {
      logEvent(`stage_${i}`, i);
    }
    const logs = getLogs();
    expect(logs.length).toBeLessThanOrEqual(500);
  });

  it('logEvent entry includes a time field with an ISO timestamp', () => {
    logEvent('ts_stage', {});
    const logs = getLogs();
    const last = logs[logs.length - 1];
    expect(() => new Date(last.time)).not.toThrow();
    expect(last.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── getLogsByTraceId ──────────────────────────────────────────────────────

  it('getLogsByTraceId returns only entries matching the given trace ID', () => {
    setTraceId('trace-aaa');
    logEvent('step_a', { x: 1 });
    setTraceId('trace-bbb');
    logEvent('step_b', { x: 2 });
    setTraceId(undefined);

    const aaa = getLogsByTraceId('trace-aaa');
    expect(aaa.length).toBeGreaterThanOrEqual(1);
    expect(aaa.every(e => e.traceId === 'trace-aaa')).toBe(true);
    expect(aaa.some(e => e.stage === 'step_a')).toBe(true);
  });

  it('getLogsByTraceId returns an empty array when no entries match', () => {
    logEvent('no_match_stage', {});
    const result = getLogsByTraceId('trace-nonexistent-xyz');
    expect(result).toEqual([]);
  });

  it('newTraceId generates a UUID and sets the active trace ID', () => {
    const id = newTraceId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    logEvent('trace_check', {});
    const entries = getLogsByTraceId(id);
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});

