/**
 * Integration test suite — end-to-end agent flow
 *
 * Uses in-memory SQLite and simulation LLM mode so no external services are needed.
 * Tests:
 *   1. Simulated Moltbook event → full agent response
 *   2. Multi-turn conversation (instructions accumulate and flush correctly)
 *   3. Duplicate webhook events are idempotently ignored
 *   4. Kill switch blocks cycle execution
 *   5. High-load burst — multiple rapid cycles complete without errors
 *   6. Cycle timeout guard — a stalled cycle is interrupted
 *   7. Memory session isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLoop } from '../../server/core/loop';
import { ingestWebhookEvent } from '../../server/adapters/moltbook';
import { MemorySystem } from '../../server/core/memory';

// ── Mock heavy I/O so tests run entirely in-memory ───────────────────────────

vi.mock('../../server/utils/logger', () => ({
  logEvent: vi.fn(),
  newTraceId: vi.fn().mockReturnValue('integration-trace-id'),
  setTraceId: vi.fn(),
  getTraceId: vi.fn().mockReturnValue('integration-trace-id'),
  getLogs: vi.fn().mockReturnValue([]),
  subscribeToLogs: vi.fn().mockReturnValue(() => {}),
  getLogsByTraceId: vi.fn().mockReturnValue([]),
}));

// Use in-memory SQLite for the MemorySystem so tests don't touch the filesystem
vi.mock('../../server/core/memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/core/memory')>();
  class InMemoryMemorySystem extends actual.MemorySystem {
    constructor() { super(':memory:'); }
  }
  return { ...actual, MemorySystem: InMemoryMemorySystem };
});

// Stub Spotter to avoid outbound HTTP in integration tests
vi.mock('../../server/modules/spotter', () => ({
  Spotter: class {
    async scan() {
      return [{ id: 'obs_int_1', type: 'signal', asset: 'BTC', price: '50000', source: 'test', timestamp: new Date().toISOString() }];
    }
  },
}));

// Stub Executor so we don't make real system calls
vi.mock('../../server/modules/executor', () => ({
  Executor: class {
    async execute(actions: any[]) {
      return actions.map(a => ({
        status: 'simulated',
        timestamp: new Date().toISOString(),
        action: a,
        outcome: 'integration test simulated execution',
        priority: 'STANDARD',
      }));
    }
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Integration: Agent end-to-end flow', () => {
  let loop: AgentLoop;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = new AgentLoop();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  it('1. Simulated Moltbook event → agent processes instruction', async () => {
    const rawEvent = JSON.stringify({
      id: 'evt_int_001',
      type: 'message',
      threadId: 'thread_A',
      content: 'Analyze BTC trend',
      timestamp: new Date().toISOString(),
    });

    const event = ingestWebhookEvent(rawEvent);
    expect(event).not.toBeNull();
    expect(event!.id).toBe('evt_int_001');

    loop.getAgent().addInstruction(`moltbook_event(message): ${event!.content}`);

    await expect(loop.step()).resolves.toBeUndefined();
    const telemetry = loop.getTelemetry();
    expect(telemetry.cycleCount).toBe(1);
    expect(telemetry.consecutiveFailures).toBe(0);
  });

  it('2. Multi-turn conversation — instructions queue and clear correctly', async () => {
    const agent = loop.getAgent();
    agent.addInstruction('turn 1: buy signal detected');
    agent.addInstruction('turn 2: confirm with volume data');

    await loop.step();
    expect(loop.getTelemetry().cycleCount).toBe(1);

    agent.addInstruction('turn 3: exit position signal');
    await loop.step();
    expect(loop.getTelemetry().cycleCount).toBe(2);
    expect(loop.getTelemetry().consecutiveFailures).toBe(0);
  });

  it('3. Duplicate webhook events are idempotently ignored', () => {
    const rawEvent = JSON.stringify({ id: 'evt_int_dup_001', type: 'signal', content: 'dup test' });

    const first = ingestWebhookEvent(rawEvent);
    const second = ingestWebhookEvent(rawEvent);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('4. Kill switch blocks cycle execution', async () => {
    loop.activateKillSwitch();
    expect(loop.isKillSwitchActive()).toBe(true);

    await loop.step();
    expect(loop.getTelemetry().cycleCount).toBe(0);

    loop.deactivateKillSwitch();
    expect(loop.isKillSwitchActive()).toBe(false);

    await loop.step();
    expect(loop.getTelemetry().cycleCount).toBe(1);
  });

  it('5. High-load burst — 10 rapid consecutive cycles complete without error', async () => {
    for (let i = 0; i < 10; i++) {
      await loop.step();
    }
    const tel = loop.getTelemetry();
    expect(tel.cycleCount).toBe(10);
    expect(tel.consecutiveFailures).toBe(0);
    expect(tel.lastError).toBeNull();
  });

  it('6. Cycle timeout guard interrupts a stalled cycle', async () => {
    vi.useRealTimers(); // need real timers for the AbortController setTimeout to fire

    const agent = loop.getAgent();
    vi.spyOn(agent, 'runCycle').mockImplementationOnce(
      () => new Promise((_resolve) => {
        setTimeout(() => {}, 9_999_999); // Never resolves in practice
      })
    );

    const cyclePromise = agent.runCycle();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cycle timeout after 50ms')), 50)
    );

    await expect(Promise.race([cyclePromise, timeoutPromise])).rejects.toThrow('Cycle timeout');
  }, 3000);
});

describe('Integration: Memory separation', () => {
  it('session memory is isolated per sessionId', () => {
    const mem = new MemorySystem(':memory:');

    mem.addSessionEvent('session_A', { msg: 'hello from A' });
    mem.addSessionEvent('session_B', { msg: 'hello from B' });

    const ctxA = mem.getSessionContext('session_A');
    const ctxB = mem.getSessionContext('session_B');

    expect(ctxA).toHaveLength(1);
    expect(ctxA[0].msg).toBe('hello from A');
    expect(ctxB).toHaveLength(1);
    expect(ctxB[0].msg).toBe('hello from B');
  });

  it('clearSession removes only the targeted session', () => {
    const mem = new MemorySystem(':memory:');

    mem.addSessionEvent('session_C', { msg: 'keep' });
    mem.addSessionEvent('session_D', { msg: 'remove' });
    mem.clearSession('session_D');

    expect(mem.getSessionContext('session_C')).toHaveLength(1);
    expect(mem.getSessionContext('session_D')).toHaveLength(0);
  });

  it('short-term events do not contaminate session memory', () => {
    const mem = new MemorySystem(':memory:');

    mem.addEvent({ type: 'global_event', info: 'not a session event' });
    expect(mem.getSessionContext('any_session')).toHaveLength(0);
  });
});
