export interface TestRunConfig {
  integrationContainerPrefix: string;
  e2eContainer: string;
  e2ePort: number;
  worldFile: string;
}

export function readTestRunConfig(env: Record<string, string | undefined>): TestRunConfig {
  const runId = env.UMIEM_TEST_RUN_ID;
  if (runId !== undefined && !/^[a-z0-9-]+$/.test(runId)) {
    throw new Error("UMIEM_TEST_RUN_ID must contain only lowercase letters, digits, and hyphens");
  }

  const rawPort = env.UMIEM_E2E_PORT;
  if (rawPort !== undefined && !/^\d+$/.test(rawPort)) {
    throw new Error("UMIEM_E2E_PORT must be an integer from 1024 to 65535");
  }
  const e2ePort = rawPort === undefined ? 24500 : Number(rawPort);
  if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65535) {
    throw new Error("UMIEM_E2E_PORT must be an integer from 1024 to 65535");
  }

  return {
    integrationContainerPrefix: runId ? `knowli-it-${runId}-` : "knowli-it-",
    e2eContainer: runId ? `knowli-e2e-${runId}` : "knowli-e2e",
    e2ePort,
    worldFile: `tests/e2e/${runId ? `.world-${runId}.json` : ".world.json"}`,
  };
}
