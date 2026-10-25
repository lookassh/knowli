import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const generation = "modules/generation.ts";
const lesson = "modules/lessons/lesson-drafts.ts";
const worker = "modules/generation-worker.ts";

function localTarget(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
}

function sourceFile(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function backwardDependencies(file: string, source: string): string[] {
  const forbidden = new Set(file === generation ? [worker, lesson] : [worker]);
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

function workerExports(source: string): Array<{ original: string; exported: string; target: string }> {
  const found: Array<{ original: string; exported: string; target: string }> = [];
  for (const node of sourceFile("index.ts", source).statements) {
    if (!ts.isExportDeclaration(node) || !node.moduleSpecifier
      || !ts.isStringLiteralLike(node.moduleSpecifier)
      || !node.exportClause || !ts.isNamedExports(node.exportClause)) continue;
    for (const element of node.exportClause.elements) {
      const original = (element.propertyName ?? element.name).text;
      if (original === "runDueGenerationWork" || original === "WorkerLimits") {
        found.push({ original, exported: element.name.text, target: localTarget("index.ts", node.moduleSpecifier.text) });
      }
    }
  }
  return found;
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
    expect(backwardDependencies(lesson, "import { claimQueuedRun } from '../generation';"))
      .toEqual([]);
    expect(backwardDependencies(generation, "import { applyItems } from './decks';"))
      .toEqual([]);
  });

  it("rozpoznaje oryginalne i publiczne nazwy reeksportu przy aliasach", () => {
    expect(workerExports("export { runDueGenerationWork as run, type WorkerLimits as Limits } from './modules/generation-worker';"))
      .toEqual([
        { original: "runDueGenerationWork", exported: "run", target: worker },
        { original: "WorkerLimits", exported: "Limits", target: worker },
      ]);
  });

  it("wykonawcy nie importują ani nie reeksportują koordynatora", () => {
    for (const file of [generation, lesson]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(backwardDependencies(file, source), file).toEqual([]);
    }
  });

  it("publiczne API eksportuje poller i limity bezpośrednio z koordynatora", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(workerExports(source)).toEqual([
      { original: "runDueGenerationWork", exported: "runDueGenerationWork", target: worker },
      { original: "WorkerLimits", exported: "WorkerLimits", target: worker },
    ]);
  });
});
