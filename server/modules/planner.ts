import { LLMInterface } from '../cognition/llm';
import { MemorySystem } from '../core/memory';

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
}

export class Planner {
  private llm: LLMInterface;
  private memory: MemorySystem;

  constructor(llm: LLMInterface, memory: MemorySystem) {
    this.llm = llm;
    this.memory = memory;
  }

  async decomposeTask(objective: string, context: any[]): Promise<Plan> {
    // Generate decomposition tree
    if (!this.llm.healthCheck()) {
      return {
        id: `plan_${Date.now()}`,
        objective,
        tasks: [{ id: 't1', description: 'Simulated atomic task', status: 'pending' }]
      };
    }

    try {
      const prompt = `
      You are the 'Planner' agent of RSEA.
      OBJECTIVE: ${objective}
      CONTEXT: ${JSON.stringify(context).substring(0, 500)}

      Decompose this objective into a minimal task tree. Allow for parallel attempts where useful.

      OUTPUT PROTOCOL (STRICT JSON):
      {
        "tasks": [
          { "id": "t1", "description": "...", "parallelNode": false }
        ]
      }
      `;

      const result = await this.llm.analyze([], [prompt]);
      const tasks = result.tasks || [{ id: 't1', description: 'Fallback task execution', status: 'pending' }];
      return {
        id: `plan_${Date.now()}`,
        objective,
        tasks: tasks.map((t: any) => ({ ...t, status: 'pending' }))
      };
    } catch (err) {
      return {
        id: `plan_${Date.now()}`,
        objective,
        tasks: [{ id: 't1', description: 'Fallback task execution', status: 'pending' }]
      };
    }
  }
}
