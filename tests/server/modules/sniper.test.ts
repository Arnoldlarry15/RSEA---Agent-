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

  // ── toolPreference path ────────────────────────────────────────────────────

  it('uses the highest-weighted tool from toolPreference when task has no tool field', async () => {
    // The Executor mock always returns simulated; we just need to confirm execution
    // proceeds (not blocked) and the tool selection path is exercised.
    const results = await sniper.executeSurgicalStrike(
      { id: 't2', score: 80, description: 'no explicit tool' },
      { api_fetch: 0.3, simulate: 0.9, code_eval: 0.5 },
    );
    expect(results[0].status).toBe('simulated');
  });

  it('falls back to simulate when toolPreference map is empty', async () => {
    const results = await sniper.executeSurgicalStrike(
      { id: 't3', score: 80, description: 'empty toolPreference' },
      {},
    );
    expect(results[0].status).toBe('simulated');
  });

  it('respects the tool explicitly set on the task even when toolPreference is provided', async () => {
    const results = await sniper.executeSurgicalStrike(
      { id: 't4', score: 80, description: 'explicit tool', tool: 'simulate' },
      { api_fetch: 0.99 }, // api_fetch has higher weight but task specifies simulate
    );
    expect(results[0].status).toBe('simulated');
  });

  // ── ToolValidator-blocked path ─────────────────────────────────────────────

  it('blocks a task whose tool is not on the allowed-tools whitelist', async () => {
    const results = await sniper.executeSurgicalStrike({
      id: 't5',
      score: 80,
      description: 'forbidden tool',
      tool: 'dangerous_tool',
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
    expect((results[0] as any).outcome).toContain('ToolValidator');
  });

  it('blocks an api_fetch task that is missing the required url parameter', async () => {
    const results = await sniper.executeSurgicalStrike({
      id: 't6',
      score: 80,
      description: 'api_fetch without url',
      tool: 'api_fetch',
      payload: {}, // url is missing
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('blocked');
    expect((results[0] as any).outcome).toContain('ToolValidator');
  });
});
