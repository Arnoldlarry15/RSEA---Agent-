import type { MemorySystem } from '../memory';
import type { StrategyConfig } from '../strategy/config';

/** Snapshot of GoalManager state that can be serialised and restored. */
export interface PersistedGoalState {
  primary: string;
  subTasks: string[];
  status: string;
  successCriteria: string[];
}

/** Full agent state stored across restarts. */
export interface PersistedAgentState {
  goals: PersistedGoalState;
  /** Last ranked plan produced by the Planner/Evaluator, or null if unavailable. */
  activePlan: any[] | null;
  /**
   * Most recently committed strategy version.
   * Stored for audit/recovery purposes; full config restoration is handled
   * by the Controller on its next cycle.
   */
  strategyVersion: {
    version: string;
    config: StrategyConfig;
  } | null;
  savedAt: string;
}

const STATE_KEY = '__agent_runtime_state__';

/**
 * Thin persistence layer that serialises agent state into the long-term
 * memory store so the agent can pick up where it left off after a restart.
 *
 * Uses the existing MemorySystem.remember() / recall() API so no additional
 * database schema changes are required.
 */
export class AgentStatePersistence {
  constructor(private readonly memory: MemorySystem) {}

  /** Persist the current agent state. */
  save(state: PersistedAgentState): void {
    this.memory.remember(STATE_KEY, state);
  }

  /**
   * Load the last persisted state.
   * Returns `null` when no prior state exists (first boot or cleared state).
   */
  load(): PersistedAgentState | null {
    return (this.memory.recall(STATE_KEY) as PersistedAgentState | undefined) ?? null;
  }

  /** Remove any previously stored state (e.g. after a deliberate reset). */
  clear(): void {
    this.memory.remember(STATE_KEY, null);
  }
}
