import { defineConfig } from "@playwright/test";
import { readTestRunConfig } from "./tests/test-run-config";

const TEST_RUN_CONFIG = readTestRunConfig(process.env);

// Testy E2E: global-setup stawia PostgreSQL w dockerze, serwer `next dev`
// i proces workera — wszystko z fake providerami (bez kluczy API).
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: `http://127.0.0.1:${TEST_RUN_CONFIG.e2ePort}`,
    locale: "pl-PL",
    // sztuczne urządzenie medialne: przyznany mikrofon produkuje strumień,
    // a brak zgody nadal kończy się odmową (deterministyczne RF5)
    launchOptions: { args: ["--use-fake-device-for-media-stream"] },
    // ślad tylko z porażki — materiał diagnostyczny dla CI bez wpływu na zielone runy
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
