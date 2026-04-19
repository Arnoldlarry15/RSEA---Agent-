import type { Observation } from '../observation/observer';

export interface Comparison {
  delta: string;
  success: boolean;
  /** 0–100 outcome quality score. 100 = full success, 50 = partial, 0 = failure. */
  score: number;
  /**
   * How certain this comparison result is (0.0–1.0).
   * 1.0 = definitive (clear success or error).
   * 0.5 = ambiguous (failure reason unknown).
   * 0.0 = unknown (e.g. dry-run — no real execution took place).
   */
  confidence: number;
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

    if (success) {
      score = 100;
      confidence = 1.0;
    } else {
      const outcomeStr = actual.actual_outcome;

      if (DRY_RUN_PATTERNS.test(outcomeStr)) {
        // Dry-run: outcome is simulated; we have no real information.
        score = 0;
        confidence = 0.0;
      } else if (PARTIAL_OUTCOME_PATTERNS.test(outcomeStr)) {
        // Partial progress detected — give partial credit.
        score = 50;
        confidence = 0.6;
      } else if (ERROR_OUTCOME_PATTERNS.test(outcomeStr)) {
        // Definitive failure.
        score = 0;
        confidence = 1.0;
      } else {
        // Unknown failure reason.
        score = 0;
        confidence = 0.5;
      }
    }

    const delta = success
      ? `Outcome matched expected: ${expectedStr}`
      : `Expected: ${expectedStr} | Actual: ${actual.actual_outcome}`;

    return { delta, success, score, confidence };
  }
}
