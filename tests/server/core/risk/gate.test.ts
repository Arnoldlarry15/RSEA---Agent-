import { describe, it, expect, vi } from 'vitest';
import { PreExecutionRiskGate, HARD_BLOCK_THRESHOLD, REFLECTOR_BANS_KEY } from '../../../../server/core/risk/gate';
import type { MemorySystem } from '../../../../server/core/memory';
import type { StrategyConfig } from '../../../../server/core/strategy/config';

vi.mock('../../../../server/utils/logger', () => ({
  logEvent: vi.fn(),
}));

const defaultStrategy: StrategyConfig = {
  exploration_rate: 0.2,
  risk_tolerance: 0.5,
  tool_preference: {},
};

function makeMemory(opts: {
  recentEvents?: any[];
  bans?: string[];
} = {}): Partial<MemorySystem> {
  return {
    getRecentContext: vi.fn().mockReturnValue(opts.recentEvents ?? []),
    recall: vi.fn().mockImplementation((key: string) => {
      if (key === REFLECTOR_BANS_KEY) return opts.bans ?? [];
      return undefined;
    }),
  };
}

function makeFailures(tool: string, count: number): any[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'evaluation',
    success: false,
    verified: true,
    tool,                         // exact tool field, now used for matching
    actual: `${tool} failed run ${i}`,
    taskId: `t${i}`,
  }));
}

describe('PreExecutionRiskGate', () => {
  it('HARD_BLOCK_THRESHOLD is 75', () => {
    expect(HARD_BLOCK_THRESHOLD).toBe(75);
  });

  it('allows a safe action with no risk signals', () => {
    const gate = new PreExecutionRiskGate();
    const memory = makeMemory();
    const result = gate.assess({ tool: 'simulate', risk: 0 }, memory as any, defaultStrategy);
    expect(result.allowed).toBe(true);
    expect(result.riskScore).toBeLessThanOrEqual(HARD_BLOCK_THRESHOLD);
  });

  it('blocks an action when it is banned AND has recent failures', () => {
    const gate = new PreExecutionRiskGate();
    // banned=40, 3 failures=capped 45, tolerance=10 → total=95 → blocked
    const memory = makeMemory({
      bans: ['simulate'],
      recentEvents: makeFailures('simulate', 3),
    });
    const result = gate.assess({ tool: 'simulate' }, memory as any, defaultStrategy);
    expect(result.allowed).toBe(false);
    expect(result.riskScore).toBeGreaterThan(HARD_BLOCK_THRESHOLD);
    expect(result.factors.some((f: string) => f.includes('tool_banned'))).toBe(true);
    expect(result.factors.some((f: string) => f.includes('recent_failures'))).toBe(true);
  });

  it('elevates risk but does not hard-block a banned tool with no other signals', () => {
    const gate = new PreExecutionRiskGate();
    // banned=40, no failures, tolerance=10 → total=50 → still allowed but elevated
    const memory = makeMemory({ bans: ['simulate'] });
    const result = gate.assess({ tool: 'simulate', risk: 0 }, memory as any, defaultStrategy);
    expect(result.riskScore).toBe(50);
    expect(result.factors.some((f: string) => f.includes('tool_banned'))).toBe(true);
  });

  it('blocks when action risk plus failures pushes score over threshold', () => {
    const gate = new PreExecutionRiskGate();
    // action_risk=100 → 40pts, 3 failures=capped 45, tolerance=10 → total=95 → blocked
    const memory = makeMemory({ recentEvents: makeFailures('api_fetch', 3) });
    const result = gate.assess({ tool: 'api_fetch', risk: 100 }, memory as any, defaultStrategy);
    expect(result.allowed).toBe(false);
    expect(result.riskScore).toBeGreaterThan(HARD_BLOCK_THRESHOLD);
  });

  it('adds failure history penalty for tools that recently failed', () => {
    const gate = new PreExecutionRiskGate();
    const resultNoFailures = gate.assess({ tool: 'api_fetch' }, makeMemory() as any, defaultStrategy);
    const resultWithFailures = gate.assess(
      { tool: 'api_fetch' },
      makeMemory({ recentEvents: makeFailures('api_fetch', 2) }) as any,
      defaultStrategy,
    );
    expect(resultWithFailures.riskScore).toBeGreaterThan(resultNoFailures.riskScore);
    expect(resultWithFailures.factors.some((f: string) => f.includes('recent_failures=2'))).toBe(true);
  });

  it('raises risk when strategy risk_tolerance is low', () => {
    const gate = new PreExecutionRiskGate();
    const memory = makeMemory();
    const highTolerance = gate.assess({ tool: 'simulate' }, memory as any, { ...defaultStrategy, risk_tolerance: 1.0 });
    const lowTolerance = gate.assess({ tool: 'simulate' }, memory as any, { ...defaultStrategy, risk_tolerance: 0.0 });
    expect(lowTolerance.riskScore).toBeGreaterThan(highTolerance.riskScore);
    expect(lowTolerance.factors.some((f: string) => f.includes('risk_tolerance=0.00'))).toBe(true);
  });

  it('returns factors array describing each contributing signal', () => {
    const gate = new PreExecutionRiskGate();
    const result = gate.assess(
      { tool: 'simulate', risk: 50 },
      makeMemory() as any,
      defaultStrategy,
    );
    expect(Array.isArray(result.factors)).toBe(true);
    expect(result.factors.some((f: string) => f.includes('action_risk=50'))).toBe(true);
    expect(result.factors.some((f: string) => f.includes('risk_tolerance'))).toBe(true);
  });

  it('includes a human-readable reason in the assessment', () => {
    const gate = new PreExecutionRiskGate();
    const result = gate.assess({ tool: 'simulate' }, makeMemory() as any, defaultStrategy);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('reason contains BLOCKED when action is not allowed', () => {
    const gate = new PreExecutionRiskGate();
    const memory = makeMemory({
      bans: ['simulate'],
      recentEvents: makeFailures('simulate', 3),
    });
    const result = gate.assess({ tool: 'simulate' }, memory as any, defaultStrategy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('BLOCKED');
  });
});
