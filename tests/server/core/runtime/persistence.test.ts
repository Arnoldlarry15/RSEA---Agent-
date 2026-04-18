import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentStatePersistence, PersistedAgentState } from '../../../../server/core/runtime/persistence';

const STATE_KEY = '__agent_runtime_state__';

function makeState(overrides: Partial<PersistedAgentState> = {}): PersistedAgentState {
  return {
    goals: {
      primary: 'Maximize alpha',
      subTasks: ['scan signals'],
      status: 'ACTIVE',
      successCriteria: [],
    },
    activePlan: [{ id: 't1', description: 'buy BTC', score: 80 }],
    strategyVersion: null,
    savedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AgentStatePersistence', () => {
  const mockRemember = vi.fn();
  const mockRecall = vi.fn();
  const mockMemory = { remember: mockRemember, recall: mockRecall } as any;

  let persistence: AgentStatePersistence;

  beforeEach(() => {
    mockRemember.mockReset();
    mockRecall.mockReset();
    persistence = new AgentStatePersistence(mockMemory);
  });

  describe('save', () => {
    it('calls memory.remember with the correct key and state', () => {
      const state = makeState();
      persistence.save(state);
      expect(mockRemember).toHaveBeenCalledOnce();
      expect(mockRemember).toHaveBeenCalledWith(STATE_KEY, state);
    });

    it('saves different states independently', () => {
      const s1 = makeState({ savedAt: '2024-01-01T00:00:00.000Z' });
      const s2 = makeState({ savedAt: '2024-06-01T00:00:00.000Z' });
      persistence.save(s1);
      persistence.save(s2);
      expect(mockRemember).toHaveBeenCalledTimes(2);
      expect(mockRemember).toHaveBeenNthCalledWith(1, STATE_KEY, s1);
      expect(mockRemember).toHaveBeenNthCalledWith(2, STATE_KEY, s2);
    });
  });

  describe('load', () => {
    it('returns the recalled state when one exists', () => {
      const state = makeState();
      mockRecall.mockReturnValue(state);
      expect(persistence.load()).toEqual(state);
      expect(mockRecall).toHaveBeenCalledWith(STATE_KEY);
    });

    it('returns null when recall returns undefined (first boot)', () => {
      mockRecall.mockReturnValue(undefined);
      expect(persistence.load()).toBeNull();
    });

    it('returns null when recall returns null', () => {
      mockRecall.mockReturnValue(null);
      expect(persistence.load()).toBeNull();
    });
  });

  describe('clear', () => {
    it('calls memory.remember with null to wipe stored state', () => {
      persistence.clear();
      expect(mockRemember).toHaveBeenCalledWith(STATE_KEY, null);
    });
  });

  describe('round-trip', () => {
    it('saves and loads a state with an activePlan', () => {
      const state = makeState({ activePlan: [{ id: 'p1', score: 90 }] });
      // Simulate what MemorySystem would do
      let stored: any;
      mockRemember.mockImplementation((_k: string, v: any) => { stored = v; });
      mockRecall.mockImplementation(() => stored);

      persistence.save(state);
      expect(persistence.load()).toEqual(state);
    });

    it('saves and loads a state with a null activePlan', () => {
      const state = makeState({ activePlan: null });
      let stored: any;
      mockRemember.mockImplementation((_k: string, v: any) => { stored = v; });
      mockRecall.mockImplementation(() => stored);

      persistence.save(state);
      expect(persistence.load()).toEqual(state);
    });
  });
});
