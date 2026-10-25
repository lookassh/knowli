import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

function violations(source: string): string[] {
  const ast = ts.createSourceFile("vocabulary-task-issuance.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const runtime = new Set(["drizzle-orm", "../db/schema", "./events", "./skill-projections"]);
  const types = new Set(["../db/client", "../domain/training-session-plan"]);
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "<non-literal>";
      if (node.importClause?.isTypeOnly ? !types.has(specifier) : !runtime.has(specifier)) found.push(`import:${specifier}`);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) found.push(`re-export:${node.moduleSpecifier.getText(ast)}`);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) found.push("import-equals");
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push("dynamic-import");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") found.push("require");
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "transaction") found.push("nested-transaction");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

describe("granica wspólnego wydania zadania słownictwa", () => {
  it("pozwala na typy transakcji i blokuje importy wsteczne oraz własny commit", () => {
    expect(violations([
      'import type { Tx } from "../db/client";',
      'import { eq } from "drizzle-orm";',
      'function issue(tx: Tx) { return tx.transaction(() => undefined); }',
    ].join("\n"))).toContain("nested-transaction");
    for (const sample of [
      'import { nextTask } from "./sessions";',
      'import { db } from "../db/client";',
      'export { nextTask } from "./sessions";',
      'import("./sessions");',
      'require("./sessions");',
    ]) expect(violations(sample)).not.toEqual([]);
  });

  it("chroni rzeczywisty plik writera", () => {
    expect(violations(readFileSync(new URL("./vocabulary-task-issuance.ts", import.meta.url), "utf8"))).toEqual([]);
  });
});
