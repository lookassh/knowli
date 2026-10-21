import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testy domenowe: czysta logika z kontrolowanym zegarem, bez bazy i sieci.
// Do czasu zadania 5 nie ma jeszcze plików domenowych; passWithNoTests utrzymuje
// skrypt użyteczny od pierwszego zadania.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx", "apps/*/src/**/*.test.ts", "apps/*/src/**/*.test.tsx", "tests/test-run-config.test.ts"],
    passWithNoTests: true,
    environment: "node",
  },
});
