/** A discrete action request produced by the LLM and validated before execution. */
export interface ActionRequest {
  tool: string;
  action: string;
  payload: Record<string, any>;
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
 * Structured input that can be fed to the agent from an external caller.
 * Use `addInstruction` on the Agent for inline delivery, or pass via the API layer.
 */
export interface AgentInput {
  /** Optional free-form instruction for the agent (e.g. "override goal: …"). */
  instruction?: string;
  /** Optional goal override delivered together with other context. */
  goal?: string;
  /** Additional context items injected into the planning pipeline. */
  context?: any[];
}

/** Structured output produced by a single agent run-cycle. */
export interface AgentOutput {
  /** Raw market/signal observations gathered by the Spotter. */
  observations: any[];
  /** Ranked plan tasks as determined by the Planner + Evaluator. */
  plan: any[];
  /** Execution results from the Sniper / Executor. */
  results: ActionResult[];
  /** The state the agent was in when the cycle completed. */
  state: string;
  /** True when the current primary goal has been detected as completed. */
  goalCompleted: boolean;
}
