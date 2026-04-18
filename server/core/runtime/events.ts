import { EventEmitter } from 'events';

/** Payload emitted when a new instruction is queued for the agent. */
export interface NewInputPayload {
  instruction: string;
  timestamp: string;
}

/** Payload emitted when consecutive cycle failures exceed the spike threshold. */
export interface FailureSpikePayload {
  consecutiveFailures: number;
  lastError: string;
}

/** Payload emitted when the spotter returns actionable observations. */
export interface OpportunityDetectedPayload {
  opportunityCount: number;
  observations: any[];
}

/**
 * Typed event bus for the RSEA runtime.
 *
 * Triggers:
 *   new_input            — a new user instruction has been queued
 *   failure_spike        — consecutive cycle failures crossed the threshold
 *   opportunity_detected — the spotter returned actionable observations
 */
export class RuntimeEventBus extends EventEmitter {
  emitNewInput(payload: NewInputPayload): void {
    this.emit('new_input', payload);
  }

  emitFailureSpike(payload: FailureSpikePayload): void {
    this.emit('failure_spike', payload);
  }

  emitOpportunityDetected(payload: OpportunityDetectedPayload): void {
    this.emit('opportunity_detected', payload);
  }
}

/** Module-level singleton so all subsystems share one event bus. */
export const runtimeEvents = new RuntimeEventBus();
