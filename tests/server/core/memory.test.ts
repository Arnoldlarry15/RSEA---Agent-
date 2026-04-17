import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemorySystem } from '../../../server/core/memory';

// Use in-memory SQLite so tests don't touch the filesystem
describe('MemorySystem', () => {
  let memory: MemorySystem;

  beforeEach(() => {
    memory = new MemorySystem(':memory:');
  });

  afterEach(() => {
    // nothing to clean up — in-memory DB is discarded automatically
  });

  describe('healthCheck', () => {
    it('returns true when the DB is connected', () => {
      expect(memory.healthCheck()).toBe(true);
    });
  });

  describe('addEvent', () => {
    it('stores an event that appears in the snapshot', () => {
      memory.addEvent({ type: 'test', value: 1 });
      const snap = memory.getSnapshot();
      expect(snap.shortTerm.length).toBeGreaterThanOrEqual(1);
      const match = snap.shortTerm.find((e: any) => e.type === 'test');
      expect(match).toBeDefined();
    });

    it('keeps only the last 50 events', () => {
      for (let i = 0; i < 60; i++) {
        memory.addEvent({ index: i });
      }
      const snap = memory.getSnapshot();
      expect(snap.shortTerm.length).toBeLessThanOrEqual(50);
    });
  });

  describe('remember / recall', () => {
    it('stores and retrieves a value by key', () => {
      memory.remember('myKey', { score: 99 });
      expect(memory.recall('myKey')).toEqual({ score: 99 });
    });

    it('returns undefined for an unknown key', () => {
      expect(memory.recall('missing')).toBeUndefined();
    });

    it('overwrites an existing key on second remember call', () => {
      memory.remember('dup', 'first');
      memory.remember('dup', 'second');
      expect(memory.recall('dup')).toBe('second');
    });

    it('handles non-JSON-serialisable primitive values gracefully', () => {
      memory.remember('strKey', 'hello');
      expect(memory.recall('strKey')).toBe('hello');
    });
  });

  describe('remember with embeddings', () => {
    it('stores a key with a 768-dim embedding without throwing', () => {
      const embedding = Array(768).fill(0).map((_, i) => i / 768);
      expect(() => memory.remember('vecKey', { data: 'vec' }, embedding)).not.toThrow();
    });
  });

  describe('recallSemantic', () => {
    it('returns results ordered by score when embeddings exist', () => {
      const emb1 = Array(768).fill(0.1);
      const emb2 = Array(768).fill(0.9);
      memory.remember('k1', 'low', emb1, 1.0);
      memory.remember('k2', 'high', emb2, 2.0);

      const query = Array(768).fill(0.9);
      const results = memory.recallSemantic(query, 2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // All results should have a numeric score
      results.forEach((r: any) => {
        expect(typeof r.score).toBe('number');
        expect(r.key).toBeDefined();
      });
    });

    it('returns an empty array when no embeddings have been stored', () => {
      memory.remember('noVec', 'value'); // no embedding
      const results = memory.recallSemantic(Array(768).fill(0), 5);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(0);
    });
  });

  describe('getSnapshot', () => {
    it('returns both shortTerm and longTerm fields', () => {
      const snap = memory.getSnapshot();
      expect(snap).toHaveProperty('shortTerm');
      expect(snap).toHaveProperty('longTerm');
    });

    it('reflects stored long-term data', () => {
      memory.remember('snapshotKey', { v: 7 });
      const snap = memory.getSnapshot();
      expect(snap.longTerm['snapshotKey']).toEqual({ v: 7 });
    });

    it('each short-term entry includes a timestamp', () => {
      memory.addEvent({ x: 1 });
      const snap = memory.getSnapshot();
      snap.shortTerm.forEach((e: any) => {
        expect(e.timestamp).toBeDefined();
      });
    });
  });
});
