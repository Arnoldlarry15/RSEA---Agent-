import { Executor } from './executor';
import { RulesEngine } from '../core/rules';
import { ToolValidator } from './validator';
import { logEvent } from '../utils/logger';

export class Sniper {
  private executor: Executor;
  private rulesEngine: RulesEngine;
  private validator: ToolValidator;

  constructor() {
    this.executor = new Executor();
    this.rulesEngine = new RulesEngine();
    this.validator = new ToolValidator();
  }

  async executeSurgicalStrike(task: any) {
    logEvent('sniper_engage', { target: task });

    // Gate through RulesEngine — only tasks scoring > 60 proceed
    const approvedActions = this.rulesEngine.apply([task]);
    if (approvedActions.length === 0) {
      logEvent('sniper_blocked', { reason: 'RulesEngine score threshold not met', task });
      return [{ status: 'blocked', timestamp: new Date().toISOString(), action: task, outcome: 'Task blocked by RulesEngine (score <= 60)', priority: 'STANDARD' }];
    }

    // Convert task into executable actions
    const action = {
      action: approvedActions.some(a => a.action === 'priority_alert') ? 'priority_alert' : 'surgical_strike',
      tool: task.tool || 'simulate',
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
