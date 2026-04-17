import { LLMInterface } from '../cognition/llm';
import { Controller } from '../modules/controller';
import { RulesEngine } from './rules';
import { MemorySystem } from './memory';
import { GoalManager } from './goals';
import { Reflector } from './reflector';
import { logEvent } from '../utils/logger';

export class Agent {
  private llm: LLMInterface;
  private memory: MemorySystem;
  private goals: GoalManager;
  private reflector: Reflector;
  private controller: Controller;
  private manualInstructions: string[] = [];

  constructor() {
    this.llm = new LLMInterface();
    this.memory = new MemorySystem();
    this.goals = new GoalManager();
    this.reflector = new Reflector(this.llm, this.memory);
    this.controller = new Controller(this.llm, this.memory);
    // Legacy deps no longer strictly needed in step by step since Controller manages them:
    // Scorer/Spotter/Simulator migrated natively.
  }

  async observe() {
    // Handled in controller now, but we'll return mock or proxy spotter if needed
    return []; 
  }

  async think(observations: any) {
    const instructions = [...this.manualInstructions];
    this.manualInstructions = [];
    
    const override = instructions.find(i => i.toLowerCase().includes('override goal:'));
    if (override) {
      this.goals.overridePrimaryGoal(override.split('override goal:')[1].trim());
    }

    const currentGoals = this.goals.getGoals();
    
    // Convert current Agent.step() flow into an Orchestrated cycle
    const cycleData = await this.controller.runCycle(currentGoals.primary, instructions);
    
    this.memory.addEvent({ type: 'orchestrated_cycle', data: cycleData, instructions });
    logEvent('think_and_act', { cycleData, instructions });
    
    // Pass output format expected by legacy AgentLoop
    return cycleData;
  }

  addInstruction(text: string) {
    this.manualInstructions.push(text);
    this.memory.addEvent({ type: 'user_command', data: text });
    logEvent('command', text);
  }

  decide(thoughts: any) {
    // Handled in think via evaluator
    return thoughts.plan || [];
  }

  act(actions: any) {
    // Handled in think via sniper, we return the results from cycleData
    // (We pass actions through from the legacy agent.decide which received cycleData)
    // Actually the cycleData is passed to decide, which returns cycleData.plan
    // Wait, the input here is `actions` from decide. but we need cycleData.results
    // We already fired actions through the Sniper inside think.
    return [];
  }

  async reflect(observations: any, thoughts: any, actions: any, results: any) {
    // Use cycleData format: thoughts is cycleData
    await this.reflector.reflect(thoughts?.observations, thoughts?.plan, actions, thoughts?.results);
  }

  getMemory() {
    return this.memory;
  }

  getGoals() {
    return this.goals;
  }

  checkHealth() {
    const isDbHealthy = this.memory.healthCheck();
    return {
      status: isDbHealthy ? 'healthy' : 'unhealthy',
      components: {
        database: isDbHealthy ? 'connected' : 'disconnected',
        llm: this.llm.healthCheck() ? 'connected' : 'simulation_mode'
      }
    };
  }
}

