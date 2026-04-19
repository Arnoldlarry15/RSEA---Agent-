import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Supported LLM providers. Set LLM_PROVIDER in your .env to choose one explicitly,
// or leave it unset to auto-detect from whichever API key is present.
type LLMProvider = "gemini" | "openai" | "anthropic" | "grok" | "ollama";

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.startsWith("MY_") || value === "your_key_here";
}

export class LLMInterface {
  private provider: LLMProvider | null = null;

  // Provider clients
  private geminiAi: GoogleGenAI | null = null;
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private grokClient: OpenAI | null = null; // Grok uses the OpenAI-compatible API

  // Ollama config
  private ollamaBaseUrl: string = "http://localhost:11434";
  private ollamaModel: string = "llama3";
  private ollamaEmbedModel: string = "nomic-embed-text";

  constructor() {
    const rawProvider = (process.env.LLM_PROVIDER || "").toLowerCase();
    const explicitProvider = rawProvider as LLMProvider | "";

    // Helper: try to initialize a provider and return true on success
    const tryInit = (p: LLMProvider): boolean => {
      if (p === "gemini") {
        const key = process.env.GEMINI_API_KEY;
        if (isPlaceholder(key)) return false;
        this.geminiAi = new GoogleGenAI({ apiKey: key! });
        this.provider = "gemini";
        console.info("[LLM] Provider: Gemini");
        return true;
      }
      if (p === "openai") {
        const key = process.env.OPENAI_API_KEY;
        if (isPlaceholder(key)) return false;
        this.openaiClient = new OpenAI({ apiKey: key! });
        this.provider = "openai";
        console.info("[LLM] Provider: OpenAI");
        return true;
      }
      if (p === "anthropic") {
        const key = process.env.ANTHROPIC_API_KEY;
        if (isPlaceholder(key)) return false;
        this.anthropicClient = new Anthropic({ apiKey: key! });
        this.provider = "anthropic";
        console.info("[LLM] Provider: Anthropic");
        return true;
      }
      if (p === "grok") {
        const key = process.env.XAI_API_KEY;
        if (isPlaceholder(key)) return false;
        this.grokClient = new OpenAI({ apiKey: key!, baseURL: "https://api.x.ai/v1" });
        this.provider = "grok";
        console.info("[LLM] Provider: Grok (xAI)");
        return true;
      }
      if (p === "ollama") {
        this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        this.ollamaModel = process.env.OLLAMA_MODEL || "llama3";
        this.ollamaEmbedModel = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
        this.provider = "ollama";
        console.info(`[LLM] Provider: Ollama (${this.ollamaModel} @ ${this.ollamaBaseUrl})`);
        return true;
      }
      return false;
    };

    if (explicitProvider !== "") {
      if (!tryInit(explicitProvider)) {
        console.warn(`[LLM] LLM_PROVIDER="${explicitProvider}" set but required key/config is missing. Falling back to simulation.`);
      }
    } else {
      // Auto-detect: first key found wins
      const autoOrder: LLMProvider[] = ["gemini", "openai", "anthropic", "grok", "ollama"];
      for (const p of autoOrder) {
        if (tryInit(p)) break;
      }
    }

    if (!this.provider) {
      console.warn("[LLM] No provider configured. Operating in simulation mode.");
      console.info("[LLM] Set LLM_PROVIDER and the matching API key in your .env to enable AI.");
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers – route a prompt to the active provider
  // ---------------------------------------------------------------------------

  private async callChat(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.provider === "gemini" && this.geminiAi) {
      const result = await this.geminiAi.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        config: { responseMimeType: "application/json" }
      });
      return result.text ?? "";
    }

    if (this.provider === "openai" && this.openaiClient) {
      const resp = await this.openaiClient.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      });
      return resp.choices[0]?.message?.content ?? "";
    }

    if (this.provider === "anthropic" && this.anthropicClient) {
      const resp = await this.anthropicClient.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      });
      const block = resp.content[0];
      return block.type === "text" ? block.text : "";
    }

    if (this.provider === "grok" && this.grokClient) {
      const resp = await this.grokClient.chat.completions.create({
        model: process.env.GROK_MODEL || "grok-3",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      });
      return resp.choices[0]?.message?.content ?? "";
    }

    if (this.provider === "ollama") {
      const resp = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          stream: false,
          format: "json"
        })
      });
      const json = await resp.json() as any;
      return json?.message?.content ?? "";
    }

    throw new Error("No active LLM provider");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Performs analysis using the configured LLM provider.
   * Falls back to simulation mode if no provider is active.
   */
  async analyze(observations: any, instructions: string[] = [], goals: any = null) {
    if (!this.provider) {
      return {
        opportunities: observations,
        notes: `Analysis performed via [SIMULATION] mode - ${instructions.length > 0 ? 'Instructions received: ' + instructions.join(', ') : 'No API Key.'}`,
        model: "simulation-fallback"
      };
    }

    try {
      const systemPrompt = `You are the 'Think' layer of the RSEA (Research, Scan, Execute, Act) Autonomous Agent.
Your personality is analytical, precision-oriented, and strategic. You act as a high-frequency 
decision engine monitoring market signals and decentralized opportunities.

CORE DIRECTIVES:
1. Identify the absolute best path forward based on observations.
2. Be skeptical of unverified sources.
3. Prioritize capital preservation but recognize high-delta asymmetric bets.

Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.`;

      const userPrompt = `
        ${goals ? `
        PRIMARY GOAL: ${goals.primary}
        ACTIVE SUBTASKS:
        ${goals.subTasks.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}
        ` : ''}

        ${instructions.length > 0 ? `MANUAL OVERRIDE FROM OPERATOR:
        ${instructions.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}
        (Note: Operator instructions always supersede default autonomous behavior.)
        ` : ''}

        CURRENT OBSERVATIONS:
        ${JSON.stringify(observations, null, 2)}

        ANALYSIS CRITERIA:
        - Goal Alignment: Does this advance the primary goal or active subtasks?
        - Value Density: Is the reward worth the risk?
        - Time Sensitivity: Does this require immediate execution?
        - Reputation: Do the sources correlate with previously successful patterns in your memory?

        OUTPUT PROTOCOL (STRICT JSON):
        {
          "opportunities": [
            { 
              "type": "string", 
              "target": "string", 
              "reasoning": "string", 
              "confidence": number,
              "urgency": "low|medium|high"
            }
          ],
          "cognitive_load": number,
          "summary": "Brief high-level summary of the tactical landscape.",
          "model": "${this.provider}"
        }
      `;

      return JSON.parse(await this.callChat(systemPrompt, userPrompt));
    } catch (err) {
      console.error(`[LLM] analyze error (${this.provider}):`, err);
      return {
        opportunities: observations.slice(0, 1),
        notes: "Analysis failed. Fallback to minimal action.",
        model: "error-fallback"
      };
    }
  }

  async summarizeExperience(observations: any, actions: any, results: any) {
    if (!this.provider) return { insight: "Simulated Insight: Market dynamics cataloged successfully." };

    try {
      const systemPrompt = `You are the 'Reflect' / Meta-Cognitive layer of the RSEA Agent.
Analyze the recent cycle's observations, chosen actions, and execution results.
Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.`;

      const userPrompt = `
        OBSERVATIONS: ${JSON.stringify(observations).substring(0, 500)}
        ACTIONS: ${JSON.stringify(actions)}
        RESULTS: ${JSON.stringify(results)}
        
        TASK: Extract a single, profound strategic insight or rule to add to Long-Term Memory. 
        It should be concise, analytical, and actionable for future cycles.
        
        OUTPUT PROTOCOL (STRICT JSON):
        {
          "insight": "The extracted strategic learning."
        }
      `;

      return JSON.parse(await this.callChat(systemPrompt, userPrompt));
    } catch (err) {
      console.error(`[LLM] summarizeExperience error (${this.provider}):`, err);
      return { insight: "Simulated Insight: Anomaly detected during execution analysis." };
    }
  }

  async generateModifiers(recentContext: any[], currentModifiers: string[]): Promise<string[] | null> {
    if (!this.provider) return null;

    try {
      const systemPrompt = `You are the self-modification layer of the RSEA Agent.
Based on recent context, adjust the strategic operating modifiers to improve future iterations.
Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.`;

      const userPrompt = `
        RECENT CONTEXT: ${JSON.stringify(recentContext).substring(0, 300)}
        CURRENT MODIFIERS: ${JSON.stringify(currentModifiers)}

        Return an updated array of up to 3 concise strategic rules.

        OUTPUT PROTOCOL (STRICT JSON):
        {
          "modifiers": ["rule 1", "rule 2", "rule 3"]
        }
      `;

      const parsed = JSON.parse(await this.callChat(systemPrompt, userPrompt));
      if (parsed.modifiers && Array.isArray(parsed.modifiers)) {
        return parsed.modifiers;
      }
      return null;
    } catch (err) {
      console.error(`[LLM] generateModifiers error (${this.provider}):`, err);
      return null;
    }
  }

  /**
   * Low-level JSON completion. Returns the raw parsed JSON from the LLM.
   * Falls back to null in simulation mode so callers can provide their own defaults.
   * Raw response is logged at verbose level for auditability.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<any | null> {
    if (!this.provider) return null;
    try {
      const raw = await this.callChat(systemPrompt, userPrompt);
      // Audit trail: log raw text before parsing so LLM output is always traceable
      if ((process.env.VERBOSITY_LEVEL ?? 'normal').toLowerCase() === 'verbose') {
        console.log(`[LLM][complete][${this.provider}] raw:`, raw.slice(0, 500));
      }
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[LLM] complete error (${this.provider}):`, err);
      return null;
    }
  }

  healthCheck(): boolean {
    return this.provider !== null;
  }

  async embed(text: string): Promise<number[]> {
    // Gemini – text-embedding-004 returns 768 dimensions
    if (this.provider === "gemini" && this.geminiAi) {
      try {
        const result = await this.geminiAi.models.embedContent({
          model: "text-embedding-004",
          contents: text
        });
        return result.embeddings[0].values;
      } catch (err) {
        console.error("[LLM] Gemini embedding failed:", err);
      }
    }

    // OpenAI – request 768 dimensions to match the sqlite-vec schema
    if (this.provider === "openai" && this.openaiClient) {
      try {
        const result = await this.openaiClient.embeddings.create({
          model: "text-embedding-3-small",
          input: text,
          dimensions: 768
        });
        return result.data[0].embedding;
      } catch (err) {
        console.error("[LLM] OpenAI embedding failed:", err);
      }
    }

    // Ollama – nomic-embed-text returns 768 dimensions
    if (this.provider === "ollama") {
      try {
        const resp = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.ollamaEmbedModel, prompt: text })
        });
        const json = await resp.json() as any;
        if (Array.isArray(json?.embedding)) return json.embedding;
      } catch (err) {
        console.error("[LLM] Ollama embedding failed:", err);
      }
    }

    // Anthropic and Grok do not have public embedding APIs – use pseudo-vector
    console.warn('[LLM] embed: provider does not support real embeddings; using pseudo-vector (semantic search will be unreliable)');
    return Array(768).fill(0).map(() => Math.random() - 0.5);
  }
}
