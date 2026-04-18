import { describe, it, expect } from 'vitest';
import { Comparator } from '../../../../server/core/evaluation/comparator';
import type { Observation } from '../../../../server/core/observation/observer';

describe('Comparator', () => {
  const successObservation: Observation = { actual_outcome: 'Simulated OK', state_change: true };
  const failureObservation: Observation = { actual_outcome: 'Error: timeout', state_change: false };

  it('returns success=true and score=100 when state_change is true', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('complete the task', successObservation);
    expect(comparison.success).toBe(true);
    expect(comparison.score).toBe(100);
  });

  it('returns success=false and score=0 when state_change is false', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('complete the task', failureObservation);
    expect(comparison.success).toBe(false);
    expect(comparison.score).toBe(0);
  });

  it('includes expected string in delta on success', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('complete the task', successObservation);
    expect(comparison.delta).toContain('complete the task');
  });

  it('includes both expected and actual in delta on failure', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('complete the task', failureObservation);
    expect(comparison.delta).toContain('complete the task');
    expect(comparison.delta).toContain('Error: timeout');
  });

  it('handles object expected values by stringifying them', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare({ goal: 'buy' }, failureObservation);
    expect(comparison.delta).toContain('"goal"');
  });
});
