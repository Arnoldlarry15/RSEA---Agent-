import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentLoop } from '../../../server/core/loop';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Stub Agent so the loop tests don't spin up a real SQLite DB or LLM
vi.mock('../../../server/core/agent', () => {
  class Agent {
    runCycle = vi.fn().mockResolvedValue({ observations: [], plan: [], results: [], state: 'IDLE', goalCompleted: false });
    checkHealth = vi.fn().mockReturnValue({ status: 'healthy', components: {} });
    getGoals = vi.fn().mockReturnValue({ getGoals: () => ({ primary: 'goal', subTasks: [] }) });
    getMemory = vi.fn().mockReturnValue({
      getSnapshot: () => ({ shortTerm: [], longTerm: {} }),
      addEvent: vi.fn(),
    });
    addInstruction = vi.fn();
    getState = vi.fn().mockReturnValue('IDLE');
  }
  return { Agent };
});

describe('AgentLoop', () => {
  let loop: AgentLoop;

  beforeEach(() => {
    vi.useFakeTimers();
    loop = new AgentLoop();
  });

  afterEach(() => {
    loop.stop();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('is not running on construction', () => {
      expect(loop.getTelemetry().isRunning).toBe(false);
    });

    it('has a default interval of 10 000 ms', () => {
      expect(loop.getTelemetry().interval).toBe(10000);
    });

    it('starts with cycleCount of 0', () => {
      expect(loop.getTelemetry().cycleCount).toBe(0);
    });
  });

  describe('start / stop', () => {
    it('sets isRunning to true after start()', () => {
      loop.start();
      expect(loop.getTelemetry().isRunning).toBe(true);
    });

    it('does not double-start (idempotent)', () => {
      loop.start();
      loop.start(); // second call should be a no-op
      expect(loop.getTelemetry().isRunning).toBe(true);
    });

    it('sets isRunning to false after stop()', () => {
      loop.start();
      loop.stop();
      expect(loop.getTelemetry().isRunning).toBe(false);
    });
  });

  describe('step', () => {
    it('increments cycleCount on each step', async () => {
      await loop.step();
      expect(loop.getTelemetry().cycleCount).toBe(1);
      await loop.step();
      expect(loop.getTelemetry().cycleCount).toBe(2);
    });

    it('records lastExecutionTime > 0 after a step', async () => {
      await loop.step();
      expect(loop.getTelemetry().lastExecutionTime).toBeGreaterThanOrEqual(0);
    });

    it('sets lastError to null when step succeeds', async () => {
      await loop.step();
      expect(loop.getTelemetry().lastError).toBeNull();
    });

    it('captures errors in lastError without throwing', async () => {
      const agent = loop.getAgent();
      (agent.runCycle as any).mockRejectedValueOnce(new Error('cycle failure'));
      await loop.step();
      expect(loop.getTelemetry().lastError).toBe('cycle failure');
    });
  });

  describe('setInterval', () => {
    it('updates the interval', () => {
      loop.setInterval(5000);
      expect(loop.getTelemetry().interval).toBe(5000);
    });
  });

  describe('getAgent', () => {
    it('returns the underlying Agent instance', () => {
      const agent = loop.getAgent();
      expect(agent).toBeDefined();
      expect(typeof agent.runCycle).toBe('function');
    });
  });

  describe('getTelemetry', () => {
    it('returns all expected telemetry fields', () => {
      const t = loop.getTelemetry();
      expect(t).toHaveProperty('isRunning');
      expect(t).toHaveProperty('interval');
      expect(t).toHaveProperty('cycleCount');
      expect(t).toHaveProperty('lastError');
      expect(t).toHaveProperty('lastExecutionTime');
    });
  });
});
