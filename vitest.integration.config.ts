import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testy integracyjne: prawdziwy PostgreSQL w kontenerze docker (global-setup),
// po jednym kontenerze na przebieg; pliki uruchamiane sekwencyjnie, każdy czyści
// własne tabele w beforeEach.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: "./tests/integration/global-setup.ts",
    environment: "node",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
