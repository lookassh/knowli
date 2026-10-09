import { describe, expect, it } from "vitest";
import { readTestRunConfig } from "./test-run-config";

describe("readTestRunConfig", () => {
  it("isolates runner resources by run ID", () => {
    const a = readTestRunConfig({ UMIEM_TEST_RUN_ID: "run-a", UMIEM_E2E_PORT: "24510" });
    const b = readTestRunConfig({ UMIEM_TEST_RUN_ID: "run-b", UMIEM_E2E_PORT: "24511" });

    expect(a.integrationContainerPrefix).not.toBe(b.integrationContainerPrefix);
    expect(a.e2eContainer).not.toBe(b.e2eContainer);
    expect(a.worldFile).not.toBe(b.worldFile);
    expect(a.workerHealthPort).not.toBe(b.workerHealthPort);
    expect(a.e2ePort).toBe(24510);
    expect(b.e2ePort).toBe(24511);
    expect(a.workerHealthPort).toBe(34510);
    expect(b.workerHealthPort).toBe(34511);
  });

  it("preserves the current runner defaults", () => {
    expect(readTestRunConfig({})).toEqual({
      integrationContainerPrefix: "knowli-it-",
      e2eContainer: "knowli-e2e",
      e2ePort: 24500,
      workerHealthPort: 9301,
      worldFile: "tests/e2e/.world.json",
    });
  });

  it.each(["", "Run-A", "run_a", "../run-a", "run/a"])("rejects unsafe run ID %j", (runId) => {
    expect(() => readTestRunConfig({ UMIEM_TEST_RUN_ID: runId })).toThrow(/UMIEM_TEST_RUN_ID/);
  });

  it.each(["", "abc", "1023", "65536", "24x10"])("rejects invalid E2E port %j", (port) => {
    expect(() => readTestRunConfig({ UMIEM_E2E_PORT: port })).toThrow(/UMIEM_E2E_PORT/);
  });

  it.each(["", "abc", "1023", "65536", "24x10"])("rejects invalid worker health port %j", (port) => {
    expect(() => readTestRunConfig({ UMIEM_WORKER_HEALTH_PORT: port })).toThrow(/UMIEM_WORKER_HEALTH_PORT/);
  });
});
