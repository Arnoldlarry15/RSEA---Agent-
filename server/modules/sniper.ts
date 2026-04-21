import { Executor } from './executor';
import { RulesEngine } from '../core/rules';
import { ToolValidator } from './validator';
import { logEvent } from '../utils/logger';
import type { ToolPreference } from '../core/strategy/config';
import type { PlanTask } from '../interfaces/agent';

export class Sniper {
  private executor: Executor;
  private rulesEngine: RulesEngine;
  private validator: ToolValidator;

  /**
   * @param rulesEngine Optional shared RulesEngine from the Controller.
   *   When provided the per-cycle action counter is shared across all
   *   Sniper/Executor calls in the same cycle, so the MAX_ACTIONS_PER_CYCLE
   *   cap is correctly enforced end-to-end.  When omitted a fresh instance
   *   is created for standalone use.
   *
   * NOTE: The PreExecutionRiskGate (4-signal composite risk check) is wired
   * at the Controller level in `_executeWithRiskGate()` and always runs
   * before this method is called in the normal execution path.
   */
  constructor(rulesEngine?: RulesEngine) {
    this.rulesEngine = rulesEngine ?? new RulesEngine();
    this.executor = new Executor(undefined, this.rulesEngine);
    this.validator = new ToolValidator();
  }

  /**
   * Executes a single approved task through the full safety pipeline.
   *
   * @param task           Ranked task object from the Evaluator.
   * @param toolPreference Optional per-tool weight map from StrategyConfig.  When the
   *                       task does not specify a tool, the highest-weighted entry from
   *                       this map is chosen instead of the default 'simulate' fallback.
   */
  async executeSurgicalStrike(task: PlanTask, toolPreference?: ToolPreference) {
    logEvent('sniper_engage', { target: task });

    // Gate through RulesEngine — only tasks scoring > 60 proceed
    const approvedActions = this.rulesEngine.apply([task]);
    if (approvedActions.length === 0) {
      logEvent('sniper_blocked', { reason: 'RulesEngine score threshold not met', task });
      return [{ status: 'blocked', timestamp: new Date().toISOString(), action: task, outcome: 'Task blocked by RulesEngine (score <= 60)', priority: 'STANDARD' }];
    }

    // Determine the tool to use.  If the task doesn't specify one, pick the
    // highest-weighted tool from the strategy's tool_preference map (if any),
    // otherwise fall back to 'simulate'.
    let defaultTool = 'simulate';
    if (toolPreference && Object.keys(toolPreference).length > 0) {
      const [preferredTool] = Object.entries(toolPreference).sort((a, b) => b[1] - a[1]);
      if (preferredTool) defaultTool = preferredTool[0];
    }

    // Convert task into executable actions
    const action = {
      action: approvedActions.some(a => a.action === 'priority_alert') ? 'priority_alert' : 'surgical_strike',
      tool: task.tool || defaultTool,
      payload: task.payload || { info: task.description }
    };

    // Zero-trust LLM gate — validate before execution
    const validation = this.validator.validate(action);
    if (!validation.valid) {
      logEvent('sniper_blocked', { reason: validation.reason, task });
      return [{ status: 'blocked', timestamp: new Date().toISOString(), action: task, outcome: `Action blocked by ToolValidator: ${validation.reason}`, priority: 'STANDARD' }];
    }

    // Use executor layer to do the physical execution
    return await this.executor.execute([action]);
  }
}
