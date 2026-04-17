import { LLMInterface } from '../cognition/llm';
import { Controller } from '../modules/controller';
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
  }

  async runCycle() {
    const instructions = [...this.manualInstructions];
    this.manualInstructions = [];

    const override = instructions.find(i => i.toLowerCase().includes('override goal:'));
    if (override) {
      this.goals.overridePrimaryGoal(override.split('override goal:')[1].trim());
    }

    const currentGoals = this.goals.getGoals();
    const cycleData = await this.controller.runCycle(currentGoals.primary, instructions);

    this.memory.addEvent({ type: 'orchestrated_cycle', data: cycleData, instructions });
    logEvent('think_and_act', { cycleData, instructions });

    await this.reflector.reflect(cycleData.observations, cycleData.plan, cycleData.plan, cycleData.results);

    return cycleData;
  }

  addInstruction(text: string) {
    this.manualInstructions.push(text);
    this.memory.addEvent({ type: 'user_command', data: text });
    logEvent('command', text);
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
