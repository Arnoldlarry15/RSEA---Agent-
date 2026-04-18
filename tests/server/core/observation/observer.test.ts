import { describe, it, expect } from 'vitest';
import { Observer } from '../../../../server/core/observation/observer';

describe('Observer', () => {
  it('extracts actual_outcome from result outcome field', () => {
    const observer = new Observer();
    const result = { outcome: 'Simulated OK', success: true };
    const obs = observer.observe(result);
    expect(obs.actual_outcome).toBe('Simulated OK');
    expect(obs.state_change).toBe(true);
  });

  it('marks state_change false when success is false', () => {
    const observer = new Observer();
    const result = { outcome: 'blocked', success: false };
    const obs = observer.observe(result);
    expect(obs.state_change).toBe(false);
  });

  it('falls back to stringified result when outcome is absent', () => {
    const observer = new Observer();
    const result = { status: 'dry_run' };
    const obs = observer.observe(result);
    expect(obs.actual_outcome).toContain('dry_run');
    expect(obs.state_change).toBe(false);
  });

  it('handles null input gracefully', () => {
    const observer = new Observer();
    const obs = observer.observe(null);
    expect(typeof obs.actual_outcome).toBe('string');
    expect(obs.state_change).toBe(false);
  });
});
