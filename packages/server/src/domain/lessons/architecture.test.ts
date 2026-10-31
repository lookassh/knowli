import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCTION_SUBJECTS } from "./subjects";

/**
 * Test architektoniczny (design „Architecture”): silnik lekcji
 * (źródłowe `domain/lessons/*.ts` poza katalogami `subjects/` i `testing/`,
 * bez plików `*.test.ts`) nie importuje niczego z `subjects/`. Zależność biegnie
 * wyłącznie przez rejestr i interfejs `SubjectModule`, więc dodanie przedmiotu
 * nie zmienia silnika (Open/Closed).
 */

const lessonsDir = dirname(fileURLToPath(import.meta.url));
const EXEMPT_DIRS = new Set(["subjects", "testing"]);
// Import ścieżki zawierającej segment `/subjects/` lub zaczynającej się od `subjects/`.
const SUBJECTS_IMPORT = /\bfrom\s+["'](?:[^"']*\/)?subjects\/[^"']*["']/;

function collectEngineFiles(dir: string, relative: string[] = []): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...collectEngineFiles(join(dir, entry.name), [...relative, entry.name]));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

describe("granica importów silnika lekcji", () => {
  it("żaden plik silnika nie importuje z subjects/", () => {
    const files = collectEngineFiles(lessonsDir);
    // Dowód, że skan rzeczywiście znajduje pliki silnika (nie fałszywie zielony).
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.filter((file) => SUBJECTS_IMPORT.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("regex wykrywa import z subjects/ (dowód czułości testu)", () => {
    expect(SUBJECTS_IMPORT.test('import { x } from "./subjects/english-grammar/module";')).toBe(true);
    expect(SUBJECTS_IMPORT.test('import { x } from "../subjects/foo";')).toBe(true);
    expect(SUBJECTS_IMPORT.test('import { x } from "./registry";')).toBe(false);
    expect(SUBJECTS_IMPORT.test('import { x } from "./testing/history-like-subject";')).toBe(false);
  });
});

/**
 * Silnik nie rozgałęzia się po identyfikatorze przedmiotu (design „Angielski —
 * rozdział” §8): literał identyfikatora przedmiotu produkcyjnego nie występuje
 * w kodzie silnika lekcji (`domain/lessons` poza `subjects/` i `testing/`,
 * `modules/materials/lessons`, `modules/learning/lessons`) ani w adapterach
 * providerów (poza fałszywym providerem). Zachowanie przedmiotu przychodzi
 * wyłącznie przez opcje `SubjectModule`.
 */
const serverSrc = join(lessonsDir, "..", "..");
const SUBJECT_IDS: readonly string[] = PRODUCTION_SUBJECTS.map((subject) => subject.id);

/**
 * Nazwane wyjątki (ścieżka względem `packages/server/src` → dopuszczone
 * literały, każdy wpis to jedno wystąpienie). Nie kopiuj ich jako wzorca.
 */
const SUBJECT_ID_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // `createSchoolLesson`: publiczne polecenie szkolne nie niesie `subjectId`,
  // więc deleguje do `createMaterialLesson` z przedmiotem szkoły (zgodność API).
  "modules/materials/lessons/lesson-drafts.ts": ["school"],
};

/** Literał w cudzysłowie, apostrofach albo grawisach (ten sam znak po obu stronach). */
function subjectIdLiterals(source: string): string[] {
  const pattern = new RegExp(`(["'\`])(${SUBJECT_IDS.join("|")})\\1`, "gu");
  return [...source.matchAll(pattern)].map((match) => match[2]!);
}

/** Bez komentarzy (identyfikator w opisie nie jest gałęzią); `//` po `:` zostaje (adresy URL). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
}

function collectSources(dir: string, exempt: (name: string, isDirectory: boolean) => boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (exempt(entry.name, entry.isDirectory())) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSources(path, exempt));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function scannedFiles(): string[] {
  return [
    ...collectSources(lessonsDir, (name, isDirectory) => isDirectory && EXEMPT_DIRS.has(name)),
    ...collectSources(join(serverSrc, "modules", "materials", "lessons"), () => false),
    ...collectSources(join(serverSrc, "modules", "learning", "lessons"), () => false),
    ...collectSources(join(serverSrc, "providers"), (name, isDirectory) => !isDirectory && name === "fake.ts"),
  ];
}

function relativeToServer(file: string): string {
  return relative(serverSrc, file).split(sep).join("/");
}

describe("silnik lekcji bez literałów identyfikatorów przedmiotów", () => {
  it("żaden plik silnika ani adaptera nie zawiera identyfikatora przedmiotu poza nazwanymi wyjątkami", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(SUBJECT_IDS).toEqual(expect.arrayContaining(["english_grammar", "school", "english_chapter"]));

    const offenders: string[] = [];
    for (const file of files) {
      const path = relativeToServer(file);
      const remaining = [...(SUBJECT_ID_ALLOWED[path] ?? [])];
      for (const literal of subjectIdLiterals(withoutComments(readFileSync(file, "utf8")))) {
        const allowed = remaining.indexOf(literal);
        if (allowed >= 0) remaining.splice(allowed, 1);
        else offenders.push(`${path}: "${literal}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("wyjątki są aktualne: każdy dopuszczony literał nadal występuje w swoim pliku", () => {
    for (const [path, literals] of Object.entries(SUBJECT_ID_ALLOWED)) {
      const found = subjectIdLiterals(withoutComments(readFileSync(join(serverSrc, ...path.split("/")), "utf8")));
      for (const literal of literals) expect(found, `${path}: "${literal}"`).toContain(literal);
    }
  });

  it("wykrywa literały w kodzie, pomija komentarze (dowód czułości testu)", () => {
    expect(subjectIdLiterals('if (subject.id === "english_chapter") {}')).toEqual(["english_chapter"]);
    expect(subjectIdLiterals("const id = 'school';")).toEqual(["school"]);
    expect(subjectIdLiterals("const id = `english_grammar`;")).toEqual(["english_grammar"]);
    expect(subjectIdLiterals('const id = "schoolbook";')).toEqual([]);
    expect(subjectIdLiterals(withoutComments('// subject "school"\n/* "english_chapter" */\nconst url = "http://x";'))).toEqual([]);
    expect(withoutComments('const url = "http://x"; // "school"')).toBe('const url = "http://x"; ');
  });
});
