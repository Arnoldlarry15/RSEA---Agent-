import { LLMInterface } from '../cognition/llm';
import { Controller } from '../modules/controller';
import { MemorySystem } from './memory';
import { GoalManager } from './goals';
import { Reflector } from './reflector';
import { AgentState } from './state';
import { logEvent } from '../utils/logger';
import type { AgentInput, AgentOutput } from '../interfaces/agent';

export class Agent {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private goals: GoalManager;
  private reflector: Reflector;
  private controller: Controller;
  private manualInstructions: string[] = [];

  private currentState: AgentState = AgentState.IDLE;
  private consecutiveFailures: number = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor() {
    this.llm = new LLMInterface();
    this.memory = new MemorySystem();
    this.goals = new GoalManager();
    this.reflector = new Reflector(this.llm, this.memory, this.goals);
    this.controller = new Controller(this.llm, this.memory);
  }

  async runCycle(): Promise<AgentOutput> {
    const instructions = [...this.manualInstructions];
    this.manualInstructions = [];

    const override = instructions.find(i => i.toLowerCase().includes('override goal:'));
    if (override) {
      this.goals.overridePrimaryGoal(override.split('override goal:')[1].trim());
    }

    // If the goal is already complete, skip execution
    if (this.goals.isComplete()) {
      this.currentState = AgentState.IDLE;
      logEvent('think_and_act', { status: 'goal_complete', skipped: true });
      return { observations: [], plan: [], results: [], state: this.currentState, goalCompleted: true };
    }

    // Enter RECOVERING state when consecutive failures exceed threshold
    if (this.consecutiveFailures >= Agent.MAX_CONSECUTIVE_FAILURES) {
      this.currentState = AgentState.RECOVERING;
      logEvent('agent_recovering', { consecutiveFailures: this.consecutiveFailures });
    }

    this.currentState = AgentState.PLANNING;
    const currentGoals = this.goals.getGoals();

    let cycleData: any;
    try {
      this.currentState = AgentState.EXECUTING;
      cycleData = await this.controller.runCycle(currentGoals.primary, instructions);
      this.consecutiveFailures = 0;
    } catch (err: any) {
      this.consecutiveFailures++;
      this.currentState = AgentState.RECOVERING;
      logEvent('agent_cycle_error', { error: err.message, consecutiveFailures: this.consecutiveFailures });

      // Mark goal as failed after too many consecutive failures
      if (this.consecutiveFailures >= Agent.MAX_CONSECUTIVE_FAILURES) {
        this.goals.markFailed();
        logEvent('agent_goal_failed', { reason: 'max_consecutive_failures' });
      }
      throw err;
    }

    this.currentState = AgentState.EVALUATING;
    this.memory.addEvent({ type: 'orchestrated_cycle', data: cycleData, instructions });
    logEvent('think_and_act', { cycleData, instructions });

    // Detect goal completion: all results succeeded and none failed
    const allSucceeded = cycleData.results.length > 0 &&
      cycleData.results.every((r: any) => r.status !== 'failed');
    const goalCompleted = this.goals.isComplete() || (allSucceeded && cycleData.results.some((r: any) => r.outcome?.includes('completed')));
    if (goalCompleted && !this.goals.isComplete()) {
      this.goals.markCompleted();
      logEvent('agent_goal_completed', { goal: currentGoals.primary });
    }

    // Reflect: pass observations, ranked plan, actual execution results, and result metadata
    await this.reflector.reflect(cycleData.observations, cycleData.plan, cycleData.results, cycleData.results);

    this.currentState = AgentState.IDLE;
    return {
      observations: cycleData.observations,
      plan: cycleData.plan,
      results: cycleData.results,
      state: this.currentState,
      goalCompleted: this.goals.isComplete()
    };
  }

  addInstruction(text: string) {
    this.manualInstructions.push(text);
    this.memory.addEvent({ type: 'user_command', data: text });
    logEvent('command', text);
  }

  processInput(input: AgentInput) {
    if (input.instruction) this.addInstruction(input.instruction);
    if (input.goal) this.addInstruction(`override goal: ${input.goal}`);
  }

  getState(): AgentState {
    return this.currentState;
  }

  getMemory() {
    return this.memory;
  }

  getGoals() {
    return this.goals;
  }

  checkHealth() {
    const isDbHealthy = this.memory.healthCheck();
    return {
      status: isDbHealthy ? 'healthy' : 'unhealthy',
      components: {
        database: isDbHealthy ? 'connected' : 'disconnected',
        llm: this.llm.healthCheck() ? 'connected' : 'simulation_mode'
      }
    };
  }
}
