import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';
import { MemoryRetriever } from '../memory/retriever';

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

  async decomposeTask(objective: string, context: any[]): Promise<Plan> {
    const fallbackPlan = (description: string): Plan => ({
      id: `plan_${Date.now()}`,
      objective,
      tasks: [{ id: 't1', description, status: 'pending' }]
    });

    // Inject retrieved memories (episodic, semantic, strategic) to influence planning.
    // Falls back to a simple recent-context slice when no retriever is wired in.
    let enrichedContext: any[];
    if (this.retriever) {
      const memories = this.retriever.retrieve(objective, context);
      enrichedContext = [
        ...context,
        ...(memories.length > 0 ? [{ type: 'memory_context', memories }] : [])
      ];
    } else {
      const recentMemory = this.memory.getRecentContext?.() ?? [];
      enrichedContext = [
        ...context,
        ...(recentMemory.length > 0 ? [{ type: 'memory_context', events: recentMemory.slice(0, 5) }] : [])
      ];
    }

    // Generate decomposition tree
    if (!this.llm.healthCheck()) {
      return fallbackPlan('Simulated atomic task');
    }

    const systemPrompt = `You are the 'Planner' agent of RSEA.
Decompose the given objective into a minimal task tree. Allow for parallel attempts where useful.
Always respond with valid JSON matching the OUTPUT PROTOCOL exactly.

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
