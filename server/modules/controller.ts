import { Spotter } from './spotter';
import { Planner } from './planner';
import { Evaluator } from './evaluator';
import { Sniper } from './sniper';
import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';
import { MemoryRetriever } from '../memory/retriever';
import { Observer } from '../core/observation/observer';
import { Comparator } from '../core/evaluation/comparator';
import { OutcomeVerifier } from '../core/evaluation/verifier';
import { PreExecutionRiskGate } from '../core/risk/gate';
import { RulesEngine } from '../core/rules';
import { logEvent } from '../utils/logger';
import { sanitizeContent } from '../utils/sanitize';
import {
  StrategyConfig,
  MUTABLE_STRATEGY_FIELDS,
  defaultStrategyConfig,
  cloneStrategyConfig,
} from '../core/strategy/config';
import { StrategyVersioning } from '../core/strategy/versioning';
import { RedTeamOrchestrator, AdversarialResult } from '../core/adversarial/red_team';

/**
 * Minimum number of evaluation scores that must be collected before the
 * auto-rollback logic will fire.  Prevents premature rollbacks in the first
 * few cycles when the sample size is too small to be meaningful.
 */
const MIN_SCORES_FOR_ROLLBACK = 3;

/**
 * If the latest cycle's average evaluation score falls this many points below
 * the long-run average, the strategy is automatically rolled back.
 */
const ROLLBACK_DROP_THRESHOLD = 20;

export class Controller {
  private spotter: Spotter;
  private planner: Planner;
  private evaluator: Evaluator;
  private sniper: Sniper;
  private observer: Observer;
  private comparator: Comparator;
  private verifier: OutcomeVerifier;
  private riskGate: PreExecutionRiskGate;
  /**
   * Shared RulesEngine instance — created once per Controller and reset at
   * the start of every cycle.  Passing it down to the Sniper (and then to the
   * Executor) ensures that the MAX_ACTIONS_PER_CYCLE counter accumulates
   * correctly across all parallel / sequential sniper calls within one cycle.
   */
  private rulesEngine: RulesEngine;
  private llm: LLMInterface;
  private memory: MemorySystem;

  // Self-Modification Layer configuration
  private globalPromptModifiers: string[] = [
    "Prioritize capital preservation.",
    "Look for asymmetric bets."
  ];

  /** AUDIT-1: Deterministic self-modification schedule — trigger every N cycles. */
  private cycleCount: number = 0;
  private static readonly SELF_MODIFY_EVERY_N_CYCLES = 10;

  /**
   * Phase 7 adversarial cycle runs every N normal cycles to stress-test the
   * current strategy.  Wired into runCycle() so it fires automatically.
   */
  private static readonly ADVERSARIAL_EVERY_N_CYCLES = 20;

  // ── Phase 5: Self-Evolution ──────────────────────────────────────────────
  private strategyConfig: StrategyConfig = defaultStrategyConfig();
  private readonly strategyVersioning: StrategyVersioning = new StrategyVersioning();
  /** Rolling list of all evaluation scores across cycles (used for rollback). */
  private evaluationScores: number[] = [];

  constructor(llm: LLMInterface, memory: MemorySystem, retriever?: MemoryRetriever) {
    this.llm = llm;
    this.memory = memory;
    this.spotter = new Spotter();
    this.planner = new Planner(this.llm, this.memory, retriever);
    this.evaluator = new Evaluator(this.llm);
    this.rulesEngine = new RulesEngine();
    this.sniper = new Sniper(this.rulesEngine);
    this.observer = new Observer();
    this.comparator = new Comparator();
    this.verifier = new OutcomeVerifier();
    this.riskGate = new PreExecutionRiskGate();

    // Commit the initial baseline so rollback always has a safe target.
    this.strategyVersioning.commit('initial baseline', 0, this.strategyConfig);
  }

  async runCycle(objective: string, context: any[]) {
    this.cycleCount++;
    // Reset the shared RulesEngine counter so the MAX_ACTIONS_PER_CYCLE cap
    // applies cleanly to this cycle rather than carrying over from the last.
    this.rulesEngine.resetCycle();

    // 1. Observe
    const observations = await this.spotter.scan();
    
    // Self-Modification trigger check based on recent performance
    await this.selfModifyPrompts(context);

    // 2. Plan — pass exploration_rate so the Planner adjusts memory injection depth.
    const plan = await this.planner.decomposeTask(
      objective,
      [...observations, ...context, ...this.globalPromptModifiers],
      this.strategyConfig.exploration_rate,
    );
    logEvent('controller_plan', plan);

    // 3. Evaluate Strategies (we treat tasks as potential separate strategies here for parallel attempts)
    const rankedTasks = await this.evaluator.rankStrategies(objective, plan.tasks);

    // 4. Act — run parallel tasks concurrently, single-fire for the rest.
    //    Pass tool_preference so the Sniper can select the best-weighted tool when a
    //    task does not specify one explicitly.
    //
    //    Phase 9: PreExecutionRiskGate runs BEFORE each Sniper call.  Any task whose
    //    risk score exceeds the hard block threshold is converted to a blocked result
    //    immediately — without reaching the Sniper or Executor — so the system
    //    prevents obvious failures rather than only learning from them afterward.
    const results = [];
    if (rankedTasks.length > 0) {
      const parallelTasks = rankedTasks.filter((t: any) => t.parallelNode === true);
      if (parallelTasks.length > 1) {
        // Execute all parallel-flagged top tasks concurrently — gate each first.
        const parallelResults = await Promise.all(
          parallelTasks.map((t: any) => this._executeWithRiskGate(t))
        );
        for (const r of parallelResults) results.push(...r);
      } else {
        // Single-fire: execute only the top-ranked task after gating.
        const topTask = rankedTasks[0];
        const strikeResult = await this._executeWithRiskGate(topTask);
        results.push(...strikeResult);
      }
    }

    // 5. Observe, Verify & Compare — build the reality feedback loop.
    //    Phase 8: OutcomeVerifier performs a secondary integrity check on every
    //    result before the Comparator scores it, so that status/outcome
    //    mismatches are flagged and stored in memory rather than silently trusted.
    //
    //    G5: When the executor returns a dry_run result (DRY_RUN=true), execution
    //    feedback is unavailable so the binary comparator always scores 0.  Instead,
    //    use the evaluator's pre-execution task score as a proxy so that the
    //    auto-rollback mechanism has meaningful signal even in dry-run mode.
    const evaluations = results.map((result: any, index: number) => {
      const task = rankedTasks[index];
      if (!task) {
        logEvent('controller_evaluation_skipped', { reason: 'no matching task for result index', index });
        return null;
      }
      const expected = task.expected ?? task.description ?? 'NO_EXPECTED_OUTCOME';
      const observation = this.observer.observe(result);

      // Phase 8: secondary integrity check — detect status/outcome mismatches.
      const verification = this.verifier.verify(result);
      if (!verification.verified) {
        logEvent('controller_verification_failed', {
          taskId: task.id,
          flags: verification.flags,
          verificationConfidence: verification.confidence,
        });
      }

      const isDryRunResult = result?.status === 'dry_run';
      const evaluation = isDryRunResult && typeof task.score === 'number'
        ? {
            success: false,
            score: task.score,
            confidence: 0.0,
            delta: `DRY_RUN: using evaluator pre-execution score (${task.score}) as proxy`,
          }
        : this.comparator.compare(expected, observation);

      logEvent('controller_evaluation', { taskId: task.id, expected, observation, evaluation, verification });
      return { taskId: task.id, tool: task.tool ?? 'unknown', expected, observation, evaluation, verification };
    }).filter((ev): ev is NonNullable<typeof ev> => ev !== null);

    // 6. Persist evaluations into memory so the agent learns from outcomes.
    //    Phase 8: confidence and verification metadata are stored alongside
    //    each evaluation so downstream memory retrieval can weight trustworthy
    //    outcomes more heavily than unverified or low-confidence ones.
    for (const ev of evaluations) {
      this.memory.addEvent({
        type: 'evaluation',
        taskId: ev.taskId,
        tool: ev.tool,
        expected: ev.expected,
        actual: ev.observation.actual_outcome,
        success: ev.evaluation.success,
        score: ev.evaluation.score,
        delta: ev.evaluation.delta,
        confidence: ev.evaluation.confidence ?? null,
        verified: ev.verification.verified,
        verificationFlags: ev.verification.flags,
      });
    }

    // 7. Phase 5: check for strategy performance degradation and auto-rollback
    const cycleScores = evaluations
      .map((ev) => typeof ev.evaluation.score === 'number' ? ev.evaluation.score : null)
      .filter((s): s is number => s !== null);
    if (cycleScores.length > 0) {
      this.checkAndRollbackStrategy(cycleScores);
    }

    // 8. Phase 7: run the adversarial red-team cycle on schedule (every N cycles).
    //    Errors are caught so a failing adversarial cycle never breaks a normal run.
    if (this.cycleCount % Controller.ADVERSARIAL_EVERY_N_CYCLES === 0) {
      this.runAdversarialCycle(objective).catch((err: Error) => {
        logEvent('adversarial_cycle_error', { error: err.message, cycleCount: this.cycleCount });
      });
    }

    return { observations, plan: rankedTasks, results, evaluations };
  }

  /**
   * Runs the PreExecutionRiskGate for a task and either delegates to the Sniper
   * (when the gate allows) or returns a synthetic blocked result (when the gate
   * rejects) — without involving the Executor at all.
   */
  private async _executeWithRiskGate(task: any): Promise<any[]> {
    const riskAssessment = this.riskGate.assess(task, this.memory, this.strategyConfig);
    if (!riskAssessment.allowed) {
      logEvent('risk_gate_blocked', {
        taskId: task.id,
        riskScore: riskAssessment.riskScore,
        reason: riskAssessment.reason,
        factors: riskAssessment.factors,
      });
      return [{
        status: 'blocked',
        timestamp: new Date().toISOString(),
        action: task,
        outcome: `Pre-execution risk gate: ${riskAssessment.reason}`,
        priority: 'STANDARD',
        result: null,
        success: false,
        error: riskAssessment.reason,
        side_effects: [],
        confidence: 0,
        riskScore: riskAssessment.riskScore,
      }];
    }
    return this.sniper.executeSurgicalStrike(task, this.strategyConfig.tool_preference);
  }

  /**
   * Collects the cycle's evaluation scores and triggers an automatic rollback
   * when performance has dropped significantly below the historical mean.
   */
  private checkAndRollbackStrategy(cycleScores: number[]): void {
    const cycleAvg = cycleScores.reduce((a, b) => a + b, 0) / cycleScores.length;
    this.evaluationScores.push(...cycleScores);

    if (this.evaluationScores.length < MIN_SCORES_FOR_ROLLBACK) return;

    const allAvg =
      this.evaluationScores.reduce((a, b) => a + b, 0) / this.evaluationScores.length;

    if (cycleAvg < allAvg - ROLLBACK_DROP_THRESHOLD) {
      const restored = this.strategyVersioning.rollback();
      if (restored) {
        this.strategyConfig = restored;
        logEvent('strategy_rollback', {
          reason: 'performance_drop',
          cycleAvg,
          historicalAvg: allAvg,
          restoredVersion: this.strategyVersioning.getCurrent()?.version,
        });
      }
    }
  }

  /**
   * Self-Modification Layer
   * Allows the agent to adjust its own system prompts and operating parameters.
   * AUDIT-3: Requires ALLOW_SELF_MODIFICATION=true and DRY_RUN=false to take effect.
   *          All modifier changes are logged at CRITICAL level.
   */
  async selfModifyPrompts(recentContext: any[]) {
    if (!this.llm.healthCheck()) return;
    // AUDIT-1: Use deterministic cycle-based schedule instead of Math.random()
    if ((this.cycleCount % Controller.SELF_MODIFY_EVERY_N_CYCLES) !== 0) return;

    // AUDIT-3: Gate behind explicit opt-in flag (read dynamically to support test env overrides)
    const allowSelfMod = (process.env.ALLOW_SELF_MODIFICATION ?? '').toLowerCase() === 'true';
    if (!allowSelfMod) {
      logEvent('self_modification_skipped', { reason: 'ALLOW_SELF_MODIFICATION not set' });
      return;
    }

    const dryRun = (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
    if (dryRun) {
      logEvent('self_modification_skipped', { reason: 'DRY_RUN=true; skipping self-modification' });
      return;
    }

    try {
      const updatedModifiers = await this.llm.generateModifiers(recentContext, this.globalPromptModifiers);
      if (updatedModifiers && Array.isArray(updatedModifiers)) {
        // Sanitize every modifier string to prevent prompt-injection via a
        // compromised LLM response from polluting the strategic instruction set.
        const MAX_MODIFIER_LENGTH = 500;
        const sanitized = updatedModifiers
          .map((m: string) => (typeof m === 'string' ? sanitizeContent(m).slice(0, MAX_MODIFIER_LENGTH) : null))
          .filter((m): m is string => m !== null && m.trim().length > 0);
        if (sanitized.length > 0) {
          logEvent('self_modification', {
            severity: 'CRITICAL',
            previous: [...this.globalPromptModifiers],
            updated: sanitized,
          });
          this.globalPromptModifiers = sanitized;
        }
      }
    } catch (e) {
      logEvent('self_modification_error', { error: String(e) });
    }
  }

  getModifiers() {
    return this.globalPromptModifiers;
  }

  // ── Phase 5: Strategy Management ──────────────────────────────────────────

  /**
   * Applies a partial strategy update — **only** the fields listed in
   * MUTABLE_STRATEGY_FIELDS (exploration_rate, risk_tolerance, tool_preference)
   * are accepted; all other keys are silently ignored.
   *
   * Every accepted update is committed to the StrategyVersioning history so
   * it can be rolled back at any time.
   *
   * @param updates  Partial StrategyConfig with new values.
   * @param change   Human-readable description of the change (stored in history).
   * @param impact   Estimated impact score (+/- numeric delta) for the change.
   */
  updateStrategy(
    updates: Partial<StrategyConfig>,
    change: string,
    impact: number,
  ): void {
    const next = cloneStrategyConfig(this.strategyConfig);

    // Build a filtered update containing only mutable fields, then merge.
    const filteredEntries = (Object.keys(updates) as Array<keyof StrategyConfig>)
      .filter((k): k is typeof MUTABLE_STRATEGY_FIELDS[number] =>
        (MUTABLE_STRATEGY_FIELDS as ReadonlyArray<string>).includes(k),
      )
      .map((k) => [k, updates[k]] as const);

    if (filteredEntries.length === 0) return;

    Object.assign(next, Object.fromEntries(filteredEntries));

    this.strategyConfig = next;
    const committed = this.strategyVersioning.commit(change, impact, this.strategyConfig);
    logEvent('strategy_updated', { version: committed.version, change, impact });
  }

  /** Returns a deep copy of the currently active StrategyConfig. */
  getStrategy(): StrategyConfig {
    return cloneStrategyConfig(this.strategyConfig);
  }

  /** Returns the full version history from the StrategyVersioning system. */
  getStrategyHistory() {
    return this.strategyVersioning.getHistory();
  }

  // ── Phase 7: Adversarial Intelligence ─────────────────────────────────────

  /**
   * Runs a complete adversarial (red-team) cycle against the top observation
   * from the Spotter.  The 5-step flow is:
   *
   *   1. Spotter proposes an opportunity
   *   2. Sniper creates an execution plan
   *   3. Red-team Validator tries to break the plan
   *   4. Evaluator scores robustness
   *   5. Controller updates strategy based on the composite score
   *
   * Best strategies are persisted to long-term memory; failed attack patterns
   * are also stored so the agent can avoid repeating the same vulnerabilities.
   *
   * @param objective  Human-readable description of the current goal (used as
   *                   a fallback opportunity description when Spotter has no data).
   */
  async runAdversarialCycle(objective: string): Promise<AdversarialResult> {
    const observations = await this.spotter.scan();

    const opportunity = observations[0] ?? {
      id: `opp_${Date.now()}`,
      description: objective,
      tool: 'simulate',
    };

    const redTeam = new RedTeamOrchestrator(this.llm, this.memory);
    const result = await redTeam.run(opportunity);

    // Adjust risk_tolerance based on the composite robustness score:
    //   High robustness → slightly more aggressive (raise tolerance)
    //   Low robustness  → more conservative (lower tolerance)
    const { overall } = result.score;
    if (overall >= 70) {
      this.updateStrategy(
        { risk_tolerance: Math.min(1.0, this.strategyConfig.risk_tolerance + 0.05) },
        `Adversarial cycle: high robustness (${overall})`,
        overall,
      );
    } else if (overall < 40) {
      this.updateStrategy(
        { risk_tolerance: Math.max(0.1, this.strategyConfig.risk_tolerance - 0.05) },
        `Adversarial cycle: low robustness (${overall})`,
        -overall,
      );
    }

    logEvent('adversarial_cycle_complete', {
      opportunityId: opportunity.id,
      robustnessScore: result.robustnessScore,
      overallScore: overall,
      strategyUpdate: result.strategyUpdate,
    });

    return result;
  }
}
