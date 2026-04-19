/**
 * Strategy Versioning — Phase 5: Self-Evolution System
 * ──────────────────────────────────────────────────────
 * Maintains an ordered history of StrategyConfig snapshots so that the agent
 * can roll back to a prior configuration if a strategy update degrades
 * performance.
 *
 * Each committed entry captures:
 *   version  – semantic label, e.g. "v1.3"
 *   change   – human-readable description of what was modified
 *   impact   – numeric delta score observed after applying the change
 *   config   – full deep-copy of the StrategyConfig at commit time
 *   timestamp – ISO-8601 wall-clock at the moment of commit
 *
 * Usage:
 *   const versioning = new StrategyVersioning();
 *   versioning.commit('Raised risk_tolerance to 0.7', 5, newConfig);
 *   // … later, if performance degrades …
 *   const restored = versioning.rollback(); // returns previous config or null
 */

import { StrategyConfig, cloneStrategyConfig } from './config';

export interface StrategyVersion {
  version: string;
  change: string;
  impact: number;
  config: StrategyConfig;
  timestamp: string;
}

export class StrategyVersioning {
  private history: StrategyVersion[] = [];
  private versionMinor: number = 0;
  private readonly versionMajor: number;

  constructor(versionMajor: number = 1) {
    this.versionMajor = versionMajor;
  }

  /**
   * Snapshots the current config and appends it to the version history.
   * Returns the newly created StrategyVersion record.
   */
  commit(change: string, impact: number, config: StrategyConfig): StrategyVersion {
    this.versionMinor += 1;
    const entry: StrategyVersion = {
      version: `v${this.versionMajor}.${this.versionMinor}`,
      change,
      impact,
      config: cloneStrategyConfig(config),
      timestamp: new Date().toISOString(),
    };
    this.history.push(entry);
    return entry;
  }

  /**
   * Removes the most recent version and returns the restored StrategyConfig.
   * Returns `null` if there is no previous version to roll back to
   * (i.e. history has fewer than two entries).
   */
  rollback(): StrategyConfig | null {
    if (this.history.length < 2) return null;
    this.history.pop();
    this.versionMinor -= 1;
    const previous = this.history[this.history.length - 1];
    return cloneStrategyConfig(previous.config);
  }

  /** Returns the most recent StrategyVersion, or `null` if nothing committed yet. */
  getCurrent(): StrategyVersion | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  /** Returns a shallow copy of the full version history (oldest first). */
  getHistory(): StrategyVersion[] {
    return [...this.history];
  }
}
