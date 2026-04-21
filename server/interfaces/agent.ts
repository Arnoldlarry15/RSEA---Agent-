/** A discrete action request produced by the LLM and validated before execution. */
export interface ActionRequest {
  tool: string;
  action: string;
  payload: Record<string, unknown>;
}

/** The execution result for a single ActionRequest. */
export interface ActionResult {
  status: 'executed' | 'simulated' | 'blocked' | 'failed';
  timestamp: string;
  action: ActionRequest;
  outcome: string;
  priority: 'CRITICAL' | 'STANDARD';
}

/**
 * A single ranked task produced by the Planner / Evaluator pipeline.
 * Fields beyond the core properties are arbitrary LLM-generated data.
 */
export interface PlanTask {
  /** Unique task identifier. May be absent for externally supplied tasks. */
  id?: string;
  /** Human-readable description. May be absent for externally supplied tasks (e.g. red-team opportunities). */
  description?: string;
  /** Confidence/priority score in the range 0–100. May be absent for externally supplied tasks. */
  score?: number;
  tool?: string;
  payload?: Record<string, unknown>;
  action?: string;
  [key: string]: unknown;
}

/**
 * Structured input that can be fed to the agent from an external caller.
 * Use `addInstruction` on the Agent for inline delivery, or pass via the API layer.
 */
export interface AgentInput {
  /** Optional free-form instruction for the agent (e.g. "override goal: …"). */
  instruction?: string;
  /** Optional goal override delivered together with other context. */
  goal?: string;
  /** Additional context items injected into the planning pipeline. */
  context?: unknown[];
}

/** Structured output produced by a single agent run-cycle. */
export interface AgentOutput {
  /** Raw market/signal observations gathered by the Spotter. */
  observations: unknown[];
  /** Ranked plan tasks as determined by the Planner + Evaluator. */
  plan: PlanTask[];
  /** Execution results from the Sniper / Executor. */
  results: ActionResult[];
  /** The state the agent was in when the cycle completed. */
  state: string;
  /** True when the current primary goal has been detected as completed. */
  goalCompleted: boolean;
}
