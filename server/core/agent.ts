import { LLMInterface } from '../cognition/llm';
import { Controller } from '../modules/controller';
import { MemorySystem } from './memory';
import { GoalManager } from './goals';
import { Reflector } from './reflector';
import { AgentState } from './state';
import { logEvent } from '../utils/logger';
import type { AgentInput, AgentOutput } from '../interfaces/agent';
import { EpisodicMemory } from '../memory/episodic';
import { SemanticMemory } from '../memory/semantic';
import { StrategicMemory } from '../memory/strategic';
import { MemoryRetriever } from '../memory/retriever';
import { PatternExtractor } from '../memory/patterns';
import { runtimeEvents } from './runtime/events';
import { AgentStatePersistence } from './runtime/persistence';

export class Agent {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private goals: GoalManager;
  private reflector: Reflector;
  private controller: Controller;
  private manualInstructions: string[] = [];

  // Typed memory tiers
  private episodic: EpisodicMemory;
  private semantic: SemanticMemory;
  private strategic: StrategicMemory;
  private retriever: MemoryRetriever;
  private patternExtractor: PatternExtractor;

  private currentState: AgentState = AgentState.IDLE;
  private consecutiveFailures: number = 0;
  private static readonly MAX_CONSECUTIVE_FAILURES = 3;

  /** Run pattern extraction every N cycles to surface learned behaviours. */
  private cycleCount: number = 0;
  private static readonly PATTERN_EXTRACT_EVERY_N_CYCLES = 5;

  /** Last plan produced by the Controller — persisted for restart recovery. */
  private lastActivePlan: any[] | null = null;

  /** Persistence layer for cross-restart state survival. */
  private persistence: AgentStatePersistence;

  constructor() {
    this.llm = new LLMInterface();
    this.memory = new MemorySystem();
    this.goals = new GoalManager();

    // Initialise the three memory tiers backed by the shared MemorySystem
    this.episodic = new EpisodicMemory(this.memory);
    this.semantic = new SemanticMemory(this.memory);
    this.strategic = new StrategicMemory(this.memory);

    // Retriever aggregates all tiers for planner injection
    this.retriever = new MemoryRetriever(this.episodic, this.semantic, this.strategic);

    // Background pattern extractor
    this.patternExtractor = new PatternExtractor(this.episodic, this.semantic, this.strategic);

    this.reflector = new Reflector(this.llm, this.memory, this.goals);
    this.controller = new Controller(this.llm, this.memory, this.retriever);

    // Initialise persistence and attempt to restore state from a previous run
    this.persistence = new AgentStatePersistence(this.memory);
    const savedState = this.persistence.load();
    if (savedState) {
      this.goals.restore(savedState.goals);
      if (savedState.activePlan) {
        this.lastActivePlan = savedState.activePlan;
      }
      logEvent('agent_state_restored', { savedAt: savedState.savedAt });
    }
  }

  async runCycle(): Promise<AgentOutput> {
    const instructions = [...this.manualInstructions];
    this.manualInstructions = [];

    const override = instructions.find(i => i.toLowerCase().includes('override goal:'));
    if (override) {
      const newGoal = override.split('override goal:')[1].trim();
      logEvent('goal_override', {
        severity: 'CRITICAL',
        newGoal,
        previousGoal: this.goals.getGoals().primary,
      });
      this.goals.overridePrimaryGoal(newGoal);
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
        runtimeEvents.emitFailureSpike({
          consecutiveFailures: this.consecutiveFailures,
          lastError: err.message || String(err),
        });
      }
      throw err;
    }

    this.currentState = AgentState.EVALUATING;
    this.memory.addEvent({ type: 'orchestrated_cycle', data: cycleData, instructions });
    logEvent('think_and_act', { cycleData, instructions });

    // Goal completion is driven by explicit markCompleted() calls (e.g. from external signals
    // or future criteria checks) — not by fragile outcome-string matching.
    const goalCompleted = this.goals.isComplete();

    // Reflect: pass observations, ranked plan, extracted action list, and outcome results
    const executedActions = cycleData.results.map((r: any) => r.action);
    await this.reflector.reflect(cycleData.observations, cycleData.plan, executedActions, cycleData.results);

    // Background pattern extraction: runs every N cycles so the agent progressively
    // learns from repeated failures and successful strategies stored in memory.
    this.cycleCount++;
    if (this.cycleCount % Agent.PATTERN_EXTRACT_EVERY_N_CYCLES === 0) {
      const patterns = this.patternExtractor.extract();
      if (patterns.length > 0) {
        logEvent('pattern_extraction', { patternsFound: patterns.length, patterns });
      }
    }

    // Persist state so the agent survives restarts
    this.lastActivePlan = cycleData.plan;
    this.persistence.save({
      goals: {
        primary: currentGoals.primary,
        subTasks: currentGoals.subTasks,
        status: this.goals.getStatus(),
        successCriteria: this.goals.getSuccessCriteria(),
      },
      activePlan: this.lastActivePlan,
      strategyVersion: null,
      savedAt: new Date().toISOString(),
    });

    // Emit opportunity_detected whenever the spotter returns actionable observations
    if (cycleData.observations && cycleData.observations.length > 0) {
      runtimeEvents.emitOpportunityDetected({
        opportunityCount: cycleData.observations.length,
        observations: cycleData.observations,
      });
    }

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
    if (this.manualInstructions.length >= 100) {
      console.warn('[Agent] Instruction queue is full (100 items). Dropping new instruction.');
      return;
    }
    this.manualInstructions.push(text);
    this.memory.addEvent({ type: 'user_command', data: text });
    logEvent('command', text);
    runtimeEvents.emitNewInput({ instruction: text, timestamp: new Date().toISOString() });
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
