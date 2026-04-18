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

const rawVerbosity = (process.env.VERBOSITY_LEVEL ?? 'normal').toLowerCase();
export const VERBOSITY: VerbosityLevel =
  rawVerbosity === 'silent' || rawVerbosity === 'verbose'
    ? (rawVerbosity as VerbosityLevel)
    : 'normal';

/** 0.0 = extremely conservative, 1.0 = always act (original behaviour). Default: 1.0 */
export const DECISION_AGGRESSIVENESS: number = parseFloat01(
  process.env.DECISION_AGGRESSIVENESS,
  1.0
);

/** Minimum score (0–100) a task must achieve before the RulesEngine allows execution. */
export const CONFIDENCE_THRESHOLD: number = parseInt0100(
  process.env.CONFIDENCE_THRESHOLD,
  60
);
