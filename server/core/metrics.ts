/**
 * CycleMetricsCollector — Operational Observability
 * ────────────────────────────────────────────────────
 * Collects per-cycle execution metrics so operators can detect degradation,
 * score drift, or runaway cost without needing an external APM system.
 *
 * Tracked dimensions:
 *   - per-cycle success rate (comparator successes / total evaluations)
 *   - comparator score distribution (avg / min / max / p50 over recent window)
 *   - risk gate trigger frequency (blocked results per cycle)
 *   - per-tool execution outcomes (success + failure tallies)
 *
 * The collector keeps a rolling window of MAX_SAMPLES cycles to prevent
 * unbounded memory growth. No external dependencies — pure in-process state.
 */

export interface CycleMetricsSample {
  cycleNumber: number;
  timestamp: string;
  /** Total number of evaluation records in this cycle. */
  evaluationCount: number;
  /** Evaluations where evaluation.success === true. */
  successCount: number;
  /** Evaluations where evaluation.success !== true. */
  failureCount: number;
  /** Mean comparator score across all evaluations (0–100). */
  avgScore: number;
  /** Lowest comparator score seen this cycle. */
  minScore: number;
  /** Highest comparator score seen this cycle. */
  maxScore: number;
  /** Number of results that were hard-blocked by the PreExecutionRiskGate. */
  riskGateBlocks: number;
  /** Per-tool success/failure tallies for this cycle. */
  toolOutcomes: Record<string, { success: number; failure: number }>;
}

export interface MetricsSummary {
  /** Total cycles recorded in the current window. */
  totalCycles: number;
  /** Total evaluation records across all recorded cycles. */
  totalEvaluations: number;
  /** Percentage of evaluations that were marked successful (0–100). */
  overallSuccessRate: number;
  /** Comparator score distribution aggregated over all recorded cycles. */
  scoreDistribution: {
    avg: number;
    min: number;
    max: number;
    /** Median (p50) of per-cycle average scores. */
    p50: number;
  };
  /** Total PreExecutionRiskGate hard-blocks across the window. */
  riskGateBlocks: number;
  /** Per-tool aggregated outcomes with derived success rate. */
  toolOutcomes: Record<string, { success: number; failure: number; successRate: number }>;
  /** The 10 most recent cycle samples (oldest first). */
  recentCycles: CycleMetricsSample[];
}

export class CycleMetricsCollector {
  private samples: CycleMetricsSample[] = [];
  /** Sliding-window cap — prevents unbounded memory growth. */
  private static readonly MAX_SAMPLES = 500;
  private nextCycleNumber = 0;

  /**
   * Records metrics for a completed agent cycle.
   *
   * @param evaluations    The evaluation array returned by Controller.runCycle().
   *                       Each entry must have `.evaluation.success` (boolean) and
   *                       `.evaluation.score` (number 0–100).
   * @param riskGateBlocks Count of results whose `status === 'blocked'` — produced
   *                       by the PreExecutionRiskGate before the Sniper fires.
   */
  record(evaluations: any[], riskGateBlocks: number): void {
    this.nextCycleNumber++;

    const scores: number[] = [];
    let successCount = 0;
    const toolOutcomes: Record<string, { success: number; failure: number }> = {};

    for (const ev of evaluations) {
      const score = typeof ev?.evaluation?.score === 'number' ? ev.evaluation.score : null;
      if (score !== null) scores.push(score);

      if (ev?.evaluation?.success === true) {
        successCount++;
      }

      const tool = typeof ev?.tool === 'string' ? ev.tool : 'unknown';
      if (!toolOutcomes[tool]) toolOutcomes[tool] = { success: 0, failure: 0 };
      if (ev?.evaluation?.success === true) {
        toolOutcomes[tool].success++;
      } else {
        toolOutcomes[tool].failure++;
      }
    }

    const failureCount = evaluations.length - successCount;
    const avgScore =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

    const sample: CycleMetricsSample = {
      cycleNumber: this.nextCycleNumber,
      timestamp: new Date().toISOString(),
      evaluationCount: evaluations.length,
      successCount,
      failureCount,
      avgScore,
      minScore,
      maxScore,
      riskGateBlocks,
      toolOutcomes,
    };

    this.samples.push(sample);
    if (this.samples.length > CycleMetricsCollector.MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  /**
   * Returns aggregated metrics across the current sliding window.
   * All values are safe to serialise directly to JSON.
   */
  getSummary(): MetricsSummary {
    if (this.samples.length === 0) {
      return {
        totalCycles: 0,
        totalEvaluations: 0,
        overallSuccessRate: 0,
        scoreDistribution: { avg: 0, min: 0, max: 0, p50: 0 },
        riskGateBlocks: 0,
        toolOutcomes: {},
        recentCycles: [],
      };
    }

    let totalEvaluations = 0;
    let totalSuccess = 0;
    let totalRiskBlocks = 0;
    const perCycleAvgScores: number[] = [];
    const aggregatedToolOutcomes: Record<string, { success: number; failure: number }> = {};

    for (const s of this.samples) {
      totalEvaluations += s.evaluationCount;
      totalSuccess += s.successCount;
      totalRiskBlocks += s.riskGateBlocks;
      if (s.evaluationCount > 0) {
        perCycleAvgScores.push(s.avgScore);
      }
      for (const [tool, outcomes] of Object.entries(s.toolOutcomes)) {
        if (!aggregatedToolOutcomes[tool]) {
          aggregatedToolOutcomes[tool] = { success: 0, failure: 0 };
        }
        aggregatedToolOutcomes[tool].success += outcomes.success;
        aggregatedToolOutcomes[tool].failure += outcomes.failure;
      }
    }

    // Score distribution uses per-cycle average scores as the population.
    const sortedScores = [...perCycleAvgScores].sort((a, b) => a - b);
    const p50 =
      sortedScores.length > 0
        ? sortedScores[Math.floor(sortedScores.length / 2)]
        : 0;
    const globalAvgScore =
      sortedScores.length > 0
        ? Math.round(
            (sortedScores.reduce((a, b) => a + b, 0) / sortedScores.length) * 10,
          ) / 10
        : 0;
    const globalMinScore = sortedScores.length > 0 ? Math.min(...sortedScores) : 0;
    const globalMaxScore = sortedScores.length > 0 ? Math.max(...sortedScores) : 0;

    // Build per-tool summary with derived success rate.
    const toolSummary: Record<string, { success: number; failure: number; successRate: number }> = {};
    for (const [tool, outcomes] of Object.entries(aggregatedToolOutcomes)) {
      const total = outcomes.success + outcomes.failure;
      toolSummary[tool] = {
        ...outcomes,
        successRate: total > 0 ? Math.round((outcomes.success / total) * 100) : 0,
      };
    }

    return {
      totalCycles: this.samples.length,
      totalEvaluations,
      overallSuccessRate:
        totalEvaluations > 0
          ? Math.round((totalSuccess / totalEvaluations) * 100)
          : 0,
      scoreDistribution: {
        avg: globalAvgScore,
        min: globalMinScore,
        max: globalMaxScore,
        p50,
      },
      riskGateBlocks: totalRiskBlocks,
      toolOutcomes: toolSummary,
      recentCycles: this.samples.slice(-10),
    };
  }

  /** Resets the collector (test helper — clears all samples and resets counter). */
  reset(): void {
    this.samples = [];
    this.nextCycleNumber = 0;
  }
}

/** Module-level singleton — shared across the whole server process. */
export const cycleMetrics = new CycleMetricsCollector();
