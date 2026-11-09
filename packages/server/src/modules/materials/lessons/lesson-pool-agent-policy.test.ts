import { describe, expect, it } from "vitest";
import { DEFAULT_LESSON_GENERATION_POLICY } from "./lesson-generation-policy";
import { DEFAULT_LESSON_AGENT_POLICY, RunCostMeter } from "./lesson-pool-agent-policy";

describe("polityka agenta i licznik kosztu", () => {
  it("wartości domyślne z planu etapu 1", () => {
    expect(DEFAULT_LESSON_AGENT_POLICY).toEqual({
      maxStepsPerObjective: 8,
      concurrency: 4,
      checkerConcurrency: 4,
      checkerTimeoutMs: 90_000,
      callTimeoutMs: 90_000,
      objectiveTimeoutMs: 300_000,
      runTimeoutMs: DEFAULT_LESSON_GENERATION_POLICY.runTimeoutMs,
      runBudgetUsd: 1,
      unknownCallEstimateUsd: 0.02,
      graderConcurrency: 4,
      graderStageTimeoutMs: 30_000,
      unknownGraderCallEstimateUsd: 0.002,
      graderBreakerThreshold: 3,
    });
  });

  it("RunCostMeter(0, 0.05, 0.02): po 3 × 0.02 budżet wyczerpany (wydatek ≥ budżet)", () => {
    const meter = new RunCostMeter(0, 0.05, 0.02);
    meter.record(0.02);
    meter.record(0.02);
    expect(meter.exhausted()).toBe(false);
    meter.record(0.02);
    expect(meter.exhausted()).toBe(true);
    expect(meter.spentUsd).toBeCloseTo(0.06);
    expect(meter.unknownCalls).toBe(0);
  });

  it("koszt null liczy szacunkiem, a wydatek startuje od initialSpentUsd; równy budżetowi = wyczerpany", () => {
    const meter = new RunCostMeter(0.5, 1, 0.25);
    meter.record(null);
    expect(meter.spentUsd).toBeCloseTo(0.75);
    expect(meter.unknownCalls).toBe(1);
    meter.record(null);
    expect(meter.spentUsd).toBeCloseTo(1);
    expect(meter.exhausted()).toBe(true);
  });
});
