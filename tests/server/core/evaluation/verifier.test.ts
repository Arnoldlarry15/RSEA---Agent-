import { describe, it, expect } from 'vitest';
import { OutcomeVerifier } from '../../../../server/core/evaluation/verifier';

describe('OutcomeVerifier', () => {
  describe('blocked results', () => {
    it('marks a blocked result as verified with confidence=1.0', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'blocked', outcome: 'Tool not allowed', success: false });
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.flags[0]).toMatch(/blocked/);
    });
  });

  describe('dry-run results', () => {
    it('marks a dry-run result as unverified with confidence=0.0', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'dry_run', outcome: "DRY RUN — would have executed tool 'simulate'", success: false });
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0.0);
      expect(result.flags.some(f => f.includes('dry_run'))).toBe(true);
    });
  });

  describe('status/outcome mismatch detection', () => {
    it('flags executed status when outcome contains error keywords', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'executed', outcome: 'Error: connection refused', success: true });
      expect(result.verified).toBe(false);
      expect(result.flags.some(f => f.includes('status_outcome_mismatch'))).toBe(true);
    });

    it('flags simulated status when outcome contains timeout keyword', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'simulated', outcome: 'timeout during simulation', success: true });
      expect(result.verified).toBe(false);
    });

    it('flags failed status when outcome looks like a success', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'failed', outcome: 'Task completed successfully', success: false });
      expect(result.verified).toBe(false);
      expect(result.flags.some(f => f.includes('status_outcome_mismatch'))).toBe(true);
    });

    it('flags executed status when success=false', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'executed', outcome: 'some result', success: false });
      expect(result.verified).toBe(false);
      expect(result.flags.some(f => f.includes('status_success_mismatch'))).toBe(true);
    });
  });

  describe('clean results', () => {
    it('marks a clean executed result as verified with confidence=1.0', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'executed', outcome: 'API call completed', success: true });
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.flags).toHaveLength(0);
    });

    it('marks a clean failed result (no success keyword in outcome) as verified', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ status: 'failed', outcome: 'network unreachable', success: false });
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('edge cases', () => {
    it('handles a null/undefined result gracefully', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify(null);
      expect(result.verified).toBe(true);
      expect(result.confidence).toBe(1.0);
    });

    it('handles a result with no status field', () => {
      const verifier = new OutcomeVerifier();
      const result = verifier.verify({ outcome: 'something happened' });
      expect(result.verified).toBe(true);
    });
  });
});
