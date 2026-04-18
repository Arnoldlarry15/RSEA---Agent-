import { Agent } from './agent';
import { newTraceId, setTraceId, logEvent } from '../utils/logger';

/** Maximum wall-clock time (ms) a single agent cycle may run before being killed. */
const CYCLE_TIMEOUT_MS = parseInt(process.env.CYCLE_TIMEOUT_MS ?? '30000', 10);

export class AgentLoop {
  private agent: Agent;
  private isRunning: boolean = false;
  private interval: number = 10000;
  private timer: NodeJS.Timeout | null = null;
  
  /** Per-cycle kill switch: set to true to halt the loop immediately on next step. */
  private killSwitch: boolean = false;

  // Telemetry for Debugging
  private cycleCount: number = 0;
  private lastError: string | null = null;
  private lastExecutionTime: number = 0;

  // Recovery tracking
  private consecutiveFailures: number = 0;
  private static readonly RECOVERY_INTERVAL_MS = 30000;
  private static readonly MAX_FAILURES_BEFORE_BACKOFF = 3;

  constructor() {
    this.agent = new Agent();
  }

  async step() {
    if (this.killSwitch) {
      logEvent('loop_kill_switch', { reason: 'Kill switch is active — cycle skipped' });
      return;
    }
    const traceId = newTraceId();
    const startTime = Date.now();
    console.log("\n--- New Cycle ---", `[trace:${traceId}]`);
    try {
      this.cycleCount++;
      // Race the cycle against a hard timeout to prevent runaway loops
      const cyclePromise = this.agent.runCycle();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Cycle timeout after ${CYCLE_TIMEOUT_MS}ms`)), CYCLE_TIMEOUT_MS)
      );
      await Promise.race([cyclePromise, timeoutPromise]);
      this.lastError = null;
      this.consecutiveFailures = 0;
    } catch (err: any) {
      this.consecutiveFailures++;
      this.lastError = err.message || String(err);
      logEvent('loop_cycle_error', { error: this.lastError, traceId, consecutiveFailures: this.consecutiveFailures });
      console.error("Error in agent cycle:", err);

      // Apply backoff when failures accumulate — widen the next sleep window
      if (this.consecutiveFailures >= AgentLoop.MAX_FAILURES_BEFORE_BACKOFF) {
        console.warn(`[Loop] ${this.consecutiveFailures} consecutive failures — entering recovery backoff`);
      }
    } finally {
      this.lastExecutionTime = Date.now() - startTime;
      // Clear the module-level trace after the cycle so it doesn't bleed into unrelated code
      setTraceId(undefined);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("Agent Heartbeat Started");
    
    const run = async () => {
      if (!this.isRunning) return;
      await this.step();
      // Use a longer interval when the agent is in a failure backoff state
      const nextInterval = this.consecutiveFailures >= AgentLoop.MAX_FAILURES_BEFORE_BACKOFF
        ? AgentLoop.RECOVERY_INTERVAL_MS
        : this.interval;
      this.timer = setTimeout(run, nextInterval);
    };
    
    run();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    console.log("Agent Heartbeat Stopped");
  }

  setInterval(ms: number) {
    // Clamp to safe bounds: 1 second minimum, 10 minutes maximum
    this.interval = Math.max(1000, Math.min(ms, 600000));
  }

  getAgent() {
    return this.agent;
  }

  /** Activates the kill switch — the next scheduled cycle will be skipped. */
  activateKillSwitch() {
    this.killSwitch = true;
    logEvent('kill_switch_activated', { cycleCount: this.cycleCount });
  }

  /** Deactivates the kill switch and resumes normal cycling. */
  deactivateKillSwitch() {
    this.killSwitch = false;
    logEvent('kill_switch_deactivated', { cycleCount: this.cycleCount });
  }

  isKillSwitchActive(): boolean {
    return this.killSwitch;
  }

  getTelemetry() {
    return {
      isRunning: this.isRunning,
      interval: this.interval,
      cycleCount: this.cycleCount,
      lastError: this.lastError,
      lastExecutionTime: this.lastExecutionTime,
      state: this.agent.getState(),
      consecutiveFailures: this.consecutiveFailures,
      killSwitch: this.killSwitch,
    };
  }
}
