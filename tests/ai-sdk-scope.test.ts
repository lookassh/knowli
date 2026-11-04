import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zakres AI SDK (etap 1 #237): `ai` i `@openrouter/*` wolno używać wyłącznie
 * w `tests/probes/**` oraz jako devDependencies roota. Kod produkcyjny
 * (źródła pakietów i aplikacji) ich nie importuje, a manifesty pakietów
 * i aplikacji nie deklarują tych zależności.
 */

const root = join(__dirname, "..");
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/u;
const SKIPPED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);
// Nazwany wyjątek (ścieżka względem korzenia repozytorium): test architektury
// agenta zawiera nazwy SDK wyłącznie jako dane w dowodzie czułości swojego skanu.
const SENSITIVITY_FIXTURES = new Set(["packages/server/src/domain/lessons/architecture.test.ts"]);

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
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
  it("żaden plik źródłowy pakietów i aplikacji nie importuje ai ani @openrouter/*", () => {
    const files = workspaces
      .flatMap((workspace) => sourceFiles(join(workspace, "src")))
      .filter((file) => !SENSITIVITY_FIXTURES.has(file.slice(root.length + 1).replaceAll("\\", "/")));
    // Dowód, że skan rzeczywiście znajduje pliki (nie fałszywie zielony).
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"))
        .filter(isAiSdkName)
        .map((specifier) => `${file.slice(root.length + 1)}: "${specifier}"`),
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
