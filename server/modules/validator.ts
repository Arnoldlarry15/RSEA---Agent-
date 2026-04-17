import { logEvent } from '../utils/logger';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Tools the agent is permitted to invoke. */
const ALLOWED_TOOLS = new Set(['simulate', 'api_fetch', 'code_eval', 'system_command']);

/** Parameters that must be present (non-null/undefined) for a given tool. */
const REQUIRED_PARAMS: Record<string, string[]> = {
  api_fetch: ['url'],
  code_eval: ['code'],
  system_command: ['command'],
};

/**
 * Zero-trust LLM output gate.
 * Validates every action produced by the LLM before it reaches the Executor.
 */
export class ToolValidator {
  /**
   * Validates a single action object.
   * Returns `{ valid: true }` when the action is safe to execute, or
   * `{ valid: false, reason: string }` when it must be rejected.
   */
  validate(action: any): ValidationResult {
    if (!action || typeof action !== 'object') {
      return { valid: false, reason: 'Action is null or not an object' };
    }

    const tool = action.tool;
    if (!tool || typeof tool !== 'string') {
      return { valid: false, reason: 'Missing or invalid tool field' };
    }

    if (!ALLOWED_TOOLS.has(tool)) {
      logEvent('validator_blocked', { reason: `Tool '${tool}' not in whitelist`, action });
      return { valid: false, reason: `Tool '${tool}' is not in the allowed tools whitelist` };
    }

    const requiredParams = REQUIRED_PARAMS[tool];
    if (requiredParams) {
      const payload = action.payload ?? {};
      for (const param of requiredParams) {
        if (payload[param] === undefined || payload[param] === null) {
          logEvent('validator_blocked', { reason: `Missing param '${param}' for tool '${tool}'`, action });
          return { valid: false, reason: `Tool '${tool}' is missing required parameter '${param}'` };
        }
      }
    }

    return { valid: true };
  }
}
