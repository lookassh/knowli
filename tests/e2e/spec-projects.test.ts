import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCiJobBuckets, readCiJobMatrixItems, readCiJobName, readCiJobText } from "../ci-matrix";
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

/**
 * The spec imports a helper that installs a Kid UI fixture (also in a multi-line import) and calls it. A local function
 * with the same name, an import that is never called, or the same name imported from another module is not a signal.
 */
function usesFixtureHelper(content: string, name: string, modulePath: string): boolean {
  const escapedModule = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${escapedModule}["']`);
  return imported.test(content) && new RegExp(`\\b${name}\\(`).test(content);
}

// A mocked spec must really stub the API in the browser.
const MOCK_SIGNALS: readonly ((content: string) => boolean)[] = [
  (content) => /installKidUiFixture/.test(content),
  // helpers/kid-fixtures.ts: openDeckScreen installs the Kid UI fixture.
  (content) => usesFixtureHelper(content, "openDeckScreen", "./helpers/kid-fixtures"),
  // helpers/picture-fixtures.ts: openPictureChoice installs the Kid UI fixture.
  (content) => usesFixtureHelper(content, "openPictureChoice", "./helpers/picture-fixtures"),
  (content) => /page\.route\("\*\*\/api\/v1\/parent\/\*\*"/.test(content),
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

  it("kolejność w świecie kosza: przeglądy świata na początku, lesson-mock-test nie pierwszy", () => {
    // Pliki kosza biegną alfabetycznie w jednym świecie, którego dane narastają.
    const ordered = REAL_BUCKETS.map((bucket) => [...bucket].sort((a, b) => a.localeCompare(b)));
    const overviews = ["learning-mcp-http.spec.ts", "learning-overview-api.spec.ts"];
    const withOverviews = ordered.find((bucket) => bucket.includes(overviews[0]!));
    expect(withOverviews?.slice(0, 2)).toEqual(overviews);
    for (const bucket of ordered) expect(bucket[0]).not.toBe("lesson-mock-test.spec.ts");
  });

  it("domyślna liczba koszy w runnerze shardów zgadza się z REAL_BUCKETS", () => {
    const runner = readFileSync(join(process.cwd(), "scripts/run-e2e-shards.cjs"), "utf8");
    const match = /const DEFAULT_REAL_BUCKETS = (\d+)/.exec(runner);
    expect(match, "brak DEFAULT_REAL_BUCKETS w scripts/run-e2e-shards.cjs").not.toBeNull();
    expect(Number(match![1])).toBe(REAL_BUCKETS.length);
  });

  it("matrix CI obejmuje dokładnie kosze REAL_BUCKETS", () => {
    // Zakres tylko joba e2e: klucz `bucket` występuje też w jobie integration.
    const buckets = readCiJobBuckets("e2e");
    expect(buckets).toEqual(REAL_BUCKETS.map((_, i) => i + 1));
  });

  it("matrix CI dzieli projekt mocked na komplet shardów pod bramką wymaganego checka", () => {
    const items = readCiJobMatrixItems("e2e");
    // Shardy 1/N … N/N bez luk: brakujący shard pominąłby część testów mocked,
    // a shard w koszu real odciąłby część jego plików.
    const shards = items.filter((item) => item.project === "mocked").map((item) => item.shard);
    expect(shards.length).toBeGreaterThan(0);
    expect(shards).toEqual(shards.map((_, i) => `${i + 1}/${shards.length}`));
    expect(items.filter((item) => item.project !== "mocked" && item.shard)).toEqual([]);
    // Krok testów przekazuje shard Playwrightowi — bez tego każdy shard puściłby cały projekt.
    const e2e = readCiJobText("e2e");
    expect(e2e).toContain("E2E_SHARD: ${{ matrix.shard }}");
    expect(e2e).toContain('--shard="$E2E_SHARD"');
    // Reguły brancha main wymagają checka `e2e (mocked)`; po podziale na shardy
    // raportuje go bramka. Pominięty wymagany job liczy się jako zielony, więc
    // bramka musi czekać na wszystkie joby e2e i działać także po ich porażce.
    expect(readCiJobName("e2e-mocked")).toBe("e2e (mocked)");
    const gate = readCiJobText("e2e-mocked");
    expect(gate).toMatch(/^\s+needs: \[e2e\]\s*$/m);
    expect(gate).toMatch(/^\s+if: \$\{\{ always\(\) \}\}\s*$/m);
    expect(gate).toContain("NEEDS_RESULT: ${{ needs.e2e.result }}");
    expect(gate).toContain('if [ "$NEEDS_RESULT" != "success" ]; then');
    // Ostatnia próba każdego sharda osobno: ponowienie części jobów nie przepuści porażki.
    expect(gate).toContain("jobs?filter=latest");
    expect(gate).toContain('startswith("e2e (mocked-")');
    expect(gate).toContain("grep -v '=success$' shards.txt");
    expect(gate).toContain("exit 1");
  });

  it.each(MOCKED_SPECS)("mocked/%s zaślepia API i nie dotyka realnego świata", (file) => {
    const content = readFileSync(join(E2E_DIR, file), "utf8");
    expect(
      MOCK_SIGNALS.some((signal) => signal(content)),
      `${file}: brak zaślepki API (installKidUiFixture / openDeckScreen / openPictureChoice / route parent)`,
    ).toBe(true);
    for (const pattern of REAL_BACKEND_SIGNALS) {
      expect(content, `${file}: sygnał realnego backendu ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});

describe("usesFixtureHelper (sygnał zaślepki ze wspólnego helpera)", () => {
  const kidFixtures = "./helpers/kid-fixtures";

  it("rozpoznaje import razem z wywołaniem, także import wielowierszowy", () => {
    expect(usesFixtureHelper(`import { makeDeck, openDeckScreen } from "${kidFixtures}";\nawait openDeckScreen(page, []);`, "openDeckScreen", kidFixtures)).toBe(true);
    expect(usesFixtureHelper(`import {\n  makeDeck,\n  openDeckScreen,\n} from '${kidFixtures}';\nawait openDeckScreen(page, []);`, "openDeckScreen", kidFixtures)).toBe(true);
  });

  it("lokalna funkcja o tej samej nazwie bez importu nie jest zaślepką", () => {
    const local = "async function openDeckScreen(page) { await page.goto('/'); }\nawait openDeckScreen(page);";
    expect(usesFixtureHelper(local, "openDeckScreen", kidFixtures)).toBe(false);
  });

  it("sam import bez wywołania albo import z innego modułu nie jest zaślepką", () => {
    expect(usesFixtureHelper(`import { openDeckScreen } from "${kidFixtures}";`, "openDeckScreen", kidFixtures)).toBe(false);
    expect(usesFixtureHelper('import { openDeckScreen } from "./other";\nawait openDeckScreen(page);', "openDeckScreen", kidFixtures)).toBe(false);
    expect(usesFixtureHelper(`import { openDeckScreens } from "${kidFixtures}";\nawait openDeckScreens(page);`, "openDeckScreen", kidFixtures)).toBe(false);
  });
});
