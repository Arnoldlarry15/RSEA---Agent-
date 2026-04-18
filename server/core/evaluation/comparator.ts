import type { Observation } from '../observation/observer';

export interface Comparison {
  delta: string;
  success: boolean;
  score: number;
}

export class Comparator {
  compare(expected: any, actual: Observation): Comparison {
    const success = actual.state_change;
    const score = success ? 100 : 0;
    const expectedStr = typeof expected === 'string' ? expected : JSON.stringify(expected);
    const delta = success
      ? `Outcome matched expected: ${expectedStr}`
      : `Expected: ${expectedStr} | Actual: ${actual.actual_outcome}`;
    return { delta, success, score };
  }
}
