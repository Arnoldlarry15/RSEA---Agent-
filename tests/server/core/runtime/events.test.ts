import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuntimeEventBus, runtimeEvents } from '../../../../server/core/runtime/events';

describe('RuntimeEventBus', () => {
  let bus: RuntimeEventBus;

  beforeEach(() => {
    bus = new RuntimeEventBus();
  });

  describe('emitNewInput', () => {
    it('calls listeners registered on new_input', () => {
      const listener = vi.fn();
      bus.on('new_input', listener);
      bus.emitNewInput({ instruction: 'buy BTC', timestamp: '2024-01-01T00:00:00.000Z' });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ instruction: 'buy BTC', timestamp: '2024-01-01T00:00:00.000Z' });
    });

    it('does not call listeners for other events', () => {
      const other = vi.fn();
      bus.on('failure_spike', other);
      bus.emitNewInput({ instruction: 'test', timestamp: '2024-01-01T00:00:00.000Z' });
      expect(other).not.toHaveBeenCalled();
    });
  });

  describe('emitFailureSpike', () => {
    it('calls listeners registered on failure_spike', () => {
      const listener = vi.fn();
      bus.on('failure_spike', listener);
      bus.emitFailureSpike({ consecutiveFailures: 3, lastError: 'timeout' });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ consecutiveFailures: 3, lastError: 'timeout' });
    });
  });

  describe('emitOpportunityDetected', () => {
    it('calls listeners registered on opportunity_detected', () => {
      const listener = vi.fn();
      bus.on('opportunity_detected', listener);
      const obs = [{ type: 'airdrop', value: 50 }];
      bus.emitOpportunityDetected({ opportunityCount: 1, observations: obs });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({ opportunityCount: 1, observations: obs });
    });
  });

  describe('multiple listeners', () => {
    it('notifies all registered listeners for the same event', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.on('new_input', l1);
      bus.on('new_input', l2);
      bus.emitNewInput({ instruction: 'hello', timestamp: '2024-01-01T00:00:00.000Z' });
      expect(l1).toHaveBeenCalledOnce();
      expect(l2).toHaveBeenCalledOnce();
    });

    it('does not call a listener after it has been removed', () => {
      const listener = vi.fn();
      bus.on('failure_spike', listener);
      bus.off('failure_spike', listener);
      bus.emitFailureSpike({ consecutiveFailures: 5, lastError: 'error' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('runtimeEvents singleton', () => {
    it('is an instance of RuntimeEventBus', () => {
      expect(runtimeEvents).toBeInstanceOf(RuntimeEventBus);
    });
  });
});
