import { describe, it, expect, beforeEach } from 'vitest';
import { RulesEngine } from '../../../server/core/rules';

describe('RulesEngine', () => {
  let engine: RulesEngine;

  beforeEach(() => {
    engine = new RulesEngine();
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
});
