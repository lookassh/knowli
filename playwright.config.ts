import { defineConfig } from "@playwright/test";
import { readTestRunConfig } from "./tests/test-run-config";
import { MOCKED_SPECS, REAL_BUCKETS, REAL_SPECS } from "./tests/e2e/spec-projects";

const TEST_RUN_CONFIG = readTestRunConfig(process.env);

// UMIEM_E2E_BUCKET wybiera jeden kosz czasowy projektu `real` (równoległe
// światy w runnerze shardów i CI); bez niego projekt obejmuje wszystkie specy.
const bucket = TEST_RUN_CONFIG.e2eBucket;
if (bucket !== null && (bucket < 1 || bucket > REAL_BUCKETS.length)) {
  throw new Error(
    `UMIEM_E2E_BUCKET=${bucket} poza zakresem: zdefiniowano ${REAL_BUCKETS.length} kosze (tests/e2e/spec-projects.ts)`,
  );
}
const realSpecs = bucket === null ? REAL_SPECS : REAL_BUCKETS[bucket - 1]!;

const sharedUse = {
  baseURL: `http://127.0.0.1:${TEST_RUN_CONFIG.e2ePort}`,
  locale: "pl-PL",
  // sztuczne urządzenie medialne: przyznany mikrofon produkuje strumień,
  // a brak zgody nadal kończy się odmową (deterministyczne RF5)
  launchOptions: { args: ["--use-fake-device-for-media-stream"] },
  // ślad tylko z porażki — materiał diagnostyczny dla CI bez wpływu na zielone runy
  trace: "retain-on-failure" as const,
};

// Testy E2E: global-setup stawia PostgreSQL w dockerze, serwer web
// (domyślnie build produkcyjny pod `next start`) i proces workera —
// wszystko z fake providerami (bez kluczy API).
//
// Dwa projekty (partycja w tests/e2e/spec-projects.ts):
// - `mocked`: API zaślepione w przeglądarce, testy bezstanowe — biegną
//   równolegle na `UMIEM_E2E_WORKERS` workerach (domyślnie 4);
// - `real`: prawdziwy świat (baza, worker, narastające dane) — szeregowo
//   na 1 workerze; równoległość dają kosze czasowe REAL_BUCKETS odpalane
//   jako osobne światy (`pnpm test:e2e:shards` lokalnie, matrix w CI).
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: TEST_RUN_CONFIG.outputDir,
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: TEST_RUN_CONFIG.e2eWorkers,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  projects: [
    {
      name: "mocked",
      testMatch: [...MOCKED_SPECS],
      fullyParallel: true,
      use: sharedUse,
    },
    {
      name: "real",
      testMatch: [...realSpecs],
      fullyParallel: false,
      workers: 1,
      use: sharedUse,
    },
  ],
  reporter: [["list"], ["github"]],
});
