/**
 * Strategy Configuration — Phase 5: Self-Evolution System
 * ─────────────────────────────────────────────────────────
 * Defines the tunable operating parameters that the agent is allowed to adapt
 * over time.  Only the fields listed in MUTABLE_STRATEGY_FIELDS may be written
 * by the controller's self-evolution logic; all other updates are rejected.
 *
 * exploration_rate  – 0.0–1.0: proportion of cycles spent exploring new
 *                    strategies rather than exploiting known-good ones.
 * risk_tolerance    – 0.0–1.0: how much downside the agent accepts before
 *                    switching strategy; mirrors the RulesEngine risk gate.
 * tool_preference   – per-tool weight map (0.0–1.0).  Higher values increase
 *                    the likelihood of the named tool being selected.
 */

export interface ToolPreference {
  [toolName: string]: number;
}

export interface StrategyConfig {
  exploration_rate: number;
  risk_tolerance: number;
  tool_preference: ToolPreference;
}

/**
 * Fields the Controller is permitted to mutate via `updateStrategy()`.
 * Any key not in this list will be silently ignored.
 */
export const MUTABLE_STRATEGY_FIELDS: ReadonlyArray<keyof StrategyConfig> = [
  'exploration_rate',
  'risk_tolerance',
  'tool_preference',
] as const;

/** Factory — returns a fresh deep copy of the default strategy config. */
export function defaultStrategyConfig(): StrategyConfig {
  return {
    exploration_rate: 0.2,
    risk_tolerance: 0.5,
    tool_preference: {},
  };
}

/** Returns a deep copy of a StrategyConfig so mutations never share references. */
export function cloneStrategyConfig(config: StrategyConfig): StrategyConfig {
  return {
    exploration_rate: config.exploration_rate,
    risk_tolerance: config.risk_tolerance,
    tool_preference: { ...config.tool_preference },
  };
}
