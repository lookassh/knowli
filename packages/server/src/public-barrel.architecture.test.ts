import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Publiczny barrel pakietu (`src/index.ts`) ma być wąski: każda nazwana
 * pozycja musi mieć produkcyjnego importera (`apps/`, `deploy/`, `scripts/`,
 * bez plików testowych). Nazwa potrzebna tylko testom idzie do
 * `src/testing.ts` (`@learning/server/testing`); nieużywaną usuń.
 */
const ROOT = join(import.meta.dirname, "../../..");

function namedBindings(file: string, specifier: string | null): string[] {
  const ast = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  ast.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return;
    if (specifier !== null && (node.moduleSpecifier as ts.StringLiteral | undefined)?.text !== specifier) return;
    const clause = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : node.exportClause;
    if (!clause || !(ts.isNamedImports(clause) || ts.isNamedExports(clause))) return;
    for (const element of clause.elements) {
      // eksport liczymy pod nazwą publiczną, import pod nazwą źródłową
      names.push((specifier === null ? element.name : element.propertyName ?? element.name).text);
    }
  });
  return names;
}

describe("publiczny barrel @learning/server", () => {
  it("eksportuje tylko nazwy importowane przez kod produkcyjny, a ten nie sięga po wejście testowe", () => {
    const consumers = execFileSync("git", ["ls-files", "apps", "deploy", "scripts"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file));
    const used = new Set(consumers.flatMap((file) => namedBindings(file, "@learning/server")));
    const unused = namedBindings("packages/server/src/index.ts", null).filter((name) => !used.has(name));
    expect(unused).toEqual([]);
    expect(consumers.filter((file) => readFileSync(join(ROOT, file), "utf8").includes("@learning/server/testing"))).toEqual([]);
  });
});
