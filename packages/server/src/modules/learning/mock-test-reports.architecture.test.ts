import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const runtimeImports = new Set([
  "../materials",
  "./mock-tests",
  "./lessons/lesson-mock-tests",
]);
const typeImports = new Set(["../../config", "@learning/contracts"]);

function facadeViolations(source: string): string[] {
  const ast = ts.createSourceFile("mock-test-reports.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const specifier = ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : "<non-literal>";
      const allowed = node.importClause?.isTypeOnly ? typeImports : runtimeImports;
      if (!allowed.has(specifier)) found.push(`import:${specifier}`);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      found.push(`re-export:${node.moduleSpecifier.getText(ast)}`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push("import-equals");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push("dynamic-import");
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") found.push("require");
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "transaction") found.push("nested-transaction");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

function routerViolations(source: string): string[] {
  const ast = ts.createSourceFile("router.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const forbidden = new Set([
    "getMockTestReport", "getLessonMockTestReport", "listMockTests", "listLessonMockTests",
    "readMockTestSummary", "readLessonMockTestSummary", "mockTestKindOfSession", "readDeckKind",
  ]);
  const found: string[] = [];
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier.getText(ast) !== '"@learning/server"') continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const original = (element.propertyName ?? element.name).text;
        if (forbidden.has(original)) found.push(original);
      }
    }
  }
  return found;
}

describe("granica raportowania kartkówek", () => {
  it("pozwala fasadzie tylko na dispatch i blokuje transakcje oraz importy wsteczne", () => {
    expect(facadeViolations([
      'import type { Services } from "../../config";',
      'import { readDeckKind } from "../materials";',
      'function read(services: Services) { return services.db.transaction(() => readDeckKind); }',
    ].join("\n"))).toContain("nested-transaction");
    for (const sample of [
      'import { kidRouter } from "../../apps/web/src/orpc/kid-router";',
      'import { services } from "../..";',
      'export { readDeckKind } from "../materials";',
      'import("./mock-tests");',
      'require("./mock-tests");',
    ]) expect(facadeViolations(sample)).not.toEqual([]);
    expect(facadeViolations(readFileSync(new URL("./mock-test-reports.ts", import.meta.url), "utf8"))).toEqual([]);
  });

  it("routery nie importują wewnętrznych dispatchy ani klasyfikatorów", () => {
    for (const path of [
      new URL("../../../../../apps/web/src/orpc/kid-router.ts", import.meta.url),
      new URL("../../../../../apps/web/src/orpc/parent-router.ts", import.meta.url),
    ]) {
      expect(routerViolations(readFileSync(path, "utf8"))).toEqual([]);
    }
    expect(routerViolations([
      'import { getLessonMockTestReport, readDeckKind } from "@learning/server";',
    ].join("\n"))).toEqual(["getLessonMockTestReport", "readDeckKind"]);
    expect(routerViolations([
      'import { getLessonMockTestReport as report, readDeckKind as kind } from "@learning/server";',
    ].join("\n"))).toEqual(["getLessonMockTestReport", "readDeckKind"]);
  });
});
