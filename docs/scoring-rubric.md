# RSEA Agent — Scoring & Evaluation Rubric

This document explains every score that the agent produces and how each one flows
into automated decision-making.

---

## 1. Evaluator score (pre-execution)

**Source:** `server/modules/evaluator.ts` → `Evaluator.rankStrategies()`  
**Range:** 0–100  
**When:** Before any action is executed.

The Evaluator asks the LLM to score each candidate task against the current objective.
Scores reflect *predicted* value before any real-world feedback.

| Range | Interpretation |
|-------|---------------|
| 0–60  | Low confidence — task will be **blocked** by the RulesEngine threshold |
| 61–80 | Moderate confidence — task is approved for execution |
| 81–100| High confidence — task is approved; may trigger risk tolerance increase |

---

## 2. RulesEngine confidence gate

**Source:** `server/core/rules.ts` → `RulesEngine.apply()`  
**Threshold:** `CONFIDENCE_THRESHOLD` env var (default `60`)  
**Effect:** Tasks with score ≤ threshold are **blocked** before reaching the Sniper.

The effective threshold is scaled by `DECISION_AGGRESSIVENESS` (0–1):

```
effectiveThreshold = confidenceThreshold * aggressiveness
```

---

## 3. Comparator evaluation score (post-execution)

**Source:** `server/core/evaluation/comparator.ts` → `Comparator.compare()`  
**Range:** 0 or 100 (binary)  
**When:** After execution, based on the Observer's outcome.

| `state_change` | Score | Meaning |
|---------------|-------|---------|
| `true`        | 100   | Execution produced a state change — task succeeded |
| `false`       | 0     | No state change observed — task failed or was a no-op |

**Dry-run proxy (G5 fix):** When `DRY_RUN=true`, execution feedback is unavailable
and the comparator would always return 0.  Instead, the Controller uses the
Evaluator's pre-execution score as a proxy so that the auto-rollback mechanism
receives meaningful signal even in simulation mode.

---

## 4. AdversarialScorer composite score (Phase 7)

**Source:** `server/core/adversarial/scorer.ts` → `AdversarialScorer.score()`  
**Range:** 0–100 (weighted composite)  
**When:** Every `ADVERSARIAL_EVERY_N_CYCLES` cycles (default 20).

```
composite = success_rate × 0.5
          + efficiency    × 0.3
          + (100 – risk_score) × 0.2
```

| Overall score | Strategy adjustment |
|---------------|---------------------|
| ≥ 70 (robust) | `risk_tolerance += 0.05` (slightly more aggressive) |
| < 40 (fragile)| `risk_tolerance -= 0.05` (more conservative) |
| 40–69         | No change |

---

## 5. Strategy auto-rollback

**Source:** `server/modules/controller.ts` → `checkAndRollbackStrategy()`  
**Trigger:** Fires each cycle if post-execution evaluation scores are available.

A rollback is triggered when:

1. At least `MIN_SCORES_FOR_ROLLBACK` (3) evaluation scores have been collected.
2. The current cycle's average score is more than `ROLLBACK_DROP_THRESHOLD` (20)
   points below the long-run historical mean.

The strategy is restored to the most recently committed version in
`StrategyVersioning`.

---

## 6. Example single-cycle flow

```
Objective: "Identify and act on the best BTC signal"

1. Spotter scans → 3 observations returned
2. Planner decomposes → 2 tasks: [t1: Research signal (score=82), t2: Simulate trade (score=71)]
3. Evaluator ranks  → t1 approved (82 > 60), t2 approved (71 > 60)
4. Sniper executes t1 via tool='simulate'
   → Executor: deterministic hash of payload → luck=0.43 < 0.95 → "Simulated Execution optimized successfully"
   → result.status = 'simulated', result.success = true
5. Observer: state_change = true
6. Comparator: score = 100
7. Memory: evaluation stored (score=100)
8. evaluationScores.push(100); allAvg ≈ 100; no rollback

On cycle 20:
9. runAdversarialCycle() fires → RedTeamOrchestrator 5-step attack simulation
   → AdversarialScorer composite = 74 (≥ 70) → risk_tolerance += 0.05
```

---

## 7. Mitigation output format

When the adversarial cycle completes, the following structured event is logged:

```json
{
  "stage": "adversarial_cycle_complete",
  "data": {
    "opportunityId": "opp_1713494400000",
    "robustnessScore": 74,
    "overallScore": 74,
    "strategyUpdate": {
      "risk_tolerance": 0.55
    }
  },
  "traceId": "3f2a1b4c-...",
  "time": "2026-04-19T01:30:00.000Z"
}
```

All strategy mutations also emit a `strategy_updated` event:

```json
{
  "stage": "strategy_updated",
  "data": {
    "version": 3,
    "change": "Adversarial cycle: high robustness (74)",
    "impact": 74
  }
}
```

Strategy version history is queryable via `GET /api/status` → `strategy.history`.
