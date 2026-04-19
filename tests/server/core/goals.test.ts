import { describe, it, expect, beforeEach } from 'vitest';
import { GoalManager, GoalStatus } from '../../../server/core/goals';

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

  it('overridePrimaryGoal resets status to ACTIVE', () => {
    gm.markFailed();
    expect(gm.getStatus()).toBe(GoalStatus.FAILED);
    gm.overridePrimaryGoal('Reset goal');
    expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
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

  it('pause() sets status to PAUSED', () => {
    gm.pause();
    expect(gm.getStatus()).toBe(GoalStatus.PAUSED);
  });

  it('resume() restores PAUSED status to ACTIVE', () => {
    gm.pause();
    gm.resume();
    expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
  });

  it('resume() does nothing when not PAUSED', () => {
    gm.resume();
    expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
  });

  it('addSuccessCriterion() adds a criterion', () => {
    gm.addSuccessCriterion('criterion 1');
    expect(gm.getSuccessCriteria()).toContain('criterion 1');
  });

  it('addSuccessCriterion() does not add duplicates', () => {
    gm.addSuccessCriterion('criterion 1');
    gm.addSuccessCriterion('criterion 1');
    expect(gm.getSuccessCriteria()).toHaveLength(1);
  });

  it('addSuccessCriterion() ignores empty string', () => {
    gm.addSuccessCriterion('');
    expect(gm.getSuccessCriteria()).toHaveLength(0);
  });

  it('getSuccessCriteria() returns a copy (not the internal array)', () => {
    gm.addSuccessCriterion('criterion 1');
    const criteria = gm.getSuccessCriteria();
    criteria.push('injected');
    expect(gm.getSuccessCriteria()).toHaveLength(1);
  });

  it('markCompleted() sets status to COMPLETED and isComplete() returns true', () => {
    gm.markCompleted();
    expect(gm.getStatus()).toBe(GoalStatus.COMPLETED);
    expect(gm.isComplete()).toBe(true);
  });

  it('markFailed() sets status to FAILED and isFailed() returns true', () => {
    gm.markFailed();
    expect(gm.getStatus()).toBe(GoalStatus.FAILED);
    expect(gm.isFailed()).toBe(true);
  });

  it('isComplete() returns false when not completed', () => {
    expect(gm.isComplete()).toBe(false);
  });

  it('isFailed() returns false when not failed', () => {
    expect(gm.isFailed()).toBe(false);
  });

  describe('restore', () => {
    it('restores primary goal, subTasks, status, and successCriteria', () => {
      gm.restore({
        primary: 'Restored primary',
        subTasks: ['task A', 'task B'],
        status: GoalStatus.PAUSED,
        successCriteria: ['criterion X'],
      });
      expect(gm.getGoals().primary).toBe('Restored primary');
      expect(gm.getGoals().subTasks).toEqual(['task A', 'task B']);
      expect(gm.getStatus()).toBe(GoalStatus.PAUSED);
      expect(gm.getSuccessCriteria()).toEqual(['criterion X']);
    });

    it('does not update subTasks when restored state has an empty array', () => {
      const original = gm.getGoals().subTasks;
      gm.restore({ primary: 'Some goal', subTasks: [], status: GoalStatus.ACTIVE, successCriteria: [] });
      expect(gm.getGoals().subTasks).toEqual(original);
    });

    it('ignores an unrecognised status string', () => {
      gm.restore({ primary: 'goal', subTasks: ['t'], status: 'UNKNOWN_STATUS', successCriteria: [] });
      // Status should remain at its previous value (ACTIVE)
      expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
    });

    it('initialises successCriteria to an empty array when restored with a non-array value', () => {
      (gm as any).restore({ primary: 'goal', subTasks: ['t'], status: 'ACTIVE', successCriteria: null });
      expect(gm.getSuccessCriteria()).toEqual([]);
    });
  });
});
