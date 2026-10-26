import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCKED_SPECS, REAL_BUCKETS, REAL_SPECS } from "./spec-projects";

const E2E_DIR = join(process.cwd(), "tests/e2e");

// Sygnały, że spec dotyka prawdziwego świata E2E (baza, API rodzica poza
// przeglądarką, seedowanie) — taki spec nie może trafić do projektu mocked,
// bo równoległe workery współdzieliłyby jeden świat i narastające dane.
const REAL_BACKEND_SIGNALS: readonly RegExp[] = [
  /worldPool/,
  /world-database/,
  /loginParent/,
  /parent\/setup/,
  /page\.request/,
  /newContext/,
  /\.\.\/fixtures\//,
  /\.(post|get|put|patch|delete)\(["'`]\/api/,
  // Bezpośredni dostęp do serwera/bazy z procesu testu (np. learning-mcp-http).
  /@learning\/server/,
  /createDatabase|createServices/,
  /readTestRunConfig/,
  // Fixture `request` (APIRequestContext) omija zaślepki page.route.
  /\brequest\.(get|post|put|patch|delete|fetch)\(/,
  // Logowanie przez UI (wypełnienie i wysłanie formularza) dotyka prawdziwego
  // auth; samo oglądanie pola auth-secret jest dozwolone (ekran logowania).
  /auth-submit/,
  /auth-secret"\)\.fill/,
];

// Mockowany spec musi faktycznie zaślepiać API w przeglądarce.
const MOCK_SIGNALS: readonly RegExp[] = [
  /installKidUiFixture/,
  /page\.route\("\*\*\/api\/v1\/parent\/\*\*"/,
];

describe("partycja speców E2E (spec-projects)", () => {
  it("każdy plik *.spec.ts jest sklasyfikowany dokładnie raz", () => {
    // Rekurencyjnie: spec w podkatalogu też musi zostać sklasyfikowany,
    // inaczej żaden projekt by go nie uruchomił, a test przeszedłby zielono.
    const onDisk = readdirSync(E2E_DIR, { recursive: true })
      .map((name) => String(name).replaceAll("\\", "/"))
      .filter((name) => name.endsWith(".spec.ts"))
      .sort();
    const classified = [...MOCKED_SPECS, ...REAL_SPECS].sort();
    expect(classified).toEqual(onDisk);
    expect(new Set(classified).size).toBe(classified.length);
  });

  it("kosze czasowe dzielą specy real bez luk i powtórzeń", () => {
    const flat = REAL_BUCKETS.flat();
    expect([...flat].sort()).toEqual([...REAL_SPECS].sort());
    expect(new Set(flat).size).toBe(flat.length);
    for (const bucket of REAL_BUCKETS) {
      expect(bucket.length).toBeGreaterThan(0);
    }
  });

  it("domyślna liczba koszy w runnerze shardów zgadza się z REAL_BUCKETS", () => {
    const runner = readFileSync(join(process.cwd(), "scripts/run-e2e-shards.cjs"), "utf8");
    const match = /const DEFAULT_REAL_BUCKETS = (\d+)/.exec(runner);
    expect(match, "brak DEFAULT_REAL_BUCKETS w scripts/run-e2e-shards.cjs").not.toBeNull();
    expect(Number(match![1])).toBe(REAL_BUCKETS.length);
  });

  it.each(MOCKED_SPECS)("mocked/%s zaślepia API i nie dotyka realnego świata", (file) => {
    const content = readFileSync(join(E2E_DIR, file), "utf8");
    expect(
      MOCK_SIGNALS.some((pattern) => pattern.test(content)),
      `${file}: brak zaślepki API (installKidUiFixture / route parent)`,
    ).toBe(true);
    for (const pattern of REAL_BACKEND_SIGNALS) {
      expect(content, `${file}: sygnał realnego backendu ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});
