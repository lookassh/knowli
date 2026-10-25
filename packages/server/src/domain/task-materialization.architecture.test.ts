import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

function boundaryViolations(source: string): string[] {
  const ast = ts.createSourceFile("task-materialization.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  const allowedTypes = new Set(["./scheduler", "@learning/contracts"]);

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "<non-literal import>";
      const typeOnly = node.importClause?.isTypeOnly === true;
      if (specifier === "./letter-fragment" && !typeOnly) {
        // The deterministic letter fragment is the sole runtime dependency.
      } else if (typeOnly && allowedTypes.has(specifier)) {
        // Types do not add a runtime dependency.
      } else {
        violations.push(`import:${specifier}`);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      violations.push(`re-export:${node.moduleSpecifier.getText(ast)}`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      violations.push(`import-equals:${node.moduleReference.expression?.getText(ast) ?? "<dynamic>"}`);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) violations.push("dynamic-import");
      if (ts.isIdentifier(node.expression) && (node.expression.text === "require" || node.expression.text === "randomUUID")) {
        violations.push(`call:${node.expression.text}`);
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const receiver = node.expression.getText(ast);
      if ((receiver === "Math" && node.name.text === "random")
        || (receiver === "crypto" && node.name.text === "randomUUID")
        || (receiver === "Date" && node.name.text === "now")
        || (receiver === "process" && node.name.text === "env")) {
        violations.push(`global:${receiver}.${node.name.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
  return violations;
}

describe("granica domenowej materializacji zadania", () => {
  it("dopuszcza wyłącznie runtime letter-fragment i typy domeny/kontraktu", () => {
    expect(boundaryViolations([
      'import { buildLetterFragment } from "./letter-fragment";',
      'import type { TaskPlan } from "./scheduler";',
      'import type { TaskPrompt } from "@learning/contracts";',
    ].join("\n"))).toEqual([]);
  });

  it("wykrywa zakazane wywołania także wewnątrz funkcji", () => {
    for (const sample of [
      'function build() { return Math.random(); }',
      'function build() { return crypto.randomUUID(); }',
      'function build() { return randomUUID(); }',
      'function build() { return Date.now(); }',
      'function build() { return process.env.SECRET; }',
    ]) expect(boundaryViolations(sample)).not.toEqual([]);
  });

  it.each([
    'import { eq } from "drizzle-orm";',
    'import type { Tx } from "../db/client";',
    'import type { X } from "@orpc/server";',
    'export { createServices } from "../config";',
    'import("../providers/fake");',
    'require("next/server");',
    'import x = require("../config");',
  ])("odrzuca zależność spoza wąskiej granicy: %s", (sample) => {
    expect(boundaryViolations(sample)).not.toEqual([]);
  });

  it("chroni rzeczywisty plik przed zależnościami i globalnymi efektami", () => {
    expect(boundaryViolations(readFileSync(new URL("./task-materialization.ts", import.meta.url), "utf8"))).toEqual([]);
  });
});
