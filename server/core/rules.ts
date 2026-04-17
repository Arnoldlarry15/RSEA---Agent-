export interface Action {
  action: string;
  target: any;
}

export class RulesEngine {
  /**
   * Applies hard constraints and filters to decide on actions
   */
  apply(scoredItems: any[]): Action[] {
    const actions: Action[] = [];

    for (const item of scoredItems) {
      // Threshold gatekeeping
      if (item.score > 60) {
        actions.push({
          action: 'engage',
          target: item
        });
      }
      
      // Safety rule: Never engage with high-risk looking sources without extreme score
      if (item.score > 90) {
         actions.push({
           action: 'priority_alert',
           target: item
         });
      }
    }

    return actions;
  }
}
