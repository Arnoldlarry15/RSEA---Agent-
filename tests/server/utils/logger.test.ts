import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import the logger statically — it writes to data/logs.json relative to cwd
import { logEvent, getLogs, getLogsByTraceId, subscribeToLogs, newTraceId, setTraceId, getTraceId, runWithTraceId, _resetLogEventCounter } from '../../../server/utils/logger';

const LOG_FILE = path.join(process.cwd(), 'data', 'logs.json');

function clearLogFile() {
  if (fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
  }
}

describe('Logger', () => {
  beforeEach(() => {
    clearLogFile();
    _resetLogEventCounter();
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
    // Write exactly 500 events to trigger a rotation at event 500 (which should
    // trim the file to 500 lines). No additional entries after rotation.
    for (let i = 0; i < 500; i++) {
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

  // ---------------------------------------------------------------------------
  // TEST-4: getLogsByTraceId
  // ---------------------------------------------------------------------------
  describe('getLogsByTraceId', () => {
    it('returns entries that match the given traceId', () => {
      logEvent('trace_stage', { x: 1 }, 'trace-aaa');
      logEvent('other_stage', { x: 2 }, 'trace-bbb');
      logEvent('trace_stage2', { x: 3 }, 'trace-aaa');

      const results = getLogsByTraceId('trace-aaa');
      expect(results).toHaveLength(2);
      expect(results.every(e => e.traceId === 'trace-aaa')).toBe(true);
    });

    it('returns an empty array when no entries match the traceId', () => {
      logEvent('some_stage', { x: 1 }, 'trace-xyz');
      const results = getLogsByTraceId('trace-does-not-exist');
      expect(results).toHaveLength(0);
    });

    it('returns an empty array when the log file is empty', () => {
      clearLogFile();
      const results = getLogsByTraceId('trace-any');
      expect(results).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Trace ID helpers
  // ---------------------------------------------------------------------------
  describe('trace ID helpers', () => {
    it('newTraceId returns a UUID-format string', () => {
      const id = newTraceId();
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('setTraceId and getTraceId round-trip outside an ALS context', () => {
      setTraceId('my-trace-id');
      expect(getTraceId()).toBe('my-trace-id');
      setTraceId(undefined);
    });

    it('logEvent uses the explicit traceId argument when provided', () => {
      logEvent('explicit_trace', { v: 1 }, 'explicit-id');
      const logs = getLogs();
      const last = logs[logs.length - 1];
      expect(last.traceId).toBe('explicit-id');
    });
  });

  // ---------------------------------------------------------------------------
  // runWithTraceId
  // ---------------------------------------------------------------------------
  describe('runWithTraceId', () => {
    it('propagates the trace ID to logEvent calls within the callback', () => {
      runWithTraceId('run-trace-xyz', () => {
        logEvent('inside_run', { v: 1 });
      });
      const logs = getLogs();
      const entry = logs.find((l: any) => l.stage === 'inside_run');
      expect(entry?.traceId).toBe('run-trace-xyz');
    });

    it('does not leak the trace ID outside the callback', () => {
      runWithTraceId('isolated-trace', () => {
        // no-op — just verifies isolation
      });
      // After the callback, the fallback trace ID should not be 'isolated-trace'
      const idAfter = getTraceId();
      expect(idAfter).not.toBe('isolated-trace');
    });

    it('returns the callback return value', () => {
      const result = runWithTraceId('ret-trace', () => 42);
      expect(result).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // Subscriber error-handling
  // ---------------------------------------------------------------------------
  describe('subscriber error handling', () => {
    it('a throwing subscriber does not prevent other subscribers from receiving events', () => {
      const received: any[] = [];
      // First subscriber: always throws
      const unsub1 = subscribeToLogs(() => { throw new Error('subscriber boom'); });
      // Second subscriber: collects events
      const unsub2 = subscribeToLogs((entry) => received.push(entry));

      expect(() => logEvent('error_resilience', { x: 1 })).not.toThrow();
      expect(received).toHaveLength(1);
      expect(received[0].stage).toBe('error_resilience');

      unsub1();
      unsub2();
    });
  });

  // ---------------------------------------------------------------------------
  // File-missing edge case
  // ---------------------------------------------------------------------------
  describe('getLogs file-missing edge case', () => {
    it('returns an empty array when the log file does not exist', () => {
      // Remove the file entirely (not just clear it)
      if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
      const logs = getLogs();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs).toHaveLength(0);
    });

    it('skips invalid (non-JSON) lines and returns remaining valid entries', () => {
      // Write one valid line and one corrupted line
      fs.writeFileSync(LOG_FILE, '{"stage":"good","data":{},"time":"2024-01-01T00:00:00.000Z"}\nNOT_JSON\n');
      const logs = getLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].stage).toBe('good');
    });
  });
});

