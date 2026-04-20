import { describe, it, expect } from 'vitest';
import { Comparator, SUCCESS_THRESHOLD } from '../../../../server/core/evaluation/comparator';
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

  // ── Phase 8: confidence scoring ────────────────────────────────────────────

  it('returns confidence=1.0 on success', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('task', successObservation);
    expect(comparison.confidence).toBe(1.0);
  });

  it('returns confidence=1.0 for definitive error outcomes', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'Error: connection refused', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.confidence).toBe(1.0);
    expect(comparison.score).toBe(0);
  });

  it('returns score=20 and confidence=0.6 for partial outcomes', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'partial completion — step 2 pending', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.score).toBe(20);
    expect(comparison.confidence).toBe(0.6);
  });

  it('returns confidence=0.0 for dry-run outcomes', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: "DRY RUN — would have executed tool 'simulate'", state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.confidence).toBe(0.0);
    expect(comparison.score).toBe(0);
  });

  it('returns confidence=0.5 for unknown failure reasons', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'nothing happened', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.confidence).toBe(0.5);
    expect(comparison.score).toBe(0);
  });

  // ── Phase 9: penalty field and strict success threshold ────────────────────

  it('SUCCESS_THRESHOLD is exported as 80', () => {
    expect(SUCCESS_THRESHOLD).toBe(80);
  });

  it('returns penalty=0.0 on success (reward this pattern)', () => {
    const comparator = new Comparator();
    const comparison = comparator.compare('task', successObservation);
    expect(comparison.penalty).toBe(0.0);
  });

  it('returns penalty=0.0 for dry-run (no real data — do not penalise)', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: "DRY RUN — would have executed tool 'simulate'", state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.penalty).toBe(0.0);
  });

  it('returns penalty=0.8 for partial outcomes (light penalty)', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'partial completion', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.penalty).toBe(0.8);
  });

  it('returns penalty=1.5 for definitive error outcomes (moderate penalty)', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'Error: connection refused', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.penalty).toBe(1.5);
  });

  it('returns penalty=1.2 for unknown failure reasons (soft penalty)', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'nothing happened', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.penalty).toBe(1.2);
  });

  it('partial score (20) is below SUCCESS_THRESHOLD (80) — no "kind of succeed" leakage', () => {
    const comparator = new Comparator();
    const observation: Observation = { actual_outcome: 'progress made but incomplete', state_change: false };
    const comparison = comparator.compare('task', observation);
    expect(comparison.score).toBeLessThan(SUCCESS_THRESHOLD);
    expect(comparison.success).toBe(false);
  });
});
