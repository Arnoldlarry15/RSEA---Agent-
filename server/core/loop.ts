import { Agent } from './agent';
import { newTraceId, setTraceId, logEvent } from '../utils/logger';
import { RuntimeLoop } from './runtime/loop';
import { runtimeEvents } from './runtime/events';
import type { FailureSpikePayload, OpportunityDetectedPayload, NewInputPayload } from './runtime/events';

/** Maximum wall-clock time (ms) a single agent cycle may run before being killed. */
const CYCLE_TIMEOUT_MS = parseInt(process.env.CYCLE_TIMEOUT_MS ?? '30000', 10);

/**
 * Number of consecutive failures that trigger auto-activation of the kill switch.
 * Set to 2× MAX_FAILURES_BEFORE_BACKOFF so mild turbulence only causes backoff
 * while a sustained failure storm stops the loop entirely.
 */
const EXTREME_FAILURE_THRESHOLD = 6;

export class AgentLoop {
  private agent: Agent;
  private isRunning: boolean = false;
  private interval: number = 10000;
  
  /** Phase 6 RuntimeLoop instance used for the sleep between cycles. */
  private runtimeLoop: RuntimeLoop = new RuntimeLoop();

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

  /** Bound event listener references kept for cleanup in stop(). */
  private _onNewInput: (p: NewInputPayload) => void;
  private _onFailureSpike: (p: FailureSpikePayload) => void;
  private _onOpportunityDetected: (p: OpportunityDetectedPayload) => void;

  constructor() {
    this.agent = new Agent();
    this._onNewInput = (payload: NewInputPayload) => {
      logEvent('loop_new_input_received', { timestamp: payload.timestamp });
    };
    this._onFailureSpike = (payload: FailureSpikePayload) => {
      logEvent('loop_failure_spike_received', {
        consecutiveFailures: payload.consecutiveFailures,
        lastError: payload.lastError,
      });
      if (payload.consecutiveFailures >= EXTREME_FAILURE_THRESHOLD) {
        this.activateKillSwitch();
        logEvent('loop_kill_switch_auto_activated', {
          reason: 'extreme_failure_spike',
          consecutiveFailures: payload.consecutiveFailures,
        });
      }
    };
    this._onOpportunityDetected = (payload: OpportunityDetectedPayload) => {
      logEvent('loop_opportunity_received', {
        opportunityCount: payload.opportunityCount,
        observations: payload.observations?.length ?? 0,
      });
    };
    this._registerEventListeners();
  }

  /**
   * Subscribes to all RuntimeEventBus events so they produce observable
   * behaviour rather than being silently dropped.
   *
   *  - new_input:            logged for tracing purposes.
   *  - failure_spike:        logged; auto-activates kill switch on extreme failures.
   *  - opportunity_detected: logged for downstream monitoring / dashboards.
   */
  private _registerEventListeners(): void {
    runtimeEvents.on('new_input', this._onNewInput);
    runtimeEvents.on('failure_spike', this._onFailureSpike);
    runtimeEvents.on('opportunity_detected', this._onOpportunityDetected);
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
    void this._runLoop();
  }

  /**
   * Internal async loop that drives the agent.  Delegates the inter-cycle sleep
   * to RuntimeLoop.sleep() so Phase 6 infrastructure is actually used.
   * Fires-and-forgets from start() to keep start() synchronous.
   */
  private async _runLoop(): Promise<void> {
    while (this.isRunning) {
      await this.step();
      if (!this.isRunning) break;
      const nextInterval = this.consecutiveFailures >= AgentLoop.MAX_FAILURES_BEFORE_BACKOFF
        ? AgentLoop.RECOVERY_INTERVAL_MS
        : this.interval;
      await this.runtimeLoop.sleep(nextInterval);
    }
  }

  stop() {
    this.isRunning = false;
    this.runtimeLoop.stop();
    runtimeEvents.off('new_input', this._onNewInput);
    runtimeEvents.off('failure_spike', this._onFailureSpike);
    runtimeEvents.off('opportunity_detected', this._onOpportunityDetected);
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
