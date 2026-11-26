import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * Granice obszarów produktu w `packages/server/src/modules` (design
 * modularnego monolitu): `materials`, `learning`, `family`, `reporting`.
 *
 * - Kierunki zależności: reporting → learning → materials, każdy obszar może
 *   zależeć od `family`; moduły źródłowe nigdy nie importują raportowania.
 * - Import z innego obszaru idzie wyłącznie przez jego barrel
 *   (`modules/<obszar>/index.ts`); wewnątrz obszaru obowiązują bezpośrednie
 *   importy plików, a własny barrel jest zakazany (cykl).
 * - Pliki modułów nie importują publicznego barrela pakietu (`src/index.ts`).
 * - Czysta domena (`src/domain`) nie importuje modułów, bazy, konfiguracji
 *   ani portów/providerów; jedyny wyjątek to wspólny `AppError` z `errors.ts`.
 *   Pakiety npm tylko z `DOMAIN_PACKAGE_ALLOWLIST`.
 *
 * Pliki testowe wewnątrz obszarów są zwolnione z reguły barrela (testują
 * wnętrza), ale skan rzeczywistych plików produkcyjnych musi być czysty.
 */

const AREAS = ["materials", "learning", "family", "reporting"] as const;
type Area = (typeof AREAS)[number];

const ALLOWED: Record<Area, ReadonlySet<Area>> = {
  family: new Set(["family"]),
  materials: new Set(["materials", "family"]),
  learning: new Set(["learning", "materials", "family"]),
  reporting: new Set(["reporting", "learning", "materials", "family"]),
};

function areaOf(relPosix: string): Area | null {
  const parts = relPosix.split("/");
  if (parts[0] !== "modules") return null;
  return (AREAS as readonly string[]).includes(parts[1] ?? "") ? (parts[1] as Area) : null;
}

function resolveSpecifier(fromRelPosix: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(fromRelPosix), specifier));
}

function isBarrelTarget(resolved: string, area: Area): boolean {
  return resolved === `modules/${area}`
    || resolved === `modules/${area}/index`
    || resolved === `modules/${area}/index.ts`;
}

function specifiersOf(fileRelPosix: string, source: string): string[] {
  const ast = ts.createSourceFile(fileRelPosix, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteralLike(node.moduleReference.expression)) found.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) found.push(arg.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

function moduleViolations(fileRelPosix: string, source: string): string[] {
  const importerArea = areaOf(fileRelPosix);
  if (!importerArea) return [`${fileRelPosix}: plik poza obszarami modułów`];
  const found: string[] = [];
  for (const specifier of specifiersOf(fileRelPosix, source)) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveSpecifier(fileRelPosix, specifier);
    if (resolved === "index" || resolved === "index.ts") {
      found.push(`${specifier} → publiczny barrel pakietu`);
      continue;
    }
    const targetArea = areaOf(resolved);
    if (!targetArea) continue;
    if (!ALLOWED[importerArea].has(targetArea)) {
      found.push(`${specifier} → niedozwolony kierunek ${importerArea} → ${targetArea}`);
    } else if (targetArea === importerArea) {
      if (isBarrelTarget(resolved, targetArea)) found.push(`${specifier} → własny barrel obszaru`);
    } else if (!isBarrelTarget(resolved, targetArea)) {
      found.push(`${specifier} → import spoza barrela obszaru ${targetArea}`);
    }
  }
  return found;
}

// Dokładne nazwy (bez podścieżek): domena nie zna ORM, sterowników bazy ani SDK providerów.
const DOMAIN_PACKAGE_ALLOWLIST: ReadonlySet<string> = new Set(["@learning/contracts", "zod", "node:crypto"]);

function domainViolations(fileRelPosix: string, source: string): string[] {
  const found: string[] = [];
  for (const specifier of specifiersOf(fileRelPosix, source)) {
    if (!specifier.startsWith(".")) {
      if (!DOMAIN_PACKAGE_ALLOWLIST.has(specifier)) found.push(`${specifier} → pakiet spoza białej listy domeny`);
      continue;
    }
    const resolved = resolveSpecifier(fileRelPosix, specifier);
    if (resolved.startsWith("domain/")) continue;
    if (resolved === "errors" || resolved === "errors.ts") continue;
    found.push(`${specifier} → ${resolved}`);
  }
  return found;
}

function listSources(rootUrl: URL, prefix: string): string[] {
  const found: string[] = [];
  function walk(url: URL, rel: string): void {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, url), childRel);
      else if (/\.tsx?$/.test(entry.name)) found.push(childRel);
    }
  }
  walk(rootUrl, prefix);
  return found.sort();
}

describe("granice obszarów modułów", () => {
  it.each([
    ["modules/family/profiles.ts", 'import { startSession } from "../learning";'],
    ["modules/materials/decks.ts", 'import { getReport } from "../reporting";'],
    ["modules/learning/sessions.ts", 'import { getReport } from "../reporting";'],
    ["modules/learning/sessions.ts", 'import { readDeckKind } from "../materials/deck-kind";'],
    ["modules/learning/sessions.ts", 'import { readDeckKind as kind } from "../materials/deck-kind.ts";'],
    ["modules/reporting/reporting.ts", 'export { readDeckKind } from "../materials/deck-kind";'],
    ["modules/learning/attempts.ts", 'const m = import("../materials/deck-kind");'],
    ["modules/learning/attempts.ts", 'const m = require("../materials/deck-kind");'],
    ["modules/materials/generation.ts", 'import gen = require("../learning/sessions");'],
    ["modules/learning/sessions.ts", 'import { startSession } from "./index";'],
    ["modules/learning/sessions.ts", 'import { createServices } from "../../index";'],
  ])("wykrywa naruszenie: %s :: %s", (file, source) => {
    expect(moduleViolations(file, source)).not.toEqual([]);
  });

  it.each([
    ["modules/learning/sessions.ts", 'import { readDeckKind } from "../materials";'],
    ["modules/learning/lessons/lesson-sessions.ts", 'import { writeSealedEvent } from "../events";'],
    ["modules/reporting/learning-overview.ts", 'import { requireLearningReadToken } from "../family";'],
    ["modules/materials/lessons/lesson-drafts.ts", 'import { claimQueuedRun } from "../generation-runs";'],
    ["modules/family/auth.ts", 'import { childProfiles } from "../../db/schema";'],
    ["modules/learning/attempts.ts", 'import { qualifyAttempt } from "../../domain/independence";'],
  ])("dopuszcza legalny import: %s :: %s", (file, source) => {
    expect(moduleViolations(file, source)).toEqual([]);
  });

  it("rzeczywiste pliki produkcyjne modułów przestrzegają granic", () => {
    const modulesUrl = new URL("./", import.meta.url);
    const violations = listSources(modulesUrl, "modules")
      .filter((rel) => areaOf(rel) !== null)
      .filter((rel) => !rel.endsWith(".test.ts") && !rel.endsWith("/index.ts"))
      .flatMap((rel) => {
        const source = readFileSync(new URL(rel.slice("modules/".length), modulesUrl), "utf8");
        return moduleViolations(rel, source).map((violation) => `${rel}: ${violation}`);
      });
    expect(violations).toEqual([]);
  });

  it.each([
    ["domain/x.ts", 'import { eq } from "drizzle-orm";', "drizzle-orm"],
    ["domain/x.ts", 'import pg from "pg";', "pg"],
    ["domain/x.ts", 'import type { Pool } from "pg";', "pg"],
    ["domain/x.ts", 'export { z } from "zod/v4";', "zod/v4"],
    ["domain/x.ts", 'const m = import("openai");', "openai"],
    ["domain/x.ts", 'const m = require("pg");', "pg"],
    ["domain/x.ts", 'import { x } from "@learning/contracts/internal";', "@learning/contracts/internal"],
    ["domain/x.ts", 'import { createHash } from "crypto";', "crypto"],
    ["domain/x.ts", 'import { db } from "../db/client";', "../db/client"],
  ])("wykrywa naruszenie domeny: %s :: %s", (file, source, specifier) => {
    expect(domainViolations(file, source)).toContainEqual(expect.stringContaining(specifier));
  });

  it.each([
    ["domain/x.ts", 'import { DeckDto } from "@learning/contracts";'],
    ["domain/x.ts", 'import type { DeckDto } from "@learning/contracts";'],
    ["domain/x.ts", 'import { z } from "zod";'],
    ["domain/x.ts", 'import { createHash } from "node:crypto";'],
    ["domain/x.ts", 'import { y } from "./y";'],
    ["domain/x.ts", 'import { AppError } from "../errors";'],
  ])("dopuszcza legalny import domeny: %s :: %s", (file, source) => {
    expect(domainViolations(file, source)).toEqual([]);
  });

  it("czysta domena nie importuje modułów ani infrastruktury", () => {
    const domainUrl = new URL("../domain/", import.meta.url);
    const violations = listSources(domainUrl, "domain")
      .filter((rel) => !rel.endsWith(".test.ts"))
      .flatMap((rel) => {
        const source = readFileSync(new URL(rel.slice("domain/".length), domainUrl), "utf8");
        return domainViolations(rel, source).map((violation) => `${rel}: ${violation}`);
      });
    expect(violations).toEqual([]);
  });
});
