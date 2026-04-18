/** Structured output returned by every tool execution. */
export interface ToolResult {
  /** The primary output data produced by the tool. */
  result: any;
  /** Whether the tool executed successfully. */
  success: boolean;
  /** Human-readable error message, or null when successful. */
  error: string | null;
  /** Observable side-effects produced during execution (e.g. file writes, HTTP calls). */
  side_effects: Record<string, any>[];
  /** Confidence score in [0, 1] — 1.0 means deterministic success. */
  confidence: number;
}

/**
 * Base class for all agent tools.
 * Subclasses must declare a unique `name`, a human-readable `description`,
 * and implement `execute()`.
 */
export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract execute(input_data: Record<string, any>): Promise<ToolResult>;
}
