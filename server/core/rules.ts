import { CONFIDENCE_THRESHOLD, DECISION_AGGRESSIVENESS } from './config';

export interface Action {
  action: string;
  target: any;
}

export class RulesEngine {
  /**
   * Applies hard constraints and filters to decide on actions.
   * Uses CONFIDENCE_THRESHOLD (env: CONFIDENCE_THRESHOLD, default 60) as the
   * minimum score required to engage, and DECISION_AGGRESSIVENESS (0–1) to
   * stochastically suppress low-confidence signals when the agent is in
   * a conservative posture.
   */
  apply(scoredItems: any[]): Action[] {
    const actions: Action[] = [];

    for (const item of scoredItems) {
      // Threshold gatekeeping — respects the tunable confidence threshold
      if (item.score > CONFIDENCE_THRESHOLD) {
        // Aggressiveness gate: conservative agents skip actions that only barely
        // pass the threshold unless the aggressiveness is high enough.
        const normalised = Math.min((item.score - CONFIDENCE_THRESHOLD) / (100 - CONFIDENCE_THRESHOLD), 1);
        if (normalised >= (1 - DECISION_AGGRESSIVENESS)) {
          actions.push({
            action: 'engage',
            target: item
          });
        }
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
