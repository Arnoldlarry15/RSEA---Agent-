/**
 * RuntimeLoop — Phase 6: Continuous Runtime
 * ──────────────────────────────────────────
 * Provides a simple async while-loop controller:
 *
 *   while (running) {
 *     await runCycle();
 *     await sleep(interval);
 *   }
 *
 * The loop runs until `stop()` is called.  It is intentionally framework-
 * agnostic — callers supply the cycle function so it can wrap any async work.
 */
export class RuntimeLoop {
  private running = false;

  /**
   * Starts the loop, calling `fn` once per `intervalMs` milliseconds.
   * Resolves when `stop()` has been called and the in-progress cycle finishes.
   */
  async start(fn: () => Promise<void>, intervalMs: number): Promise<void> {
    this.running = true;
    while (this.running) {
      await fn();
      if (this.running) {
        await this.sleep(intervalMs);
      }
    }
  }

  /** Signals the loop to exit after the current cycle completes. */
  stop(): void {
    this.running = false;
  }

  /** Returns a Promise that resolves after `ms` milliseconds. */
  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isRunning(): boolean {
    return this.running;
  }
}
