import { Agent } from './agent';

export class AgentLoop {
  private agent: Agent;
  private isRunning: boolean = false;
  private interval: number = 10000;
  private timer: NodeJS.Timeout | null = null;
  
  // Telemetry for Debugging
  private cycleCount: number = 0;
  private lastError: string | null = null;
  private lastExecutionTime: number = 0;

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
    } catch (err: any) {
      this.lastError = err.message || String(err);
      console.error("Error in agent cycle:", err);
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
      this.timer = setTimeout(run, this.interval);
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
      lastExecutionTime: this.lastExecutionTime
    };
  }
}
