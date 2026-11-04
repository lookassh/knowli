import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zakres AI SDK (etap 1 #237): `ai` i `@openrouter/*` wolno używać wyłącznie
 * w `tests/probes/**` oraz jako devDependencies roota. Żaden inny plik
 * źródłowy repozytorium (pakiety, aplikacje, skrypty, testy, integracje) ich
 * nie importuje, a manifesty pakietów i aplikacji nie deklarują tych zależności.
 */

const root = join(__dirname, "..");
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
/** Katalogi pomijane na każdej głębokości: zależności, git i artefakty buildów oraz testów. */
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "test-results", "playwright-report", ".venv"]);
/** Katalogi pomijane po ścieżce względem korzenia: jedyne miejsce, gdzie SDK jest dozwolone. */
const ALLOWED_DIRS = new Set(["tests/probes"]);
// Nazwane wyjątki (ścieżka względem korzenia repozytorium): testy architektury zawierają nazwy SDK
// wyłącznie jako dane w dowodach czułości swoich skanów.
const SENSITIVITY_FIXTURES = new Set(["packages/server/src/domain/lessons/architecture.test.ts", "tests/ai-sdk-scope.test.ts"]);

function relativeToRoot(path: string): string {
  return path.slice(root.length + 1).replaceAll("\\", "/");
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ALLOWED_DIRS.has(relativeToRoot(path)) ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry.name) ? [path] : [];
  });
}

/** Specyfikatory z `from "x"`, `import "x"`, `import("x")` i `require("x")`. */
function importSpecifiers(source: string): string[] {
  const pattern = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/gu;
  return [...source.matchAll(pattern)].map((match) => match[1]!);
}

function isAiSdkName(name: string): boolean {
  return name === "ai" || name.startsWith("ai/") || name.startsWith("@openrouter/");
}

function workspaceDirs(parent: string): string[] {
  const dir = join(root, parent);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => join(dir, entry.name));
}

const workspaces = [...workspaceDirs("packages"), ...workspaceDirs("apps")];

describe("zakres AI SDK", () => {
  it("żaden plik źródłowy repozytorium poza tests/probes nie importuje ai ani @openrouter/*", () => {
    const files = sourceFiles(root).filter((file) => !SENSITIVITY_FIXTURES.has(relativeToRoot(file)));
    // Dowód, że skan rzeczywiście obejmuje całe repozytorium (nie fałszywie zielony).
    expect(files.length).toBeGreaterThan(100);
    const scanned = new Set(files.map(relativeToRoot));
    for (const sample of ["packages/server/src/index.ts", "tests/integration-buckets.test.ts", "vitest.unit.config.ts"]) {
      expect(scanned.has(sample), sample).toBe(true);
    }
    expect([...scanned].some((path) => path.startsWith("tests/probes/"))).toBe(false);
    expect([...scanned].some((path) => path.includes("node_modules/"))).toBe(false);

    const offenders = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter(isAiSdkName)
        .map((specifier) => `${relativeToRoot(file)}: "${specifier}"`),
    );
    expect(offenders).toEqual([]);
  });

  it("manifesty pakietów i aplikacji nie deklarują ai ani @openrouter/*", () => {
    const manifests = workspaces.map((workspace) => join(workspace, "package.json")).filter(existsSync);
    expect(manifests.length).toBeGreaterThanOrEqual(5);

    const offenders = manifests.flatMap((manifest) => {
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, Record<string, string> | undefined>;
      const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
        Object.keys(pkg[field] ?? {}),
      );
      return declared.filter(isAiSdkName).map((name) => `${manifest.slice(root.length + 1)}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it("wykrywa importy SDK w różnych formach (dowód czułości testu)", () => {
    const found = (source: string) => importSpecifiers(source).filter(isAiSdkName);
    expect(found('import { generateText } from "ai";')).toEqual(["ai"]);
    expect(found("import { x } from 'ai/rsc';")).toEqual(["ai/rsc"]);
    expect(found('import "@openrouter/ai-sdk-provider";')).toEqual(["@openrouter/ai-sdk-provider"]);
    expect(found('const m = await import("ai");')).toEqual(["ai"]);
    expect(found('const m = require("@openrouter/sdk");')).toEqual(["@openrouter/sdk"]);
    expect(found('import { a } from "./airline";\nimport { z } from "zod";')).toEqual([]);
    expect(isAiSdkName("ai")).toBe(true);
    expect(isAiSdkName("aixyz")).toBe(false);
  });
});
