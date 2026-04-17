export class GoalManager {
  private primaryGoal: string = "Maximize asset acquisition while maintaining absolute capital preservation.";
  private activeSubTasks: string[] = [
    "Scan real-time market data for macro anomalies.",
    "Cross-reference decentralized signals with historical success patterns.",
    "Formulate persistent insights in Long-Term Memory."
  ];

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
  }
}
