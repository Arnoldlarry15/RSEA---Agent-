export interface Observation {
  actual_outcome: string;
  state_change: boolean;
}

export class Observer {
  observe(actionResult: any): Observation {
    return {
      actual_outcome: actionResult?.outcome ?? JSON.stringify(actionResult),
      state_change: actionResult?.success === true,
    };
  }
}
