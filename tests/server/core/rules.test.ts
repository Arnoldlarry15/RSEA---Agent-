import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RulesEngine } from '../../../server/core/rules';

describe('RulesEngine', () => {
  let engine: RulesEngine;

  beforeEach(() => {
    // Set DECISION_AGGRESSIVENESS=1 so tests are not sensitive to the default value
    process.env.DECISION_AGGRESSIVENESS = '1';
    engine = new RulesEngine();
  });

  afterEach(() => {
    delete process.env.DECISION_AGGRESSIVENESS;
    delete process.env.MAX_ACTIONS_PER_CYCLE;
    delete process.env.RISK_THRESHOLD;
    delete process.env.ACTION_TIMEOUT_MS;
    delete process.env.RULE_ALLOWED_TOOLS;
  });

  it('blocks items with score at or below 60', () => {
    const result = engine.apply([{ id: 't1', score: 60, description: 'task' }]);
    expect(result).toHaveLength(0);
  });

  it('blocks items with score below 60', () => {
    const result = engine.apply([{ id: 't1', score: 0.5, description: 'task' }]);
    expect(result).toHaveLength(0);
  });

  it('approves items with score above 60', () => {
    const result = engine.apply([{ id: 't1', score: 75, description: 'task' }]);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('engage');
    expect(result[0].target.id).toBe('t1');
  });

  it('adds a priority_alert action for items scoring above 90', () => {
    const result = engine.apply([{ id: 't1', score: 95, description: 'critical task' }]);
    const actions = result.map(a => a.action);
    expect(actions).toContain('engage');
    expect(actions).toContain('priority_alert');
    expect(result).toHaveLength(2);
  });

  it('does not add priority_alert for items scoring exactly 90', () => {
    const result = engine.apply([{ id: 't1', score: 90, description: 'task' }]);
    const actions = result.map(a => a.action);
    expect(actions).toContain('engage');
    expect(actions).not.toContain('priority_alert');
  });

  it('handles an empty input array', () => {
    expect(engine.apply([])).toEqual([]);
  });

  it('processes multiple items correctly', () => {
    const items = [
      { id: 'blocked', score: 30 },
      { id: 'normal', score: 70 },
      { id: 'critical', score: 92 },
    ];
    const result = engine.apply(items);
    const actions = result.map(a => a.action);
    // blocked item produces nothing; normal → engage; critical → engage + priority_alert
    expect(result.filter(a => a.action === 'engage')).toHaveLength(2);
    expect(result.filter(a => a.action === 'priority_alert')).toHaveLength(1);
    expect(actions).not.toContain(undefined);
  });

  // ---------------------------------------------------------------------------
  // validate() — hard constraint checks
  // ---------------------------------------------------------------------------
  describe('validate()', () => {
    it('allows a valid action with no special constraints set', () => {
      const result = engine.validate({ tool: 'simulate', payload: {} });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('All constraints satisfied');
    });

    it('returns allowed=false and a reason when action is null', () => {
      const result = engine.validate(null);
      // risk/timeout/tool checks pass for null (score defaults to 0), cycle count increments
      expect(result.allowed).toBe(true); // null passes all guards
    });

    // ── max_actions_per_cycle ──────────────────────────────────────────────────
    describe('max_actions_per_cycle', () => {
      it('allows actions up to the configured limit', () => {
        process.env.MAX_ACTIONS_PER_CYCLE = '3';
        engine = new RulesEngine();
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
      });

      it('blocks the action that exceeds the configured limit', () => {
        process.env.MAX_ACTIONS_PER_CYCLE = '2';
        engine = new RulesEngine();
        engine.validate({ tool: 'simulate' }); // 1
        engine.validate({ tool: 'simulate' }); // 2
        const result = engine.validate({ tool: 'simulate' }); // 3 → blocked
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Cycle action limit');
        expect(result.reason).toContain('2');
      });

      it('resets the counter after resetCycle()', () => {
        process.env.MAX_ACTIONS_PER_CYCLE = '1';
        engine = new RulesEngine();
        engine.validate({ tool: 'simulate' }); // uses up the 1 slot
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(false);
        engine.resetCycle();
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
      });
    });

    // ── allowed_tools ──────────────────────────────────────────────────────────
    describe('allowed_tools (RULE_ALLOWED_TOOLS)', () => {
      it('allows any tool when RULE_ALLOWED_TOOLS is not set', () => {
        delete process.env.RULE_ALLOWED_TOOLS;
        expect(engine.validate({ tool: 'some_custom_tool' }).allowed).toBe(true);
      });

      it('allows a tool that is in the RULE_ALLOWED_TOOLS list', () => {
        process.env.RULE_ALLOWED_TOOLS = 'simulate,api_fetch';
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
      });

      it('blocks a tool that is not in the RULE_ALLOWED_TOOLS list', () => {
        process.env.RULE_ALLOWED_TOOLS = 'simulate,api_fetch';
        const result = engine.validate({ tool: 'code_eval' });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('code_eval');
        expect(result.reason).toContain('RULE_ALLOWED_TOOLS');
      });

      it('blocks when RULE_ALLOWED_TOOLS is set but action has no tool', () => {
        process.env.RULE_ALLOWED_TOOLS = 'simulate';
        const result = engine.validate({ payload: {} });
        expect(result.allowed).toBe(false);
      });
    });

    // ── risk_threshold ─────────────────────────────────────────────────────────
    describe('risk_threshold (RISK_THRESHOLD)', () => {
      it('allows an action whose risk score is at or below the threshold', () => {
        process.env.RISK_THRESHOLD = '80';
        expect(engine.validate({ tool: 'simulate', risk: 80 }).allowed).toBe(true);
      });

      it('blocks an action whose risk score exceeds the threshold', () => {
        process.env.RISK_THRESHOLD = '80';
        const result = engine.validate({ tool: 'simulate', risk: 81 });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('81');
        expect(result.reason).toContain('80');
      });

      it('falls back to action.score when action.risk is absent', () => {
        process.env.RISK_THRESHOLD = '50';
        const result = engine.validate({ tool: 'simulate', score: 55 });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('55');
      });

      it('defaults risk to 0 when neither risk nor score is present', () => {
        process.env.RISK_THRESHOLD = '10';
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
      });
    });

    // ── timeout limits ─────────────────────────────────────────────────────────
    describe('timeout limits (ACTION_TIMEOUT_MS)', () => {
      it('allows an action whose timeout is at or below the maximum', () => {
        process.env.ACTION_TIMEOUT_MS = '3000';
        expect(engine.validate({ tool: 'simulate', timeout: 3000 }).allowed).toBe(true);
      });

      it('blocks an action whose timeout exceeds the maximum', () => {
        process.env.ACTION_TIMEOUT_MS = '3000';
        const result = engine.validate({ tool: 'simulate', timeout: 4000 });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('4000');
        expect(result.reason).toContain('3000');
      });

      it('allows an action with no timeout specified', () => {
        process.env.ACTION_TIMEOUT_MS = '1000';
        expect(engine.validate({ tool: 'simulate' }).allowed).toBe(true);
      });
    });
  });
});
