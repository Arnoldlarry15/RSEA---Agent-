import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';
import { MemoryRetriever } from '../memory/retriever';
import { REFLECTOR_BANS_KEY } from '../core/risk/gate';

export interface Plan {
  id: string;
  objective: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  parallelNode?: boolean;
  expected?: string;
}

export class Planner {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private retriever: MemoryRetriever | undefined;

  constructor(llm: LLMInterface, memory: MemorySystem, retriever?: MemoryRetriever) {
    this.llm = llm;
    this.memory = memory;
    this.retriever = retriever;
  }

  /**
   * Decomposes an objective into a task tree.
   *
   * @param objective      The high-level goal to plan for.
   * @param context        Contextual data (observations, modifiers, etc.) passed to the LLM.
   * @param explorationRate  Value in [0, 1] from StrategyConfig.  Values ≥ 0.5 put the
   *                         agent into exploration mode — fewer past memories are injected
   *                         so the LLM generates novel plans.  Values < 0.5 use the full
   *                         memory context to exploit known-good strategies.  Defaults to
   *                         0.2 (exploitation-biased).
   */
  async decomposeTask(objective: string, context: any[], explorationRate: number = 0.2): Promise<Plan> {
    const fallbackPlan = (description: string): Plan => ({
      id: `plan_${Date.now()}`,
      objective,
      tasks: [{ id: 't1', description, status: 'pending' }]
    });

    // Adjust how many past memories to inject based on exploration_rate.
    // High exploration → fewer memories → agent generates novel plans.
    // Low exploration  → more memories  → agent exploits known strategies.
    const maxMemories = Math.max(0, Math.round((1 - explorationRate) * 10));

    // Inject retrieved memories (episodic, semantic, strategic) to influence planning.
    // Falls back to a simple recent-context slice when no retriever is wired in.
    let enrichedContext: any[];
    if (this.retriever) {
      const memories = maxMemories > 0
        ? this.retriever.retrieve(objective, context).slice(0, maxMemories)
        : [];
      enrichedContext = [
        ...context,
        ...(memories.length > 0 ? [{ type: 'memory_context', memories }] : [])
      ];
    } else {
      const recentMemory = this.memory.getRecentContext?.() ?? [];
      const trimmedMemory = recentMemory.slice(0, Math.min(5, maxMemories));
      enrichedContext = [
        ...context,
        ...(trimmedMemory.length > 0 ? [{ type: 'memory_context', events: trimmedMemory }] : [])
      ];
    }

    // Generate decomposition tree
    if (!this.llm.healthCheck()) {
      return fallbackPlan('Simulated atomic task');
    }

    // ── Memory dominance: banned tools / action patterns ─────────────────────
    // The Reflector writes tool bans to long-term memory after sustained failure.
    // Injecting them as HARD CONSTRAINTS prevents the LLM from proposing plans
    // that include already-failed patterns — memory overrides creativity here.
    const bannedTools: string[] = this.memory.recall(REFLECTOR_BANS_KEY) ?? [];
    const bannedConstraint =
      bannedTools.length > 0
        ? `\n\nHARD CONSTRAINTS (enforced by memory — DO NOT violate):\n- NEVER generate tasks that use or reference these banned tools/patterns: ${bannedTools.join(', ')}.`
        : '';

    const systemPrompt = `You are the 'Planner' agent of RSEA.
Decompose the given objective into a minimal task tree. Allow for parallel attempts where useful.
Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.${bannedConstraint}

OUTPUT PROTOCOL (STRICT JSON):
{
  "tasks": [
    { "id": "t1", "description": "...", "parallelNode": false }
  ]
}`;

    const userPrompt = `OBJECTIVE: ${objective}
CONTEXT: ${JSON.stringify(enrichedContext).substring(0, 800)}`;

    try {
      const result = await this.llm.complete(systemPrompt, userPrompt);
      const tasks = result?.tasks;
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return fallbackPlan('Fallback task execution');
      }
      return {
        id: `plan_${Date.now()}`,
        objective,
        tasks: tasks.map((t: any) => ({ ...t, status: 'pending' }))
      };
    } catch (err) {
      return fallbackPlan('Fallback task execution');
    }
  }
}
