import { Agent } from './agent';
import { AgentState } from './state';

export class AgentLoop {
  private agent: Agent;
  private isRunning: boolean = false;
  private interval: number = 10000;
  private timer: NodeJS.Timeout | null = null;
  
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
    const startTime = Date.now();
    console.log("\n--- New Cycle ---");
    try {
      this.cycleCount++;
      await this.agent.runCycle();
      this.lastError = null;
      this.consecutiveFailures = 0;
    } catch (err: any) {
      this.consecutiveFailures++;
      this.lastError = err.message || String(err);
      console.error("Error in agent cycle:", err);

      // Apply backoff when failures accumulate — widen the next sleep window
      if (this.consecutiveFailures >= AgentLoop.MAX_FAILURES_BEFORE_BACKOFF) {
        console.warn(`[Loop] ${this.consecutiveFailures} consecutive failures — entering recovery backoff`);
      }
    } finally {
      this.lastExecutionTime = Date.now() - startTime;
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
    this.interval = ms;
  }

  getAgent() {
    return this.agent;
  }

  getTelemetry() {
    return {
      isRunning: this.isRunning,
      interval: this.interval,
      cycleCount: this.cycleCount,
      lastError: this.lastError,
      lastExecutionTime: this.lastExecutionTime,
      state: this.agent.getState() as AgentState,
      consecutiveFailures: this.consecutiveFailures
    };
  }
}
