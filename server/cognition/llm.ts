import { GoogleGenAI } from "@google/genai";

export class LLMInterface {
  private ai: GoogleGenAI | null = null;

  constructor() {
    // DESIGN NOTE: For an autonomous backend agent, we use process.env.GEMINI_API_KEY.
    // To use Ollama or a local LLM, you would replace this with a fetch call 
    // to your local endpoint (e.g., http://localhost:11434/api/generate).
    const apiKey = process.env.GEMINI_API_KEY;
    const isPlaceholder = apiKey === "MY_GEMINI_API_KEY" || !apiKey;

    if (!isPlaceholder) {
      this.ai = new GoogleGenAI({ apiKey });
    } else {
      console.warn("GEMINI_API_KEY not found or is placeholder. LLMInterface will operate in simulation mode.");
      console.info("To use real AI, please provide a valid GEMINI_API_KEY in the Secrets panel.");
    }
  }

  /**
   * Performs real analysis using the Gemini API.
   * If the API key is missing, it falls back to simulation.
   */
  async analyze(observations: any, instructions: string[] = [], goals: any = null) {
    if (!this.ai) {
      return {
        opportunities: observations,
        notes: `Analysis performed via [SIMULATION] mode - ${instructions.length > 0 ? 'Instructions received: ' + instructions.join(', ') : 'No API Key.'}`,
        model: "simulation-fallback"
      };
    }

    try {
      const prompt = `
        You are the 'Think' layer of the RSEA (Research, Scan, Execute, Act) Autonomous Agent.
        Your personality is analytical, precision-oriented, and strategic. You act as a high-frequency 
        decision engine monitoring market signals and decentralized opportunities.

        ${goals ? `
        PRIMARY GOAL: ${goals.primary}
        ACTIVE SUBTASKS:
        ${goals.subTasks.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n')}
        ` : ''}

        CORE DIRECTIVES:
        1. Identify the absolute best path forward based on observations.
        2. Be skeptical of unverified sources.
        3. Prioritize capital preservation but recognize high-delta asymmetric bets.
        
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
          "model": "gemini-2.0-flash-immersive"
        }
      `;

      const result = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text;
      return JSON.parse(responseText);
    } catch (err) {
      console.error("Gemini API Error:", err);
      return {
        opportunities: observations.slice(0, 1),
        notes: "Analysis failed. Fallback to minimal action.",
        model: "error-fallback"
      };
    }
  }

  async summarizeExperience(observations: any, actions: any, results: any) {
    if (!this.ai) return { insight: "Simulated Insight: Market dynamics cataloged successfully." };
    
    try {
      const prompt = `
        You are the 'Reflect' / Meta-Cognitive layer of the RSEA Agent.
        Analyze the recent cycle's observations, chosen actions, and the execution results.
        
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

      const result = await this.ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = result.text;
      return JSON.parse(responseText);
    } catch (err) {
      console.error("Reflection API Error:", err);
      return { insight: "Simulated Insight: Anomaly detected during execution analysis." };
    }
  }

  healthCheck(): boolean {
    return this.ai !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ai) {
      // Return a dummy 768-dimensional vector for simulation mode
      return Array(768).fill(0).map(() => Math.random() - 0.5);
    }
    try {
      const result = await this.ai.models.embedContent({
        model: "text-embedding-004",
        contents: text
      });
      return result.embeddings[0].values;
    } catch (err) {
      console.error("Embedding generation failed:", err);
      // Fallback pseudo-vector to prevent crash
      return Array(768).fill(0).map(() => Math.random() - 0.5);
    }
  }
}
