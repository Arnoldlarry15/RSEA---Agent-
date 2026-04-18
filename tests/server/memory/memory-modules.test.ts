import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySystem } from '../../../server/core/memory';
import { EpisodicMemory } from '../../../server/memory/episodic';
import { SemanticMemory } from '../../../server/memory/semantic';
import { StrategicMemory } from '../../../server/memory/strategic';
import { MemoryRetriever } from '../../../server/memory/retriever';
import { PatternExtractor } from '../../../server/memory/patterns';

function makeMemory() {
  return new MemorySystem(':memory:');
}

// ── EpisodicMemory ────────────────────────────────────────────────────────────
describe('EpisodicMemory', () => {
  let episodic: EpisodicMemory;

  beforeEach(() => {
    episodic = new EpisodicMemory(makeMemory());
  });

  it('stores and retrieves episodes', () => {
    episodic.addEpisode({ type: 'trade', symbol: 'BTC' });
    const recent = episodic.getRecent(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);
    const match = recent.find((e: any) => e.type === 'trade');
    expect(match).toBeDefined();
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 20; i++) episodic.addEpisode({ type: 'tick', i });
    const recent = episodic.getRecent(3);
    expect(recent.length).toBeLessThanOrEqual(3);
  });
});

// ── SemanticMemory ────────────────────────────────────────────────────────────
describe('SemanticMemory', () => {
  let semantic: SemanticMemory;

  beforeEach(() => {
    semantic = new SemanticMemory(makeMemory());
  });

  it('stores and retrieves by key', () => {
    semantic.store('fact1', { info: 'test' });
    expect(semantic.retrieve('fact1')).toEqual({ info: 'test' });
  });

  it('returns undefined for missing key', () => {
    expect(semantic.retrieve('ghost')).toBeUndefined();
  });

  it('getInsights returns entries keyed with INSIGHT_', () => {
    semantic.store('INSIGHT_123', 'insight text');
    semantic.store('other_key', 'not an insight');
    const insights = semantic.getInsights();
    expect(insights.some((i) => i.key === 'INSIGHT_123')).toBe(true);
    expect(insights.every((i) => i.key.startsWith('INSIGHT_'))).toBe(true);
  });
});

// ── StrategicMemory ───────────────────────────────────────────────────────────
describe('StrategicMemory', () => {
  let strategic: StrategicMemory;

  beforeEach(() => {
    strategic = new StrategicMemory(makeMemory());
  });

  it('stores and retrieves a pattern by name', () => {
    strategic.storePattern('avoid_X', { reason: 'too risky' });
    expect(strategic.getPattern('avoid_X')).toEqual({ reason: 'too risky' });
  });

  it('getAllPatterns returns all stored patterns', () => {
    strategic.storePattern('p1', { a: 1 });
    strategic.storePattern('p2', { b: 2 });
    const patterns = strategic.getAllPatterns();
    expect(patterns.length).toBe(2);
    expect(patterns.map((p) => p.key)).toContain('p1');
    expect(patterns.map((p) => p.key)).toContain('p2');
  });

  it('getAllPatterns returns empty array when nothing stored', () => {
    expect(strategic.getAllPatterns()).toEqual([]);
  });
});

// ── MemoryRetriever ───────────────────────────────────────────────────────────
describe('MemoryRetriever', () => {
  let retriever: MemoryRetriever;
  let episodic: EpisodicMemory;
  let semantic: SemanticMemory;
  let strategic: StrategicMemory;

  beforeEach(() => {
    const mem = makeMemory();
    episodic = new EpisodicMemory(mem);
    semantic = new SemanticMemory(mem);
    strategic = new StrategicMemory(mem);
    retriever = new MemoryRetriever(episodic, semantic, strategic);
  });

  it('returns an array', () => {
    const result = retriever.retrieve('maximise profit', []);
    expect(Array.isArray(result)).toBe(true);
  });

  it('includes episodic memories', () => {
    episodic.addEpisode({ type: 'trade', symbol: 'ETH' });
    const result = retriever.retrieve('goal', []);
    expect(result.some((r) => r.type === 'episodic')).toBe(true);
  });

  it('includes semantic insights', () => {
    semantic.store('INSIGHT_abc', 'be careful with leverage');
    const result = retriever.retrieve('goal', []);
    expect(result.some((r) => r.type === 'semantic')).toBe(true);
  });

  it('includes strategic patterns', () => {
    strategic.storePattern('avoid_flash_crashes', { warning: 'volatile period' });
    const result = retriever.retrieve('goal', []);
    expect(result.some((r) => r.type === 'strategic')).toBe(true);
  });

  it('returns empty array when no memories are stored', () => {
    const result = retriever.retrieve('goal', []);
    expect(result).toHaveLength(0);
  });
});

// ── PatternExtractor ──────────────────────────────────────────────────────────
describe('PatternExtractor', () => {
  let extractor: PatternExtractor;
  let episodic: EpisodicMemory;
  let semantic: SemanticMemory;
  let strategic: StrategicMemory;

  beforeEach(() => {
    const mem = makeMemory();
    episodic = new EpisodicMemory(mem);
    semantic = new SemanticMemory(mem);
    strategic = new StrategicMemory(mem);
    extractor = new PatternExtractor(episodic, semantic, strategic);
  });

  it('returns empty array when no evaluations exist', () => {
    episodic.addEpisode({ type: 'trade' }); // not an evaluation
    expect(extractor.extract()).toHaveLength(0);
  });

  it('detects a repeated failure (≥2 occurrences) and stores it', () => {
    for (let i = 0; i < 3; i++) {
      episodic.addEpisode({ type: 'evaluation', taskId: 'buy_BTC', success: false });
    }
    const patterns = extractor.extract();
    const failure = patterns.find((p) => p.type === 'failure' && p.taskDescription === 'buy_BTC');
    expect(failure).toBeDefined();
    expect(failure!.count).toBeGreaterThanOrEqual(2);

    // Verify stored in strategic memory
    const sp = strategic.getPattern('failure:buy_BTC');
    expect(sp).toBeDefined();
  });

  it('does not flag a single failure as a repeated pattern', () => {
    episodic.addEpisode({ type: 'evaluation', taskId: 'sell_ETH', success: false });
    const patterns = extractor.extract();
    expect(patterns.find((p) => p.taskDescription === 'sell_ETH')).toBeUndefined();
  });

  it('detects successful strategies', () => {
    episodic.addEpisode({ type: 'evaluation', taskId: 'hold_BTC', success: true });
    episodic.addEpisode({ type: 'evaluation', taskId: 'hold_BTC', success: true });
    const patterns = extractor.extract();
    const success = patterns.find((p) => p.type === 'success' && p.taskDescription === 'hold_BTC');
    expect(success).toBeDefined();
  });
});
