import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

function forbiddenDependencies(source: string): string[] {
  const ast = ts.createSourceFile("task-completion.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden: string[] = [];

  const moduleName = (node: ts.StringLiteralLike): string => node.text;

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteralLike(node.moduleSpecifier)) {
        forbidden.push("<non-literal import>");
      } else {
        const specifier = moduleName(node.moduleSpecifier);
        if (!(node.importClause?.isTypeOnly && specifier === "./types")) {
          forbidden.push(specifier);
        }
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      forbidden.push(moduleName(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) forbidden.push(moduleName(expression));
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        forbidden.push("dynamic import");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        forbidden.push("require");
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);
  return forbidden;
}

describe("granica zależności reguły zakończenia zadania", () => {
  it("pozwala na import typów domenowych jako type-only", () => {
    expect(forbiddenDependencies('import type { SkillOutcome } from "./types";')).toEqual([]);
  });

  it("odrzuca import bez literału ścieżki modułu", () => {
    expect(forbiddenDependencies("import x from moduleName;")).toEqual(["<non-literal import>"]);
  });

  it("chroni plik reguły przed zależnościami infrastruktury", () => {
    const source = readFileSync(new URL("./task-completion.ts", import.meta.url), "utf8");
    expect(forbiddenDependencies(source)).toEqual([]);
  });

  it.each([
    'import { eq } from "drizzle-orm";',
    'import type { Tx } from "../db/client";',
    'import type { AttemptInput } from "@learning/contracts";',
    'export { createServices } from "../config";',
    'import("../providers/fake");',
    'require("next/server");',
    'import type { X } from "@orpc/server";',
    'import x = require("../config");',
  ])("odrzuca zależność spoza typów domenowych: %s", (source) => {
    expect(forbiddenDependencies(source)).not.toEqual([]);
  });
});
