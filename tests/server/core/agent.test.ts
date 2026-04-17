import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../../../server/core/agent';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Module-level fn references so tests can inspect calls without .mock.results on a class
const mockRunCycle = vi.fn().mockResolvedValue({
  observations: [{ type: 'signal' }],
  plan: [{ id: 't1', description: 'task', score: 75 }],
  results: [{ status: 'simulated', outcome: 'ok', priority: 'STANDARD' }],
});
vi.mock('../../../server/modules/controller', () => {
  class Controller {
    runCycle = mockRunCycle;
  }
  return { Controller };
});

const mockAddEvent = vi.fn();
const mockHealthCheck = vi.fn().mockReturnValue(true);
vi.mock('../../../server/core/memory', () => {
  class MemorySystem {
    addEvent = mockAddEvent;
    getSnapshot = vi.fn().mockReturnValue({ shortTerm: [], longTerm: {} });
    healthCheck = mockHealthCheck;
    remember = vi.fn();
    recall = vi.fn();
  }
  return { MemorySystem };
});

const mockOverridePrimaryGoal = vi.fn();
vi.mock('../../../server/core/goals', () => {
  class GoalManager {
    getGoals = vi.fn().mockReturnValue({
      primary: 'Test primary goal',
      subTasks: ['task 1', 'task 2']
    });
    overridePrimaryGoal = mockOverridePrimaryGoal;
    updateSubTasks = vi.fn();
  }
  return { GoalManager };
});

const mockReflect = vi.fn().mockResolvedValue('Test insight');
vi.mock('../../../server/core/reflector', () => {
  class Reflector {
    reflect = mockReflect;
  }
  return { Reflector };
});

vi.mock('../../../server/cognition/llm', () => {
  class LLMInterface {
    healthCheck = vi.fn().mockReturnValue(true);
    analyze = vi.fn();
    complete = vi.fn();
    embed = vi.fn();
    summarizeExperience = vi.fn();
    generateModifiers = vi.fn();
  }
  return { LLMInterface };
});

describe('Agent', () => {
  let agent: Agent;

  beforeEach(() => {
    mockRunCycle.mockClear();
    mockAddEvent.mockClear();
    mockHealthCheck.mockReset().mockReturnValue(true);
    mockOverridePrimaryGoal.mockClear();
    mockReflect.mockClear();
    agent = new Agent();
  });

  describe('runCycle', () => {
    it('returns cycleData from the Controller', async () => {
      const data = await agent.runCycle();
      expect(data).toHaveProperty('observations');
      expect(data).toHaveProperty('plan');
      expect(data).toHaveProperty('results');
    });

    it('records the cycle in memory', async () => {
      await agent.runCycle();
      expect(mockAddEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'orchestrated_cycle' })
      );
    });

    it('runs the reflector after the cycle', async () => {
      await agent.runCycle();
      expect(mockReflect).toHaveBeenCalled();
    });
  });

  describe('addInstruction', () => {
    it('stores the instruction in memory', () => {
      agent.addInstruction('buy BTC now');
      expect(mockAddEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'user_command', data: 'buy BTC now' })
      );
    });

    it('applies an "override goal:" instruction in the next cycle', async () => {
      agent.addInstruction('override goal: new primary goal');
      await agent.runCycle();
      expect(mockOverridePrimaryGoal).toHaveBeenCalledWith('new primary goal');
    });

    it('queues multiple instructions and clears them after the cycle', async () => {
      agent.addInstruction('instr 1');
      agent.addInstruction('instr 2');
      await agent.runCycle();

      const call = mockRunCycle.mock.calls[0];
      expect(call[1]).toContain('instr 1');
      expect(call[1]).toContain('instr 2');

      // Instructions should be cleared — a second cycle gets an empty list
      mockRunCycle.mockClear();
      await agent.runCycle();
      expect(mockRunCycle.mock.calls[0][1]).toHaveLength(0);
    });
  });

  describe('checkHealth', () => {
    it('returns healthy when DB is connected', () => {
      const health = agent.checkHealth();
      expect(health.status).toBe('healthy');
      expect(health.components.database).toBe('connected');
    });

    it('returns unhealthy when DB check fails', () => {
      mockHealthCheck.mockReturnValue(false);
      const health = agent.checkHealth();
      expect(health.status).toBe('unhealthy');
      expect(health.components.database).toBe('disconnected');
    });
  });

  describe('getGoals / getMemory', () => {
    it('getGoals returns the GoalManager', () => {
      const goals = agent.getGoals();
      expect(goals).toBeDefined();
      expect(typeof goals.getGoals).toBe('function');
    });

    it('getMemory returns the MemorySystem', () => {
      const mem = agent.getMemory();
      expect(mem).toBeDefined();
      expect(typeof mem.addEvent).toBe('function');
    });
  });
});


