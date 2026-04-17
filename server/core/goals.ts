export enum GoalStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PAUSED = 'PAUSED'
}

export class GoalManager {
  private primaryGoal: string = "Maximize asset acquisition while maintaining absolute capital preservation.";
  private activeSubTasks: string[] = [
    "Scan real-time market data for macro anomalies.",
    "Cross-reference decentralized signals with historical success patterns.",
    "Formulate persistent insights in Long-Term Memory."
  ];
  private status: GoalStatus = GoalStatus.ACTIVE;
  private successCriteria: string[] = [];

  getGoals() {
    return {
      primary: this.primaryGoal,
      subTasks: this.activeSubTasks
    };
  }

  updateSubTasks(newTasks: string[]) {
    if (newTasks && newTasks.length > 0) {
      this.activeSubTasks = newTasks;
    }
  }

  overridePrimaryGoal(newGoal: string) {
    this.primaryGoal = newGoal;
    this.status = GoalStatus.ACTIVE;
  }

  getStatus(): GoalStatus {
    return this.status;
  }

  isComplete(): boolean {
    return this.status === GoalStatus.COMPLETED;
  }

  isFailed(): boolean {
    return this.status === GoalStatus.FAILED;
  }

  markCompleted() {
    this.status = GoalStatus.COMPLETED;
  }

  markFailed() {
    this.status = GoalStatus.FAILED;
  }

  pause() {
    this.status = GoalStatus.PAUSED;
  }

  resume() {
    if (this.status === GoalStatus.PAUSED) {
      this.status = GoalStatus.ACTIVE;
    }
  }

  addSuccessCriterion(criterion: string) {
    if (criterion && !this.successCriteria.includes(criterion)) {
      this.successCriteria.push(criterion);
    }
  }

  getSuccessCriteria(): string[] {
    return [...this.successCriteria];
  }
}
