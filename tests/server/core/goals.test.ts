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
    gm.markCompleted();
    expect(gm.getStatus()).toBe(GoalStatus.COMPLETED);
    gm.overridePrimaryGoal('Refreshed goal');
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

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  it('initial status is ACTIVE', () => {
    expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
    expect(gm.isComplete()).toBe(false);
    expect(gm.isFailed()).toBe(false);
  });

  it('markCompleted sets status to COMPLETED and isComplete returns true', () => {
    gm.markCompleted();
    expect(gm.getStatus()).toBe(GoalStatus.COMPLETED);
    expect(gm.isComplete()).toBe(true);
    expect(gm.isFailed()).toBe(false);
  });

  it('markFailed sets status to FAILED and isFailed returns true', () => {
    gm.markFailed();
    expect(gm.getStatus()).toBe(GoalStatus.FAILED);
    expect(gm.isFailed()).toBe(true);
    expect(gm.isComplete()).toBe(false);
  });

  it('pause sets status to PAUSED', () => {
    gm.pause();
    expect(gm.getStatus()).toBe(GoalStatus.PAUSED);
  });

  it('resume transitions PAUSED back to ACTIVE', () => {
    gm.pause();
    gm.resume();
    expect(gm.getStatus()).toBe(GoalStatus.ACTIVE);
  });

  it('resume is a no-op when not PAUSED', () => {
    gm.markCompleted();
    gm.resume();
    expect(gm.getStatus()).toBe(GoalStatus.COMPLETED);
  });

  // ── Success criteria ───────────────────────────────────────────────────────

  it('addSuccessCriterion adds a criterion', () => {
    gm.addSuccessCriterion('reach profit target');
    expect(gm.getSuccessCriteria()).toContain('reach profit target');
  });

  it('addSuccessCriterion ignores duplicates', () => {
    gm.addSuccessCriterion('criterion A');
    gm.addSuccessCriterion('criterion A');
    expect(gm.getSuccessCriteria().filter(c => c === 'criterion A')).toHaveLength(1);
  });

  it('addSuccessCriterion ignores empty strings', () => {
    gm.addSuccessCriterion('');
    expect(gm.getSuccessCriteria()).toHaveLength(0);
  });

  it('getSuccessCriteria returns a copy (mutations do not affect internal state)', () => {
    gm.addSuccessCriterion('immutable check');
    const copy = gm.getSuccessCriteria();
    copy.push('injected');
    expect(gm.getSuccessCriteria()).toHaveLength(1);
  });
});
