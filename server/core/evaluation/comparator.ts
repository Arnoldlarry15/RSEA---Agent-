import type { Observation } from '../observation/observer';

/**
 * Minimum score (0–100) that counts as a genuine success.
 * Scores below this value — including partial completions — are treated as
 * failures by downstream enforcement layers (risk gate, rollback, reflection).
 * Exporting this constant lets every consumer share the same definition of
 * "success" without magic numbers.
 */
export const SUCCESS_THRESHOLD = 80;

export interface Comparison {
  delta: string;
  success: boolean;
  /** 0–100 outcome quality score. 100 = full success, 20 = partial, 0 = failure. */
  score: number;
  /**
   * How certain this comparison result is (0.0–1.0).
   * 1.0 = definitive (clear success or error).
   * 0.5 = ambiguous (failure reason unknown).
   * 0.0 = unknown (e.g. dry-run — no real execution took place).
   */
  confidence: number;
  /**
   * Penalty multiplier applied to future actions of the same type (0.0–2.0).
   * 0.0  = no penalty (success or dry-run with no real data).
   * 0.8  = light penalty (partial progress — still mostly failed).
   * 1.5  = moderate penalty (definitive error — avoid repeating).
   * 1.2  = soft penalty (unknown failure reason).
   * 2.0  = hard penalty (reserved for critical violations).
   * Consumed by the PreExecutionRiskGate and Reflector authority layer.
   */
  penalty: number;
}

/** Outcome keywords that indicate partial progress toward the expected result. */
const PARTIAL_OUTCOME_PATTERNS = /partial|progress|pending|incomplete|warning/i;

/** Outcome keywords that indicate a definitive failure. */
const ERROR_OUTCOME_PATTERNS = /error|fail|timeout|blocked|refused|denied|exception/i;

/** Outcome keywords that indicate a dry-run (no real execution). */
const DRY_RUN_PATTERNS = /dry.?run/i;

export class Comparator {
  compare(expected: any, actual: Observation): Comparison {
    const success = actual.state_change;
    const expectedStr = typeof expected === 'string' ? expected : JSON.stringify(expected);

    let score: number;
    let confidence: number;
    let penalty: number;

    if (success) {
      score = 100;
      confidence = 1.0;
      penalty = 0.0; // No penalty — reward this pattern.
    } else {
      const outcomeStr = actual.actual_outcome;

      if (DRY_RUN_PATTERNS.test(outcomeStr)) {
        // Dry-run: outcome is simulated; we have no real information.
        score = 0;
        confidence = 0.0;
        penalty = 0.0; // No real data — do not penalise.
      } else if (PARTIAL_OUTCOME_PATTERNS.test(outcomeStr)) {
        // Partial progress: still a failure — score is low to prevent "kind of succeed"
        // leakage.  Scores below SUCCESS_THRESHOLD (80) are treated as failures by all
        // enforcement layers.  Penalty is light because partial effort is better than
        // no effort, but the action should still be discouraged.
        score = 20;
        confidence = 0.6;
        penalty = 0.8;
      } else if (ERROR_OUTCOME_PATTERNS.test(outcomeStr)) {
        // Definitive failure — penalise this action type moderately.
        score = 0;
        confidence = 1.0;
        penalty = 1.5;
      } else {
        // Unknown failure reason — soft penalise.
        score = 0;
        confidence = 0.5;
        penalty = 1.2;
      }
    }

    const delta = success
      ? `Outcome matched expected: ${expectedStr}`
      : `Expected: ${expectedStr} | Actual: ${actual.actual_outcome}`;

    return { delta, success, score, confidence, penalty };
  }
}
