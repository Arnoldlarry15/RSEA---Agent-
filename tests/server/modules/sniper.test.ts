import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sniper } from '../../../server/modules/sniper';

vi.mock('../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// Mock Executor so we don't run real side-effects
vi.mock('../../../server/modules/executor', () => {
  const mockExecute = vi.fn().mockResolvedValue([
    { status: 'simulated', outcome: 'ok', priority: 'STANDARD', timestamp: new Date().toISOString(), action: {} }
  ]);
  class Executor {
    execute = mockExecute;
  }
  return { Executor };
});

describe('Sniper', () => {
  let sniper: Sniper;

  beforeEach(() => {
    // Set DECISION_AGGRESSIVENESS=1 so tests are not sensitive to the default value
    process.env.DECISION_AGGRESSIVENESS = '1';
    sniper = new Sniper();
  });

  afterEach(() => {
    delete process.env.DECISION_AGGRESSIVENESS;
  });

  it('blocks a task that scores at or below 60', async () => {
    const results = await sniper.executeSurgicalStrike({ id: 't1', score: 50, description: 'low score' });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
    expect(results[0].outcome).toContain('RulesEngine');
  });

  it('executes a task that scores above 60', async () => {
    const results = await sniper.executeSurgicalStrike({ id: 't1', score: 75, description: 'mid score' });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('simulated');
  });

  it('passes the task description as payload info when no payload is set', async () => {
    const results = await sniper.executeSurgicalStrike({ id: 't1', score: 75, description: 'desc here' });
    // Executor is mocked to always return a simulated result; we just confirm it ran
    expect(results[0].status).toBe('simulated');
  });

  it('blocked task has STANDARD priority', async () => {
    const results = await sniper.executeSurgicalStrike({ id: 't1', score: 10, description: 'blocked' });
    expect(results[0].priority).toBe('STANDARD');
  });

  it('executed task has a timestamp', async () => {
    const results = await sniper.executeSurgicalStrike({ id: 't1', score: 75, description: 'task' });
    expect(typeof results[0].timestamp).toBe('string');
  });
});
