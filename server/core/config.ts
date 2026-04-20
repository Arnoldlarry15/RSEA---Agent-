/**
 * Behavior tuning configuration
 * ──────────────────────────────
 * Controls the "feel" of the agent: how aggressively it acts, how confident it
 * must be before executing, and how much it logs.
 *
 * All values are read from environment variables at startup.
 *
 * VERBOSITY_LEVEL        – "silent" | "normal" | "verbose"  (default: "normal")
 * DECISION_AGGRESSIVENESS– 0.0–1.0  (default: 0.5)
 *                          0.0 = very conservative (waits / monitors)
 *                          1.0 = executes on any positive signal
 * CONFIDENCE_THRESHOLD   – 0–100 (default: 60)
 *                          Minimum RulesEngine score required before an action executes.
 *                          Replaces the hard-coded 60 in RulesEngine.
 */

export type VerbosityLevel = 'silent' | 'normal' | 'verbose';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseFloat01(raw: string | undefined, fallback: number): number {
  const parsed = parseFloat(raw ?? '');
  return isNaN(parsed) ? fallback : clamp(parsed, 0, 1);
}

function parseInt0100(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? '', 10);
  return isNaN(parsed) ? fallback : clamp(parsed, 0, 100);
}

const rawVerbosity = () => (process.env.VERBOSITY_LEVEL ?? 'normal').toLowerCase();

/**
 * Returns the current verbosity level, reading from the environment on every
 * call so that tests and runtime env changes are reflected immediately.
 * Use this instead of the deprecated VERBOSITY constant.
 */
export function getVerbosity(): VerbosityLevel {
  const raw = rawVerbosity();
  return raw === 'silent' || raw === 'verbose' ? (raw as VerbosityLevel) : 'normal';
}

/** @deprecated Use getVerbosity() — reads the env dynamically so runtime changes take effect. */
export const VERBOSITY: VerbosityLevel = getVerbosity();

/** 0.0 = extremely conservative, 1.0 = always act. Default: 0.5. Read dynamically so env overrides work at runtime. */
export function getDecisionAggressiveness(): number {
  return parseFloat01(process.env.DECISION_AGGRESSIVENESS, 0.5);
}

/** @deprecated Use getDecisionAggressiveness() — kept for legacy server.ts import. */
export const DECISION_AGGRESSIVENESS: number = getDecisionAggressiveness();

/** Minimum score (0–100) a task must achieve before the RulesEngine allows execution. Read dynamically. */
export function getConfidenceThreshold(): number {
  return parseInt0100(process.env.CONFIDENCE_THRESHOLD, 60);
}

/** @deprecated Use getConfidenceThreshold() — kept for legacy server.ts import. */
export const CONFIDENCE_THRESHOLD: number = getConfidenceThreshold();

/**
 * Maximum number of actions the RulesEngine will approve in a single execution cycle.
 * Env: MAX_ACTIONS_PER_CYCLE (default: 10). Must be a positive integer.
 */
export function getMaxActionsPerCycle(): number {
  const parsed = parseInt(process.env.MAX_ACTIONS_PER_CYCLE ?? '10', 10);
  return isNaN(parsed) || parsed <= 0 ? 10 : parsed;
}

/**
 * Risk threshold (0–100): actions whose risk score exceeds this value are blocked.
 * Env: RISK_THRESHOLD (default: 90).
 */
export function getRiskThreshold(): number {
  return parseInt0100(process.env.RISK_THRESHOLD, 90);
}

/**
 * Maximum per-action timeout in milliseconds.
 * Env: ACTION_TIMEOUT_MS (default: 5000). Must be a positive integer.
 */
export function getActionTimeoutMs(): number {
  const parsed = parseInt(process.env.ACTION_TIMEOUT_MS ?? '5000', 10);
  return isNaN(parsed) || parsed <= 0 ? 5000 : parsed;
}
