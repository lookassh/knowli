export interface TestRunConfig {
  integrationContainerPrefix: string;
  e2eContainer: string;
  e2ePort: number;
  workerHealthPort: number;
  worldFile: string;
  outputDir: string;
  e2eWebMode: "start" | "dev";
  e2eSkipBuild: boolean;
  e2eWorkers: number;
  e2eBucket: number | null;
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

  const rawWorkerPort = env.UMIEM_WORKER_HEALTH_PORT;
  if (rawWorkerPort !== undefined && !/^\d+$/.test(rawWorkerPort)) {
    throw new Error("UMIEM_WORKER_HEALTH_PORT must be an integer from 1024 to 65535");
  }
  const workerHealthPort = rawWorkerPort === undefined
    ? runId ? 10_000 + (e2ePort % 50_000) : 9301
    : Number(rawWorkerPort);
  if (!Number.isInteger(workerHealthPort) || workerHealthPort < 1024 || workerHealthPort > 65535) {
    throw new Error("UMIEM_WORKER_HEALTH_PORT must be an integer from 1024 to 65535");
  }

  const rawWebMode = env.UMIEM_E2E_WEB_MODE;
  if (rawWebMode !== undefined && rawWebMode !== "start" && rawWebMode !== "dev") {
    throw new Error('UMIEM_E2E_WEB_MODE must be "start" or "dev"');
  }
  const e2eWebMode = rawWebMode === "dev" ? "dev" : "start";

  const rawSkipBuild = env.UMIEM_E2E_SKIP_BUILD;
  if (rawSkipBuild !== undefined && rawSkipBuild !== "0" && rawSkipBuild !== "1") {
    throw new Error('UMIEM_E2E_SKIP_BUILD must be "0" or "1"');
  }
  const e2eSkipBuild = rawSkipBuild === "1";

  const rawWorkers = env.UMIEM_E2E_WORKERS;
  if (rawWorkers !== undefined && !/^\d+$/.test(rawWorkers)) {
    throw new Error("UMIEM_E2E_WORKERS must be an integer from 1 to 32");
  }
  const e2eWorkers = rawWorkers === undefined ? 4 : Number(rawWorkers);
  if (!Number.isInteger(e2eWorkers) || e2eWorkers < 1 || e2eWorkers > 32) {
    throw new Error("UMIEM_E2E_WORKERS must be an integer from 1 to 32");
  }

  // Kosz czasowy projektu `real` (REAL_BUCKETS w tests/e2e/spec-projects.ts);
  // brak albo pusta wartość (np. pozycja matrixa CI bez kosza) = wszystkie
  // specy. Zgodność indeksu z liczbą koszy sprawdza playwright.config.ts.
  const rawBucket = env.UMIEM_E2E_BUCKET;
  if (rawBucket !== undefined && rawBucket !== "" && !/^[1-9]$/.test(rawBucket)) {
    throw new Error("UMIEM_E2E_BUCKET must be an integer from 1 to 9");
  }
  const e2eBucket = rawBucket === undefined || rawBucket === "" ? null : Number(rawBucket);

  return {
    integrationContainerPrefix: runId ? `knowli-it-${runId}-` : "knowli-it-",
    e2eContainer: runId ? `knowli-e2e-${runId}` : "knowli-e2e",
    e2ePort,
    workerHealthPort,
    worldFile: `tests/e2e/${runId ? `.world-${runId}.json` : ".world.json"}`,
    // Równoległe procesy Playwright czyszczą wspólny outputDir na starcie
    // i kasują sobie nawzajem artefakty; run z własnym ID ma własny katalog.
    outputDir: runId ? `test-results/${runId}` : "test-results",
    e2eWebMode,
    e2eSkipBuild,
    e2eWorkers,
    e2eBucket,
  };
}
