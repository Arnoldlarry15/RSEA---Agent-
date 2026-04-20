/**
 * PreExecutionRiskGate — Phase 9: Enforcement Power
 * ───────────────────────────────────────────────────
 * A hard-stop layer that runs BEFORE any action reaches the Sniper / Executor.
 * The gate aggregates four independent risk signals and produces a numeric
 * risk score (0–100).  Any action whose composite score exceeds
 * HARD_BLOCK_THRESHOLD is blocked outright — no further execution occurs.
 *
 * Risk signals:
 *   1. action.risk   – explicit risk value carried on the action object (0–100).
 *   2. failure history – how many times this tool has failed recently in memory.
 *   3. strategy risk_tolerance – low tolerance raises effective risk (0–20 pts).
 *   4. reflector bans – a tool banned by the Reflector adds 40 pts (near-certain block).
 *
 * The gate is intentionally simple and deterministic so it is easy to audit and
 * test.  It never calls the LLM.
 */

import { MemorySystem } from '../memory';
import type { StrategyConfig } from '../strategy/config';
import { logEvent } from '../../utils/logger';

/** Risk score (0–100) above which the action is hard-blocked. */
export const HARD_BLOCK_THRESHOLD = 75;

/** Number of recent short-term events to scan for failure history. */
const FAILURE_HISTORY_WINDOW = 20;

/** Risk points added per recent failure of the same tool. */
const FAILURE_PENALTY_PER_COUNT = 15;

/**
 * Long-term memory key under which the Reflector stores the list of banned
 * tool names.  The value is expected to be a string array.
 */
export const REFLECTOR_BANS_KEY = 'REFLECTOR_BANS';

export interface RiskAssessment {
  /** Composite risk score 0–100. Higher = more dangerous. */
  riskScore: number;
  /** False when riskScore > HARD_BLOCK_THRESHOLD — the action must not proceed. */
  allowed: boolean;
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Individual contributing factors, useful for logging and debugging. */
  factors: string[];
}

export class PreExecutionRiskGate {
  /**
   * Assesses risk for a single action and decides whether to allow it.
   *
   * @param action         The action object produced by the Planner / Sniper.
   * @param memory         MemorySystem instance — used for failure history and bans.
   * @param strategyConfig Current StrategyConfig — risk_tolerance influences scoring.
   * @returns              RiskAssessment with `allowed=false` when the action is blocked.
   */
  assess(
    action: any,
    memory: MemorySystem,
    strategyConfig: StrategyConfig,
  ): RiskAssessment {
    const factors: string[] = [];
    let riskScore = 0;

    // ── Signal 1: explicit action risk field ─────────────────────────────────
    const actionRisk =
      typeof action?.risk === 'number'
        ? Math.max(0, Math.min(100, action.risk))
        : 0;
    if (actionRisk > 0) {
      const contribution = actionRisk * 0.4;
      riskScore += contribution;
      factors.push(`action_risk=${actionRisk} (+${contribution.toFixed(1)})`);
    }

    // ── Signal 2: recent failure history for this tool ────────────────────────
    const tool: string = action?.tool ?? 'unknown';
    const recentEvents = memory.getRecentContext(FAILURE_HISTORY_WINDOW);
    const recentFailures = recentEvents.filter(
      (e: any) =>
        e.type === 'evaluation' &&
        e.success === false &&
        e.verified !== false && // ignore unverified results to avoid noise
        String(e.actual ?? e.taskId ?? '').toLowerCase().includes(tool.toLowerCase()),
    ).length;
    if (recentFailures > 0) {
      const failurePenalty = Math.min(50, recentFailures * FAILURE_PENALTY_PER_COUNT);
      riskScore += failurePenalty;
      factors.push(`recent_failures=${recentFailures} (+${failurePenalty})`);
    }

    // ── Signal 3: strategy risk tolerance ────────────────────────────────────
    // Low tolerance → conservative agent → higher effective risk on marginal actions.
    const riskTolerance = strategyConfig.risk_tolerance; // 0.0–1.0
    const tolerancePenalty = Math.round((1 - riskTolerance) * 20);
    riskScore += tolerancePenalty;
    factors.push(`risk_tolerance=${riskTolerance.toFixed(2)} (+${tolerancePenalty})`);

    // ── Signal 4: reflector ban list ──────────────────────────────────────────
    const bannedTools: string[] = memory.recall(REFLECTOR_BANS_KEY) ?? [];
    if (Array.isArray(bannedTools) && bannedTools.includes(tool)) {
      riskScore += 40;
      factors.push(`tool_banned=true (+40)`);
    }

    riskScore = Math.min(100, Math.round(riskScore));
    const allowed = riskScore <= HARD_BLOCK_THRESHOLD;
    const reason = allowed
      ? `Risk score ${riskScore} is within the allowed threshold (≤${HARD_BLOCK_THRESHOLD})`
      : `BLOCKED — risk score ${riskScore} exceeds hard block threshold (${HARD_BLOCK_THRESHOLD})`;

    logEvent('risk_gate_assess', { tool, riskScore, allowed, factors });

    return { riskScore, allowed, reason, factors };
  }
}
