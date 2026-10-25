import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const generation = "modules/materials/generation.ts";
const lesson = "modules/materials/lessons/lesson-drafts.ts";
const worker = "modules/materials/generation-worker.ts";
const media = "modules/materials/media-generation.ts";
const runtime = "modules/materials/generation-runtime.ts";
const runs = "modules/materials/generation-runs.ts";
const materialsBarrel = "modules/materials/index.ts";
const publicNames = new Set([
  "runDueGenerationWork", "WorkerLimits", "executeMediaAsset",
  "requireGeneration", "errorCodeOf", "MAX_AUTOMATIC_ATTEMPTS",
  "enqueueGenerationRun", "claimQueuedRun", "markRun",
]);

function localTarget(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
  if (resolved === "modules/materials") return materialsBarrel;
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

function sourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function backwardDependencies(file: string, source: string): string[] {
  const forbidden = new Set(file === generation
    ? [worker, lesson]
    : file === media
      ? [generation, worker, lesson]
      : file === runtime || file === runs
        ? [generation, worker, lesson, media]
        : [worker, media, generation]);
  const found: string[] = [];
  function record(node: ts.Node | undefined): void {
    if (node && ts.isStringLiteralLike(node)) {
      const target = localTarget(file, node.text);
      if (forbidden.has(target)) found.push(target);
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      record(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile(file, source));
  return found;
}

function publicExports(source: string, baseFile = "index.ts"): Array<{ original: string; exported: string; target: string }> {
  const found: Array<{ original: string; exported: string; target: string }> = [];
  for (const node of sourceFile(baseFile, source).statements) {
    if (!ts.isExportDeclaration(node) || !node.moduleSpecifier
      || !ts.isStringLiteralLike(node.moduleSpecifier)
      || !node.exportClause || !ts.isNamedExports(node.exportClause)) continue;
    for (const element of node.exportClause.elements) {
      const original = (element.propertyName ?? element.name).text;
      if (publicNames.has(original)) {
        found.push({ original, exported: element.name.text, target: localTarget(baseFile, node.moduleSpecifier.text) });
      }
    }
  }
  return found;
}

function topLevelDeclarations(source: string): string[] {
  const names: string[] = [];
  for (const node of sourceFile(generation, source).statements) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.push(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      names.push(...node.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : []));
    }
  }
  return names;
}

describe("granica koordynacji generowania", () => {
  it.each([
    'import { runDueGenerationWork } from "./generation-worker";',
    "import { runDueGenerationWork as run } from './generation-worker';",
    "export { runDueGenerationWork as run } from './generation-worker';",
    "export * from './generation-worker';",
    "import('./generation-worker');",
    "require('./generation-worker');",
    "import worker = require('./generation-worker');",
    "import { executeLessonGeneration as execute } from './lessons/../lessons/lesson-drafts.ts';",
  ])("rozpoznaje zależność wsteczną: %s", (source) => {
    expect(backwardDependencies(generation, source)).toHaveLength(1);
  });

  it("rozwiązuje ścieżki względem pliku lekcji i pozwala na pomocniki generowania", () => {
    expect(backwardDependencies(lesson, "import { runDueGenerationWork as run } from '../generation-worker';"))
      .toEqual([worker]);
    expect(backwardDependencies(lesson, "import { claimQueuedRun } from '../generation-runs';"))
      .toEqual([]);
    expect(backwardDependencies(lesson, "import { claimQueuedRun } from '../generation';"))
      .toEqual([generation]);
    expect(backwardDependencies(generation, "import { markRun } from './generation-runs';"))
      .toEqual([]);
    expect(backwardDependencies(generation, "import { applyItems } from './decks';"))
      .toEqual([]);
    expect(backwardDependencies(media, "import { requireGeneration } from './generation-runtime';"))
      .toEqual([]);
    expect(backwardDependencies(runtime, "import type { Services } from '../../config';"))
      .toEqual([]);
  });

  it("rozpoznaje oryginalne i publiczne nazwy reeksportu przy aliasach", () => {
    expect(publicExports("export { runDueGenerationWork as run, type WorkerLimits as Limits } from './modules/materials/generation-worker';"))
      .toEqual([
        { original: "runDueGenerationWork", exported: "run", target: worker },
        { original: "WorkerLimits", exported: "Limits", target: worker },
      ]);
  });

  it("wykonawcy nie importują ani nie reeksportują koordynatora", () => {
    for (const file of [generation, lesson]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(backwardDependencies(file, source), file).toEqual([]);
    }
  });

  it("wykonawca mediów, wspólne wsparcie i cykl życia runów nie zależą wstecz od treści ani koordynacji", () => {
    for (const file of [media, runtime, runs]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      expect(backwardDependencies(file, source), file).toEqual([]);
    }
  });

  it("wspólne elementy i wykonawca mediów mają jedno źródło implementacji", () => {
    const source = readFileSync(new URL("./generation.ts", import.meta.url), "utf8");
    expect(topLevelDeclarations(source)).not.toContain("executeMediaAsset");
    expect(topLevelDeclarations(source)).not.toContain("requireGeneration");
    expect(topLevelDeclarations(source)).not.toContain("errorCodeOf");
    expect(topLevelDeclarations(source)).not.toContain("MAX_AUTOMATIC_ATTEMPTS");
    expect(topLevelDeclarations(source)).not.toContain("enqueueGenerationRun");
    expect(topLevelDeclarations(source)).not.toContain("claimQueuedRun");
    expect(topLevelDeclarations(source)).not.toContain("markRun");
    expect(topLevelDeclarations(source)).not.toContain("supersedeLessonRuns");
  });

  it("publiczne API eksportuje operacje z ich modułów właścicielskich", () => {
    const barrelSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(publicExports(barrelSource, materialsBarrel)).toEqual(expect.arrayContaining([
      { original: "runDueGenerationWork", exported: "runDueGenerationWork", target: worker },
      { original: "WorkerLimits", exported: "WorkerLimits", target: worker },
      { original: "executeMediaAsset", exported: "executeMediaAsset", target: media },
      { original: "requireGeneration", exported: "requireGeneration", target: runtime },
      { original: "errorCodeOf", exported: "errorCodeOf", target: runtime },
      { original: "MAX_AUTOMATIC_ATTEMPTS", exported: "MAX_AUTOMATIC_ATTEMPTS", target: runtime },
      { original: "enqueueGenerationRun", exported: "enqueueGenerationRun", target: runs },
      { original: "claimQueuedRun", exported: "claimQueuedRun", target: runs },
      { original: "markRun", exported: "markRun", target: runs },
    ]));
    const rootSource = readFileSync(new URL("../../index.ts", import.meta.url), "utf8");
    const rootExports = publicExports(rootSource);
    expect(rootExports.map((entry) => entry.original).sort()).toEqual([...publicNames].sort());
    expect(rootExports.every((entry) => entry.target === materialsBarrel && entry.exported === entry.original)).toBe(true);
  });
});
