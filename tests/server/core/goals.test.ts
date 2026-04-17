import { describe, it, expect, beforeEach } from 'vitest';
import { GoalManager } from '../../../server/core/goals';

describe('GoalManager', () => {
  let gm: GoalManager;

  beforeEach(() => {
    gm = new GoalManager();
  });

  it('returns a default primary goal on construction', () => {
    const { primary } = gm.getGoals();
    expect(typeof primary).toBe('string');
    expect(primary.length).toBeGreaterThan(0);
  });

  it('returns default subtasks on construction', () => {
    const { subTasks } = gm.getGoals();
    expect(Array.isArray(subTasks)).toBe(true);
    expect(subTasks.length).toBeGreaterThan(0);
  });

  it('overrides the primary goal', () => {
    gm.overridePrimaryGoal('New primary goal');
    expect(gm.getGoals().primary).toBe('New primary goal');
  });

  it('updates subtasks with a new array', () => {
    gm.updateSubTasks(['task A', 'task B']);
    expect(gm.getGoals().subTasks).toEqual(['task A', 'task B']);
  });

  it('does not update subtasks when given an empty array', () => {
    const original = gm.getGoals().subTasks;
    gm.updateSubTasks([]);
    expect(gm.getGoals().subTasks).toEqual(original);
  });

  it('getGoals returns both primary and subTasks fields', () => {
    const goals = gm.getGoals();
    expect(goals).toHaveProperty('primary');
    expect(goals).toHaveProperty('subTasks');
  });
});
