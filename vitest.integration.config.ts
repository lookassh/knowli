import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { INTEGRATION_BUCKETS } from "./tests/integration-buckets";
import { readTestRunConfig } from "./tests/test-run-config";

// Testy integracyjne: prawdziwy PostgreSQL w kontenerze docker (global-setup),
// po jednym kontenerze na przebieg; pliki uruchamiane sekwencyjnie, każdy czyści
// własne tabele w beforeEach.
//
// UMIEM_INTEGRATION_BUCKET wybiera jeden kosz czasowy (równoległe joby CI,
// każdy z własnym kontenerem); bez niego config obejmuje wszystkie pliki.
const bucket = readTestRunConfig(process.env).integrationBucket;
if (bucket !== null && (bucket < 1 || bucket > INTEGRATION_BUCKETS.length)) {
  throw new Error(
    `UMIEM_INTEGRATION_BUCKET=${bucket} poza zakresem: zdefiniowano ${INTEGRATION_BUCKETS.length} kosze (tests/integration-buckets.ts)`,
  );
}
const include = bucket === null
  ? ["tests/integration/**/*.test.ts"]
  : [...INTEGRATION_BUCKETS[bucket - 1]!];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include,
    globalSetup: "./tests/integration/global-setup.ts",
    environment: "node",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
