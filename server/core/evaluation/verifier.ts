/**
 * OutcomeVerifier — Phase 8: Grounded Truth Enforcement
 *
 * Performs a second-pass integrity check on execution results to detect
 * cases where the reported status contradicts the actual outcome text.
 * This prevents the agent from storing and learning from untrustworthy
 * results that could reinforce false confidence.
 */

export interface VerificationResult {
  /** True when the result passes all integrity checks. */
  verified: boolean;
  /** Certainty of the verification itself (0.0–1.0). */
  confidence: number;
  /** Human-readable descriptions of any detected anomalies. */
  flags: string[];
}

/** Keywords that suggest an error occurred despite a nominally positive status. */
const ERROR_KEYWORDS = /error|fail|timeout|blocked|refused|denied|exception/i;

/** Keywords that suggest success despite a nominally negative status. */
const SUCCESS_KEYWORDS = /success|completed|executed|ok\b|done/i;

export class OutcomeVerifier {
  /**
   * Verifies that the reported execution status is consistent with the outcome
   * text and other result fields.
   *
   * @param result  An execution result object (from Executor or Sniper).
   * @returns       A VerificationResult describing whether the result can be trusted.
   */
  verify(result: any): VerificationResult {
    const flags: string[] = [];
    const outcome = String(result?.outcome ?? result?.actual_outcome ?? '');
    const status: string = result?.status ?? '';

    // Blocked results are authoritative — the action did not execute.
    if (status === 'blocked') {
      return {
        verified: true,
        confidence: 1.0,
        flags: ['blocked: action did not execute; no verification needed'],
      };
    }

    // Dry-run results carry no real execution data.
    if (status === 'dry_run') {
      flags.push('dry_run: outcome is simulated — actual execution did not occur');
      return { verified: false, confidence: 0.0, flags };
    }

    // Detect status/outcome mismatch: reported success but outcome looks like an error.
    if ((status === 'executed' || status === 'simulated') && ERROR_KEYWORDS.test(outcome)) {
      flags.push(
        `status_outcome_mismatch: status="${status}" but outcome contains error keywords`,
      );
    }

    // Detect status/outcome mismatch: reported failure but outcome looks like a success.
    if (status === 'failed' && SUCCESS_KEYWORDS.test(outcome)) {
      flags.push(
        `status_outcome_mismatch: status="failed" but outcome suggests success`,
      );
    }

    // Results with success=false that claim status 'executed' are suspicious.
    if (status === 'executed' && result?.success === false) {
      flags.push('status_success_mismatch: status="executed" but success=false');
    }

    const verified = flags.length === 0;
    const confidence = verified ? 1.0 : 0.5;

    return { verified, confidence, flags };
  }
}
