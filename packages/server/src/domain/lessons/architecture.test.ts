import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Test architektoniczny (design „Architecture”): silnik lekcji
 * (źródłowe `domain/lessons/*.ts` poza katalogami `subjects/` i `testing/`,
 * bez plików `*.test.ts`) nie importuje niczego z `subjects/`. Zależność biegnie
 * wyłącznie przez rejestr i interfejs `SubjectModule`, więc dodanie przedmiotu
 * nie zmienia silnika (Open/Closed).
 */

const lessonsDir = dirname(fileURLToPath(import.meta.url));
const EXEMPT_DIRS = new Set(["subjects", "testing"]);
// Import ścieżki zawierającej segment `/subjects/` lub zaczynającej się od `subjects/`.
const SUBJECTS_IMPORT = /\bfrom\s+["'](?:[^"']*\/)?subjects\/[^"']*["']/;

function collectEngineFiles(dir: string, relative: string[] = []): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...collectEngineFiles(join(dir, entry.name), [...relative, entry.name]));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe("granica importów silnika lekcji", () => {
  it("żaden plik silnika nie importuje z subjects/", () => {
    const files = collectEngineFiles(lessonsDir);
    // Dowód, że skan rzeczywiście znajduje pliki silnika (nie fałszywie zielony).
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => SUBJECTS_IMPORT.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("regex wykrywa import z subjects/ (dowód czułości testu)", () => {
    expect(SUBJECTS_IMPORT.test('import { x } from "./subjects/english-grammar/module";')).toBe(true);
    expect(SUBJECTS_IMPORT.test('import { x } from "../subjects/foo";')).toBe(true);
    expect(SUBJECTS_IMPORT.test('import { x } from "./registry";')).toBe(false);
    expect(SUBJECTS_IMPORT.test('import { x } from "./testing/history-like-subject";')).toBe(false);
  });
});
