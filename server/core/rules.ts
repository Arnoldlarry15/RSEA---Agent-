import {
  getConfidenceThreshold,
  getDecisionAggressiveness,
  getMaxActionsPerCycle,
  getRiskThreshold,
  getActionTimeoutMs,
} from './config';

export interface Action {
  action: string;
  target: any;
}

export interface ValidationResult {
  allowed: boolean;
  reason: string;
}

export class RulesEngine {
  /** Running count of actions approved within the current execution cycle. */
  private cycleActionCount: number = 0;

  /**
   * Resets the per-cycle action counter.
   * Must be called at the start of each new execution cycle.
   */
  resetCycle(): void {
    this.cycleActionCount = 0;
  }

  /**
   * Validates a single action against hard operational constraints before execution.
   *
   * Enforced constraints (all configurable via environment variables):
   *   - max_actions_per_cycle  (MAX_ACTIONS_PER_CYCLE, default 10)
   *   - allowed_tools          (RULE_ALLOWED_TOOLS, comma-separated; empty = allow all)
   *   - risk_threshold         (RISK_THRESHOLD, 0–100, default 90)
   *   - timeout limits         (ACTION_TIMEOUT_MS, default 5000 ms)
   *
   * Returns `{ allowed: true, reason: ... }` when the action may proceed, or
   * `{ allowed: false, reason: ... }` when it must be skipped.
   */
  validate(action: any): ValidationResult {
    // ── Hard constraint 1: max_actions_per_cycle ──────────────────────────────
    const maxActions = getMaxActionsPerCycle();
    if (this.cycleActionCount >= maxActions) {
      return {
        allowed: false,
        reason: `Cycle action limit reached (max ${maxActions} actions per cycle)`,
      };
    }

    // ── Hard constraint 2: allowed_tools ──────────────────────────────────────
    const allowedToolsEnv = process.env.RULE_ALLOWED_TOOLS ?? '';
    const allowedTools = allowedToolsEnv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedTools.length > 0) {
      const tool: string | undefined = action?.tool;
      if (!tool || !allowedTools.includes(tool)) {
        return {
          allowed: false,
          reason: `Tool '${tool ?? '(none)'}' is not in the RULE_ALLOWED_TOOLS allowlist`,
        };
      }
    }

    // ── Hard constraint 3: risk_threshold ─────────────────────────────────────
    const riskThreshold = getRiskThreshold();
    const riskScore: number = action?.risk ?? action?.score ?? 0;
    if (riskScore > riskThreshold) {
      return {
        allowed: false,
        reason: `Action risk score ${riskScore} exceeds risk threshold ${riskThreshold}`,
      };
    }

    // ── Hard constraint 4: timeout limits ─────────────────────────────────────
    const maxTimeoutMs = getActionTimeoutMs();
    if (action?.timeout !== undefined && Number(action.timeout) > maxTimeoutMs) {
      return {
        allowed: false,
        reason: `Action timeout ${action.timeout}ms exceeds maximum allowed ${maxTimeoutMs}ms`,
      };
    }

    this.cycleActionCount++;
    return { allowed: true, reason: 'All constraints satisfied' };
  }

  /**
   * Applies hard constraints and filters to decide on actions.
   * Uses CONFIDENCE_THRESHOLD (env: CONFIDENCE_THRESHOLD, default 60) as the
   * minimum score required to engage, and DECISION_AGGRESSIVENESS (0–1) to
   * stochastically suppress low-confidence signals when the agent is in
   * a conservative posture.
   */
  apply(scoredItems: any[]): Action[] {
    const actions: Action[] = [];
    const CONFIDENCE_THRESHOLD = getConfidenceThreshold();
    const DECISION_AGGRESSIVENESS = getDecisionAggressiveness();

    for (const item of scoredItems) {
      // Threshold gatekeeping — respects the tunable confidence threshold
      if (item.score > CONFIDENCE_THRESHOLD) {
        // Aggressiveness gate: conservative agents skip actions that only barely
        // pass the threshold unless the aggressiveness is high enough.
        const normalised = Math.min((item.score - CONFIDENCE_THRESHOLD) / (100 - CONFIDENCE_THRESHOLD), 1);
        if (normalised >= (1 - DECISION_AGGRESSIVENESS)) {
          actions.push({
            action: 'engage',
            target: item
          });
        }
      }
      
      // Safety rule: Never engage with high-risk looking sources without extreme score
      if (item.score > 90) {
         actions.push({
           action: 'priority_alert',
           target: item
         });
      }
    }

    return actions;
  }
}
