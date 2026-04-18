import { describe, it, expect, beforeEach } from 'vitest';
import { StrategyVersioning } from '../../../../server/core/strategy/versioning';
import { defaultStrategyConfig, StrategyConfig } from '../../../../server/core/strategy/config';

function makeConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return { ...defaultStrategyConfig(), ...overrides };
}

describe('StrategyVersioning', () => {
  let versioning: StrategyVersioning;

  beforeEach(() => {
    versioning = new StrategyVersioning();
  });

  describe('getCurrent', () => {
    it('returns null when nothing has been committed', () => {
      expect(versioning.getCurrent()).toBeNull();
    });
  });

  describe('commit', () => {
    it('stores a version entry with the supplied change and impact', () => {
      const cfg = makeConfig({ exploration_rate: 0.3 });
      const entry = versioning.commit('raised exploration_rate', 5, cfg);
      expect(entry.change).toBe('raised exploration_rate');
      expect(entry.impact).toBe(5);
    });

    it('assigns an incrementing semantic version label', () => {
      const cfg = makeConfig();
      const v1 = versioning.commit('first change', 1, cfg);
      const v2 = versioning.commit('second change', 2, cfg);
      expect(v1.version).toBe('v1.1');
      expect(v2.version).toBe('v1.2');
    });

    it('records a timestamp in ISO-8601 format', () => {
      const entry = versioning.commit('test', 0, makeConfig());
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('deep-copies the config so future mutations do not affect stored versions', () => {
      const cfg = makeConfig({ exploration_rate: 0.2 });
      versioning.commit('initial', 0, cfg);
      cfg.exploration_rate = 0.99;
      expect(versioning.getCurrent()!.config.exploration_rate).toBe(0.2);
    });

    it('getCurrent returns the most recent committed version', () => {
      versioning.commit('first', 1, makeConfig({ exploration_rate: 0.1 }));
      versioning.commit('second', 2, makeConfig({ exploration_rate: 0.5 }));
      expect(versioning.getCurrent()!.config.exploration_rate).toBe(0.5);
    });
  });

  describe('rollback', () => {
    it('returns null when fewer than two entries exist', () => {
      versioning.commit('only entry', 0, makeConfig());
      expect(versioning.rollback()).toBeNull();
    });

    it('returns null when history is empty', () => {
      expect(versioning.rollback()).toBeNull();
    });

    it('restores the previous config values', () => {
      versioning.commit('v1', 0, makeConfig({ exploration_rate: 0.2 }));
      versioning.commit('v2', 3, makeConfig({ exploration_rate: 0.8 }));
      const restored = versioning.rollback();
      expect(restored!.exploration_rate).toBe(0.2);
    });

    it('removes the most recent entry from history after rollback', () => {
      versioning.commit('v1', 0, makeConfig());
      versioning.commit('v2', 1, makeConfig());
      versioning.rollback();
      expect(versioning.getHistory()).toHaveLength(1);
    });

    it('returns a deep copy (no aliasing with internal state)', () => {
      versioning.commit('v1', 0, makeConfig({ exploration_rate: 0.1 }));
      versioning.commit('v2', 1, makeConfig({ exploration_rate: 0.5 }));
      const restored = versioning.rollback()!;
      restored.exploration_rate = 0.99;
      expect(versioning.getCurrent()!.config.exploration_rate).toBe(0.1);
    });

    it('allows multiple sequential rollbacks', () => {
      versioning.commit('v1', 0, makeConfig({ exploration_rate: 0.1 }));
      versioning.commit('v2', 1, makeConfig({ exploration_rate: 0.2 }));
      versioning.commit('v3', 2, makeConfig({ exploration_rate: 0.3 }));
      versioning.rollback(); // back to v2
      const restored = versioning.rollback(); // back to v1
      expect(restored!.exploration_rate).toBe(0.1);
    });
  });

  describe('getHistory', () => {
    it('returns an empty array before any commits', () => {
      expect(versioning.getHistory()).toEqual([]);
    });

    it('returns all committed versions in order', () => {
      versioning.commit('a', 1, makeConfig({ risk_tolerance: 0.3 }));
      versioning.commit('b', 2, makeConfig({ risk_tolerance: 0.6 }));
      const history = versioning.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].change).toBe('a');
      expect(history[1].change).toBe('b');
    });

    it('returns a copy so mutations do not affect internal state', () => {
      versioning.commit('a', 1, makeConfig());
      const history = versioning.getHistory();
      history.pop();
      expect(versioning.getHistory()).toHaveLength(1);
    });
  });
});
