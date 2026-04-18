/**
 * AdversarialScorer — Phase 7: Adversarial Intelligence
 * ───────────────────────────────────────────────────────
 * Provides deterministic, history-based scoring for red-team rounds.
 * Tracks three independent metrics and combines them into a composite score:
 *
 *   success_rate  – percentage of rounds where all adversarial attacks were blocked
 *   efficiency    – value density relative to execution time (normalized 0-100)
 *   risk_score    – exposure ratio: how many attacks got through the defences (0-100)
 *   overall       – weighted composite: 50% success_rate + 30% efficiency + 20% safety
 */

export interface AdversarialRound {
  /** Unique identifier for this red-team round. */
  roundId: string;
  /** The strategy or opportunity being evaluated. */
  strategyId: string;
  /** Total number of adversarial attack vectors generated. */
  attacksAttempted: number;
  /** Number of attacks that were successfully blocked by the plan. */
  attacksBlocked: number;
  /** Wall-clock time spent on this round (milliseconds). */
  executionTimeMs: number;
  /** Numeric value produced by the round (robustness score, 0-100). */
  value: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

export interface AdversarialScore {
  /** Fraction of rounds where all attacks were repelled, expressed 0-100. */
  success_rate: number;
  /** Value-per-second density, normalized to 0-100. */
  efficiency: number;
  /** Attack-exposure ratio: higher means more risk (0-100). */
  risk_score: number;
  /** Weighted composite of the three metrics (0-100). */
  overall: number;
  /** Total rounds recorded in the scorer's window. */
  rounds: number;
}

export class AdversarialScorer {
  private rounds: AdversarialRound[] = [];
  /** Sliding window cap — prevents unbounded memory growth. */
  private static readonly MAX_ROUNDS = 100;

  /**
   * Records the result of a completed red-team round.
   * Older rounds are evicted once the window exceeds MAX_ROUNDS.
   */
  record(round: AdversarialRound): void {
    this.rounds.push(round);
    if (this.rounds.length > AdversarialScorer.MAX_ROUNDS) {
      this.rounds.shift();
    }
  }

  /**
   * Computes the current composite adversarial score from the recorded history.
   * Returns zeroed defaults when no rounds have been recorded yet.
   */
  score(): AdversarialScore {
    if (this.rounds.length === 0) {
      return { success_rate: 0, efficiency: 0, risk_score: 50, overall: 0, rounds: 0 };
    }

    const total = this.rounds.length;

    // success_rate: rounds where every attack was blocked (or no attacks were made)
    const successfulRounds = this.rounds.filter(
      r => r.attacksAttempted === 0 || r.attacksBlocked >= r.attacksAttempted
    ).length;
    const success_rate = Math.round((successfulRounds / total) * 100);

    // efficiency: average (value / seconds), clamped to 0-100 with soft scaling
    const avgEfficiencyRaw =
      this.rounds.reduce((sum, r) => {
        const timeS = Math.max(r.executionTimeMs, 1) / 1000;
        return sum + r.value / timeS;
      }, 0) / total;
    const efficiency = Math.min(100, Math.max(0, Math.round(avgEfficiencyRaw * 10)));

    // risk_score: fraction of attacks that were NOT blocked, expressed as 0-100
    const totalAttacks = this.rounds.reduce((sum, r) => sum + r.attacksAttempted, 0);
    const blockedAttacks = this.rounds.reduce((sum, r) => sum + r.attacksBlocked, 0);
    const risk_score =
      totalAttacks > 0
        ? Math.round(((totalAttacks - blockedAttacks) / totalAttacks) * 100)
        : 0;

    // overall: weighted composite (higher is better — risk contributes as safety margin)
    const overall = Math.round(
      success_rate * 0.5 + efficiency * 0.3 + (100 - risk_score) * 0.2
    );

    return { success_rate, efficiency, risk_score, overall, rounds: total };
  }

  /** Returns a shallow copy of all recorded rounds (oldest first). */
  getHistory(): AdversarialRound[] {
    return [...this.rounds];
  }
}
