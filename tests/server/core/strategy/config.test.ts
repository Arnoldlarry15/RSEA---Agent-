import { describe, it, expect } from 'vitest';
import {
  defaultStrategyConfig,
  cloneStrategyConfig,
  MUTABLE_STRATEGY_FIELDS,
} from '../../../../server/core/strategy/config';

describe('strategy/config', () => {
  describe('defaultStrategyConfig', () => {
    it('returns exploration_rate of 0.2', () => {
      expect(defaultStrategyConfig().exploration_rate).toBe(0.2);
    });

    it('returns risk_tolerance of 0.5', () => {
      expect(defaultStrategyConfig().risk_tolerance).toBe(0.5);
    });

    it('returns an empty tool_preference map', () => {
      expect(defaultStrategyConfig().tool_preference).toEqual({});
    });

    it('returns a fresh object on each call (no shared reference)', () => {
      const a = defaultStrategyConfig();
      const b = defaultStrategyConfig();
      a.exploration_rate = 0.99;
      expect(b.exploration_rate).toBe(0.2);
    });
  });

  describe('cloneStrategyConfig', () => {
    it('deep-copies scalar fields', () => {
      const original = defaultStrategyConfig();
      const copy = cloneStrategyConfig(original);
      original.exploration_rate = 0.99;
      expect(copy.exploration_rate).toBe(0.2);
    });

    it('deep-copies tool_preference (no shared reference)', () => {
      const original = defaultStrategyConfig();
      original.tool_preference = { search: 0.8 };
      const copy = cloneStrategyConfig(original);
      original.tool_preference.search = 0.1;
      expect(copy.tool_preference.search).toBe(0.8);
    });
  });

  describe('MUTABLE_STRATEGY_FIELDS', () => {
    it('contains exploration_rate', () => {
      expect(MUTABLE_STRATEGY_FIELDS).toContain('exploration_rate');
    });

    it('contains risk_tolerance', () => {
      expect(MUTABLE_STRATEGY_FIELDS).toContain('risk_tolerance');
    });

    it('contains tool_preference', () => {
      expect(MUTABLE_STRATEGY_FIELDS).toContain('tool_preference');
    });

    it('has exactly three entries', () => {
      expect(MUTABLE_STRATEGY_FIELDS).toHaveLength(3);
    });
  });
});
