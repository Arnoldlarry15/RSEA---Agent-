import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock all three provider SDKs before any imports using proper class style
vi.mock('@google/genai', () => {
  const generateContent = vi.fn().mockResolvedValue({
    text: JSON.stringify({ opportunities: [], notes: 'gemini', model: 'gemini' })
  });
  const embedContent = vi.fn().mockResolvedValue({
    embeddings: [{ values: Array(768).fill(0.1) }]
  });
  class GoogleGenAI {
    models = { generateContent, embedContent };
  }
  return { GoogleGenAI };
});

vi.mock('openai', () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ opportunities: [], notes: 'openai', model: 'openai' }) } }]
  });
  const embeddingsCreate = vi.fn().mockResolvedValue({
    data: [{ embedding: Array(768).fill(0.2) }]
  });
  class OpenAI {
    chat = { completions: { create } };
    embeddings = { create: embeddingsCreate };
  }
  return { default: OpenAI };
});

vi.mock('@anthropic-ai/sdk', () => {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ opportunities: [], notes: 'anthropic', model: 'anthropic' }) }]
  });
  class Anthropic {
    messages = { create };
  }
  return { default: Anthropic };
});

import { LLMInterface } from '../../../server/cognition/llm';

// "simulation mode" — use an unrecognised provider so Ollama is not auto-selected
function makeSimulationLLM(): LLMInterface {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  process.env.LLM_PROVIDER = 'none'; // explicit but unrecognised → no provider
  return new LLMInterface();
}

function makeGeminiLLM(): LLMInterface {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.LLM_PROVIDER = 'gemini';
  return new LLMInterface();
}

function makeOpenAILLM(): LLMInterface {
  delete process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LLM_PROVIDER = 'openai';
  return new LLMInterface();
}

describe('LLMInterface', () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.GROK_MODEL;
  });

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  describe('healthCheck', () => {
    it('returns true when a valid provider is configured', () => {
      expect(makeGeminiLLM().healthCheck()).toBe(true);
    });

    it('returns false in simulation mode (no keys, unrecognised provider)', () => {
      expect(makeSimulationLLM().healthCheck()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // provider selection
  // ---------------------------------------------------------------------------
  describe('provider selection', () => {
    it('selects Gemini when LLM_PROVIDER=gemini and key is present', () => {
      const llm = makeGeminiLLM();
      expect(llm.healthCheck()).toBe(true);
    });

    it('selects OpenAI when LLM_PROVIDER=openai and key is present', () => {
      const llm = makeOpenAILLM();
      expect(llm.healthCheck()).toBe(true);
    });

    it('treats placeholder keys (MY_*) as absent', () => {
      process.env.LLM_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';
      const llm = new LLMInterface();
      expect(llm.healthCheck()).toBe(false);
    });

    it('falls back to simulation when explicit provider key is missing', () => {
      process.env.LLM_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;
      const llm = new LLMInterface();
      expect(llm.healthCheck()).toBe(false);
    });

    it('supports auto-detect when no LLM_PROVIDER is set and Gemini key is present', () => {
      delete process.env.LLM_PROVIDER;
      process.env.GEMINI_API_KEY = 'test-key';
      const llm = new LLMInterface();
      expect(llm.healthCheck()).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // analyze — simulation mode
  // ---------------------------------------------------------------------------
  describe('analyze in simulation mode', () => {
    it('returns simulated result without calling any API', async () => {
      const llm = makeSimulationLLM();
      const result = await llm.analyze([{ type: 'signal', value: 100 }]);
      expect(result).toHaveProperty('notes');
      expect(String(result.notes)).toContain('SIMULATION');
      expect(result.model).toBe('simulation-fallback');
    });

    it('includes instructions in the simulation notes', async () => {
      const llm = makeSimulationLLM();
      const result = await llm.analyze([], ['do this', 'and that']);
      expect(result.notes).toContain('do this');
    });
  });

  // ---------------------------------------------------------------------------
  // analyze — with Gemini
  // ---------------------------------------------------------------------------
  describe('analyze with Gemini provider', () => {
    it('calls the Gemini API and returns parsed JSON', async () => {
      const llm = makeGeminiLLM();
      const result = await llm.analyze([{ type: 'signal' }]);
      expect(result).toHaveProperty('opportunities');
    });
  });

  // ---------------------------------------------------------------------------
  // complete
  // ---------------------------------------------------------------------------
  describe('complete', () => {
    it('returns null in simulation mode', async () => {
      const llm = makeSimulationLLM();
      const result = await llm.complete('system', 'user');
      expect(result).toBeNull();
    });

    it('returns parsed JSON with a real provider', async () => {
      const llm = makeGeminiLLM();
      const result = await llm.complete('You are a planner.', 'List tasks.');
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  // ---------------------------------------------------------------------------
  // summarizeExperience
  // ---------------------------------------------------------------------------
  describe('summarizeExperience', () => {
    it('returns simulated insight in simulation mode', async () => {
      const llm = makeSimulationLLM();
      const result = await llm.summarizeExperience([], [], []);
      expect(result).toHaveProperty('insight');
    });

    it('calls the Gemini provider and returns parsed response', async () => {
      const { GoogleGenAI } = await import('@google/genai');
      // Override generateContent to return an insight JSON
      const inst = new (GoogleGenAI as any)();
      inst.models.generateContent.mockResolvedValueOnce({
        text: JSON.stringify({ insight: 'BTC was bullish' })
      });

      const llm = makeGeminiLLM();
      const result = await llm.summarizeExperience([{ price: 50000 }], ['buy'], [{ status: 'ok' }]);
      expect(result).toHaveProperty('insight');
    });
  });

  // ---------------------------------------------------------------------------
  // generateModifiers
  // ---------------------------------------------------------------------------
  describe('generateModifiers', () => {
    it('returns null in simulation mode', async () => {
      const llm = makeSimulationLLM();
      expect(await llm.generateModifiers([], [])).toBeNull();
    });

    it('returns an array of modifier strings with a live provider', async () => {
      const { GoogleGenAI } = await import('@google/genai');
      const inst = new (GoogleGenAI as any)();
      inst.models.generateContent.mockResolvedValueOnce({
        text: JSON.stringify({ modifiers: ['be bold', 'be safe'] })
      });

      const llm = makeGeminiLLM();
      const mods = await llm.generateModifiers([{ ctx: 1 }], ['existing rule']);
      expect(Array.isArray(mods)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // embed
  // ---------------------------------------------------------------------------
  describe('embed', () => {
    it('returns a 768-dim vector with Gemini', async () => {
      const llm = makeGeminiLLM();
      const emb = await llm.embed('hello world');
      expect(Array.isArray(emb)).toBe(true);
      expect(emb.length).toBe(768);
    });

    it('returns a 768-dim pseudo-vector in simulation mode', async () => {
      const llm = makeSimulationLLM();
      const emb = await llm.embed('hello world');
      expect(emb.length).toBe(768);
      emb.forEach((v: number) => expect(typeof v).toBe('number'));
    });

    it('returns a 768-dim vector with OpenAI', async () => {
      const llm = makeOpenAILLM();
      const emb = await llm.embed('hello');
      expect(emb.length).toBe(768);
    });
  });
});

