# Sonda mowy w zestawie kalibracyjnym gradera szkolnego — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zmierzyć, jak model oceniający traktuje odpowiedzi mówione, i rozstrzygnąć zapisaną z góry regułą, czy potrzebna jest zmiana promptu (story 2) — bez zmiany promptu i kodu oceny.

**Architecture:** Zestaw `school-grader-golden-set.json` dostaje przypadki oznaczone `"input": "speech"`, część sparowana z pisanym odpowiednikiem (`pairOf`). Skrypt `pnpm eval:school-grader` liczy dla nich wynik osobno czystymi funkcjami z `tests/probes/school-grader-report.ts`; dotychczasowe liczniki i bramka obejmują wyłącznie przypadki pisane. Flaga `--runs=3` powtarza pomiar i wypisuje rozstrzygnięcie reguły. Pomiar na prawdziwym modelu to osobne zadanie za zgodą właściciela.

**Tech Stack:** TypeScript (tsx), Vitest (`vitest.unit.config.ts`, wzorzec `tests/*.test.ts`), istniejący port `AnswerGraderProvider`.

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — story 1 z `stories.yaml`, CAP-1 w `SPEC.md`, wiersze AC-01–03 i reguła decyzyjna w `acceptance-scenarios.md`, stan kodu w `brownfield.md`.

## Global Constraints

- Bez zmian w `packages/` — prompt gradera, walidacja werdyktu i wersja promptu zostają.
- Przypadki wyłącznie fikcyjne; żadnych danych dziecka.
- Etykiety przypadków mówionych to oczekiwanie docelowe właściciela, nie prawda obiektywna; przypadki sporne (`disputed`) nie wchodzą do reguły.
- Przypadki mówione są raportowane osobno i nie wchodzą do bramki zestawu przed story 2.
- Przebieg na prawdziwym modelu tylko po zgodzie właściciela; skrypt nie ma limitu kosztu, wykonuje jedno wywołanie na przypadek i przebieg.
- Wyników różnych modeli się nie porównuje: przy wyniku model, wersja promptu i data.
- `pnpm typecheck` nie obejmuje `scripts/`; skrypt sprawdza przebieg `--fake`.
- Kod i identyfikatory po angielsku, treść przypadków i raport po polsku.

## Review Focus

- Przypadek mówiony na pytaniu `one_sentence`: skrypt nie może liczyć zdań (jak produkcja dla niepoprawionej dyktowanej odpowiedzi). Test `formOkForCase` w zadaniu 2.
- Błąd dostawcy (401, 429, timeout): osobny licznik, nie liczy się do reguły ani jako odrzucenie przez walidację. Testy `groupReportLines` i `decisionLines` w zadaniach 2 i 3.
- Przypadek sparowany, którego pisany odpowiednik też zawodzi: nie obciąża mowy. Test `decisionLines` w zadaniu 3.
- Zestaw bez przypadków mówionych: raport wypisuje grupę z zerami. Test `groupReportLines` w zadaniu 2.
- Nieudany przypadek mówiony nie może dać „BRAMKA: NIE SPEŁNIONA”: sprawdzenie ręczne, zadanie 2 krok 6 (fake nie bramkuje) i zadanie 4 krok 2.

---

### Task 1: Przypadki mówione w zestawie (AC-01)

**Files:**
- Modify: `tests/probes/fixtures/school-grader-golden-set.json`
- Test: `tests/school-grader-golden-set.test.ts` (nowy)

**Interfaces:**
- Produces: w przypadku opcjonalne pola `input?: "speech"` (brak = pisany), `pairOf?: string` (id pisanego odpowiednika), `disputed?: true`. Identyfikatory mówionych `S01`–`S12`.

- [ ] **Step 0: Zależności**

Gdy brak `node_modules`: `corepack pnpm wt:setup`.

- [ ] **Step 1: Napisz test zestawu**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Case { id: string; question: string; category: string; childAnswer: string; input?: string; pairOf?: string; disputed?: boolean; expected: { knowledge: string; precision: string } }
const golden = JSON.parse(readFileSync(new URL("./probes/fixtures/school-grader-golden-set.json", import.meta.url), "utf8")) as {
  gate: { hardCategoriesMustPass: string[] }; questions: Record<string, unknown>; cases: Case[];
};
const speech = golden.cases.filter((c) => c.input === "speech");
const written = golden.cases.filter((c) => c.input === undefined);
const SPEECH_CATEGORIES = [
  "mowa — wypełniacze", "mowa — restart zdania", "mowa — powtórzenia", "mowa — autokorekta faktu",
  "mowa — przekręcona nazwa lub termin", "mowa — dygresja nie na temat", "mowa — kilka zdań z pauz",
  "mowa — częściowa z wypełniaczami", "mowa — błąd rzeczowy z wypełniaczami", "mowa — słowa do otoczenia",
];

describe("school grader golden set — speech cases", () => {
  it("has at least 10 speech cases covering every speech category", () => {
    expect(speech.length).toBeGreaterThanOrEqual(10);
    for (const category of SPEECH_CATEGORIES) expect(speech.map((c) => c.category)).toContain(category);
  });
  it("pairs at least 5 speech cases with a written twin on the same question and expectation", () => {
    const paired = speech.filter((c) => c.pairOf !== undefined);
    expect(paired.length).toBeGreaterThanOrEqual(5);
    for (const c of paired) {
      const twin = written.find((w) => w.id === c.pairOf);
      expect(twin, c.id).toBeDefined();
      expect(twin!.question).toBe(c.question);
      expect(twin!.expected.knowledge).toBe(c.expected.knowledge);
      expect(twin!.expected.precision).toBe(c.expected.precision);
    }
  });
  it("keeps every case well-formed", () => {
    const ids = golden.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of golden.cases) {
      expect(golden.questions[c.question], c.id).toBeDefined();
      expect(["correct", "partial", "incorrect"]).toContain(c.expected.knowledge);
      expect(["concise", "verbose", "unfocused"]).toContain(c.expected.precision);
      expect([undefined, "speech"]).toContain(c.input);
      expect([...c.childAnswer].length, c.id).toBeLessThanOrEqual(600);
    }
    expect(written.every((c) => c.pairOf === undefined && c.disputed === undefined)).toBe(true);
  });
  it("keeps the 27 written cases and the gate untouched", () => {
    expect(written).toHaveLength(27);
    expect(golden.gate.hardCategoriesMustPass).toEqual(["błędna zależność mimo słów kluczowych", "istotny błąd rzeczowy"]);
    expect(speech.every((c) => !golden.gate.hardCategoriesMustPass.includes(c.category))).toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom test — ma nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-golden-set.test.ts`
Expected: FAIL — `expected 0 to be greater than or equal to 10`.

- [ ] **Step 3: Dopisz przypadki do `cases` i podnieś `version` do 3**

Każdy przypadek ma `"input": "speech"`. Treść dokładnie taka (zapis jak z rozpoznawania mowy). Przypadki sparowane to treść pisanego odpowiednika plus jedno zjawisko mowy. Bez pola `confused` (gałąź mówiona go nie sprawdza).

| id | question | pairOf | category | childAnswer | expected |
| --- | --- | --- | --- | --- | --- |
| S01 | fotosynteza | G01 | mowa — wypełniacze | `Yyy no roślina robi sobie jedzenie, czyli cukier, no, z wody i gazu z powietrza, yyy, a pomaga jej w tym słońce.` | correct / concise |
| S02 | fotosynteza | — | mowa — restart zdania | `Fotosynteza to jest, to znaczy roślina bierze wodę i dwutlenek węgla i jak jest światło, to wytwarza z tego cukry.` | correct / concise |
| S03 | chrzest | G09 | mowa — autokorekta faktu | `Żeby Polska dołączyła do chrześcijańskich krajów i żeby sąsiedzi nie mieli powodu jej atakować, że jest pogańska, a do tego jego władza była słabsza, nie, silniejsza.` | correct / concise |
| S04 | poludnik | — | mowa — autokorekta faktu | `Południk to taka umowna linia na Ziemi, która łączy wschód z zachodem, znaczy nie, biegun północny z południowym.` | correct / concise |
| S05 | chrzest | — | mowa — przekręcona nazwa lub termin | `Mieszkał pierwszy przyjął chrzest, żeby wzmocnić władzę, wejść do chrześcijańskiej Europy i żeby sąsiedzi nie mieli pretekstu do wojny o nawracanie.` | correct / concise |
| S06 | fotosynteza | G25 | mowa — dygresja nie na temat | `No roślina z wody i dwutlenku węgla przy świetle wytwarza cukry. A wczoraj grałem z bratem w piłkę i wygrałem trzy do jednego.` | correct / verbose, `fragments: "offTopic"`, `fragmentContains: "piłkę"` |
| S07 | fotosynteza-jedno-zdanie | — | mowa — kilka zdań z pauz | `Roślina bierze wodę. I dwutlenek węgla. I przy świetle robi z tego cukry.` | correct / concise |
| S08 | ssak-ptak | — | mowa — powtórzenia | `Ssaki, ssaki karmią młode mlekiem i mają, mają sierść, a ptaki składają jaja i mają pióra.` | correct / concise |
| S09 | fotosynteza | G03 | mowa — częściowa z wypełniaczami | `Yyy no roślina, yyy, bierze światło słoneczne i wodę.` | partial / concise, `missingElementIds: ["e1", "e2"]` |
| S10 | ssak-ptak | G16 | mowa — błąd rzeczowy z wypełniaczami | `No to, yyy, ssaki składają jaja i mają pióra, a ptaki, no, karmią młode mlekiem i mają sierść.` | incorrect / concise, `missingElementIds: ["e1", "e2", "e3"]` |
| S11 | fotosynteza | — | mowa — przekręcona nazwa lub termin | `Roślina z wody i z dwóch tlenków węgla przy świetle wytwarza cukry.` | correct / concise, `disputed: true` |
| S12 | ssak-ptak | — | mowa — słowa do otoczenia | `Ssaki karmią młode mlekiem i mają sierść, a ptaki składają jaja i mają pióra. Już, koniec.` | correct / concise, `disputed: true` |

S09 i S10 pilnują, żeby późniejsza tolerancja mowy nie zawyżała wiedzy. S07 celowo różni się etykietą od pisanego G18 (ta sama forma, `verbose`): mówione kropki to pauzy; przed story 2 niezgodność S07 jest spodziewana, bo model nadal dostaje wymóg jednego zdania.

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-golden-set.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add tests/school-grader-golden-set.test.ts tests/probes/fixtures/school-grader-golden-set.json
git commit -m "Sonda gradera: przypadki mówione w zestawie kalibracyjnym"
```

### Task 2: Raport osobno dla pisanych i mówionych (AC-02)

**Files:**
- Create: `tests/probes/school-grader-report.ts`
- Modify: `scripts/evaluate-school-grader.mts`
- Test: `tests/school-grader-report.test.ts` (nowy)

**Interfaces:**
- Consumes: pola `input`, `pairOf`, `disputed` z zadania 1.
- Produces:

```ts
export interface CaseOutcome {
  readonly id: string;
  readonly input: "written" | "speech";
  readonly pairOf?: string;
  readonly disputed: boolean;
  /** rejected = walidacja odrzuciła werdykt; provider_error = transport/dostawca. */
  readonly status: "graded" | "rejected" | "provider_error";
  /** null, gdy status !== "graded". */
  readonly knowledgeMatch: boolean | null;
  readonly precisionMatch: boolean | null;
  readonly unneededShorten: boolean;
}
/** Forma jednego zdania; null = bez znaczenia. Mowa nigdy nie liczy zdań. */
export function formOkForCase(expectedForm: string, input: "written" | "speech", childAnswer: string): boolean | null;
/** Produkcyjny warunek oferty skracania (correct + verbose/unfocused + ≥1 fragment), gdy oczekiwano concise. */
export function isUnneededShorten(
  verdict: { knowledge: string; precision: string; redundantFragments: readonly string[]; offTopicFragments: readonly string[] },
  expectedPrecision: string,
): boolean;
/** Dwa wiersze raportu, zawsze w kolejności: pisane, mówione. */
export function groupReportLines(outcomes: readonly CaseOutcome[]): string[];
```

- [ ] **Step 1: Napisz testy**

```ts
import { describe, expect, it } from "vitest";
import { formOkForCase, groupReportLines, isUnneededShorten, type CaseOutcome } from "./probes/school-grader-report";

const outcome = (over: Partial<CaseOutcome>): CaseOutcome => ({
  id: "X", input: "written", disputed: false, status: "graded", knowledgeMatch: true, precisionMatch: true, unneededShorten: false, ...over,
});

describe("formOkForCase", () => {
  it("counts sentences only for written one_sentence answers", () => {
    expect(formOkForCase("one_sentence", "written", "Jedno zdanie.")).toBe(true);
    expect(formOkForCase("one_sentence", "written", "Pierwsze. Drugie.")).toBe(false);
    expect(formOkForCase("one_sentence", "speech", "Pierwsze. Drugie.")).toBeNull();
    expect(formOkForCase("explanation", "written", "Pierwsze. Drugie.")).toBeNull();
  });
});

describe("isUnneededShorten", () => {
  const verdict = { knowledge: "correct", precision: "verbose", redundantFragments: ["yyy"], offTopicFragments: [] };
  it("flags a shorten offer the expectation did not call for", () => {
    expect(isUnneededShorten(verdict, "concise")).toBe(true);
    expect(isUnneededShorten({ ...verdict, redundantFragments: [], offTopicFragments: ["no"] }, "concise")).toBe(true);
  });
  it("stays quiet when shortening is expected or would not be offered", () => {
    expect(isUnneededShorten(verdict, "verbose")).toBe(false);
    expect(isUnneededShorten({ ...verdict, redundantFragments: [] }, "concise")).toBe(false);
    expect(isUnneededShorten({ ...verdict, precision: "concise" }, "concise")).toBe(false);
    expect(isUnneededShorten({ ...verdict, knowledge: "partial" }, "concise")).toBe(false);
  });
});

describe("groupReportLines", () => {
  it("reports each input group separately and splits rejections from provider errors", () => {
    expect(groupReportLines([
      outcome({}),
      outcome({ knowledgeMatch: false }),
      outcome({ input: "speech", precisionMatch: false, unneededShorten: true }),
      outcome({ input: "speech", status: "rejected", knowledgeMatch: null, precisionMatch: null }),
      outcome({ input: "speech", status: "provider_error", knowledgeMatch: null, precisionMatch: null }),
    ])).toEqual([
      "pisane: przypadki=2 wiedzaZgodna=1 precyzjaZgodna=2 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0",
      "mówione: przypadki=3 wiedzaZgodna=1 precyzjaZgodna=0 odrzuconeWalidator=1 bladDostawcy=1 niepotrzebneSkracanie=1",
    ]);
  });
  it("prints a zero row for a group with no cases", () => {
    expect(groupReportLines([outcome({})])[1])
      .toBe("mówione: przypadki=0 wiedzaZgodna=0 precyzjaZgodna=0 odrzuconeWalidator=0 bladDostawcy=0 niepotrzebneSkracanie=0");
  });
});
```

- [ ] **Step 2: Uruchom testy — mają nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: FAIL — nie można znaleźć modułu `./probes/school-grader-report`.

- [ ] **Step 3: Zaimplementuj trzy funkcje w `tests/probes/school-grader-report.ts`**

`formOkForCase` używa `countSentences` z `packages/server/src/domain/lessons/evaluate` (import względny, jak w skrypcie). Pozostałe bez importów.

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: PASS, 5 testów.

- [ ] **Step 5: Podłącz raport w `scripts/evaluate-school-grader.mts`**

Decyzje, których kod sam nie wskazuje:

- `GoldenCase` dostaje `input?: "speech"`, `pairOf?: string`, `disputed?: boolean`.
- `formOk` dla `validateSchoolVerdict` i dla sprawdzenia formy pochodzi z `formOkForCase` (zastępuje oba wyrażenia z `countSentences`).
- Każdy przypadek dopisuje jeden `CaseOutcome`: błąd w `catch` → `provider_error`, `null` z walidacji → `rejected`, inaczej `graded` z `unneededShorten` z `isUnneededShorten`.
- Dotychczasowe liczniki (`knowledgeOk`, `precisionOk`, `missing*`, `form*`, `invalid`, `confusion*`, `fragments*`), `total` i bramka liczą wyłącznie przypadki pisane; ich zachowanie dla pisanych się nie zmienia. Przypadek mówiony po zapisaniu `CaseOutcome` wypisuje swoje niezgodności i pomija resztę pętli.
- Niezgodności przypadku mówionego trafiają do `failures` w jednym wierszu z przedrostkiem `[MOWA]` i nigdy z `[TWARDA]`. Wiersz wymienia po średniku każdą z: wiedza, precyzja, brakujące elementy (gdy przypadek ma `missingElementIds`), brak fragmentu (gdy ma `fragments`), niepotrzebne skracanie. Przykład: `[MOWA] S03 (mowa — autokorekta faktu): wiedza partial ≠ correct; niepotrzebne skracanie`.
- Przy odrzuceniu przez walidację przypadku mówionego wiersz zawiera surowy werdykt: `[MOWA] S03 (…): werdykt odrzucony przez walidator: <JSON.stringify(raw)>`. Dane są fikcyjne.
- Po dotychczasowym wierszu podsumowania wypisz dwa wiersze z `groupReportLines`.
- W komentarzu nagłówka pliku dopisz jedno zdanie: przypadki mówione są raportowane osobno i nie bramkują.

- [ ] **Step 6: Sprawdź przebieg bez modelu**

Run: `corepack pnpm eval:school-grader -- --fake`
Expected: kod wyjścia 0; wiersz podsumowania identyczny jak na `main` przed zmianami: `przypadki=27 wiedzaZgodna=10 (37%) precyzjaZgodna=22 brakujaceElementyZgodne=4/20 formaZgodna=2/2 odrzucone=0 pomylenieWykryte=0/5 falszywePomylenie=0/22 kategorieFragmentow=0/2`; po nim wiersze `pisane: przypadki=27 …` i `mówione: przypadki=12 …`; ostatni wiersz `fake: raport informacyjny, bez bramki`.

- [ ] **Step 7: Commit**

```bash
git add tests/probes/school-grader-report.ts tests/school-grader-report.test.ts scripts/evaluate-school-grader.mts
git commit -m "Sonda gradera: raport osobno dla odpowiedzi pisanych i mówionych"
```

### Task 3: Powtórzenia i reguła decyzyjna (AC-03)

**Files:**
- Modify: `tests/probes/school-grader-report.ts`, `scripts/evaluate-school-grader.mts`
- Test: `tests/school-grader-report.test.ts`

**Interfaces:**
- Consumes: `CaseOutcome` z zadania 2.
- Produces:

```ts
/**
 * Reguła z acceptance-scenarios.md. `runs[i]` to wyniki wszystkich przypadków i-tego przebiegu.
 * Zwraca po jednym wierszu na stabilnie błędny przypadek mówiony i wiersz końcowy.
 */
export function decisionLines(runs: readonly (readonly CaseOutcome[])[]): string[];
```

Reguła: liczą się przypadki mówione bez `disputed`. Przebieg obciąża przypadek w wymiarze `wiedza` (`graded` i `knowledgeMatch === false`), `odrzucenie` (`rejected`) albo `skracanie` (`unneededShorten`). Przebieg z `provider_error` nie obciąża. Dla przypadku z `pairOf` przebieg liczy się tylko, gdy odpowiednik w tym samym przebiegu jest `graded` z `knowledgeMatch === true`. Stabilnie błędny = ten sam wymiar w co najmniej 2 przebiegach. Story 2 potrzebne, gdy ≥ 1 przypadek stabilny w `wiedza` lub `odrzucenie` albo ≥ 2 w `skracanie`. Przy mniej niż 3 przebiegach funkcja zwraca tylko `["REGUŁA: wymaga --runs=3"]`.

- [ ] **Step 1: Dopisz testy**

```ts
describe("decisionLines", () => {
  const speech = (id: string, over: Partial<CaseOutcome> = {}) => outcome({ id, input: "speech", ...over });
  const bad = { knowledgeMatch: false };
  it("needs three runs", () => {
    expect(decisionLines([[speech("S01", bad)]])).toEqual(["REGUŁA: wymaga --runs=3"]);
  });
  it("calls story 2 needed for one stable knowledge failure", () => {
    expect(decisionLines([[speech("S02", bad)], [speech("S02", bad)], [speech("S02")]]))
      .toEqual(["S02: wiedza 2/3", "REGUŁA: story 2 potrzebne"]);
  });
  it("counts validator rejections but not provider errors", () => {
    const rejected = { status: "rejected", knowledgeMatch: null, precisionMatch: null } as const;
    const provider = { status: "provider_error", knowledgeMatch: null, precisionMatch: null } as const;
    expect(decisionLines([[speech("S02", rejected)], [speech("S02", rejected)], [speech("S02", provider)]]))
      .toEqual(["S02: odrzucenie 2/3", "REGUŁA: story 2 potrzebne"]);
    expect(decisionLines([[speech("S02", provider)], [speech("S02", provider)], [speech("S02", provider)]]))
      .toEqual(["REGUŁA: story 2 niepotrzebne"]);
  });
  it("needs two cases for the shorten dimension", () => {
    const shorten = { unneededShorten: true };
    const one = [speech("S01", shorten), speech("S02")];
    const two = [speech("S01", shorten), speech("S02", shorten)];
    expect(decisionLines([one, one, one])).toEqual(["S01: skracanie 3/3", "REGUŁA: story 2 niepotrzebne"]);
    expect(decisionLines([two, two, two])).toEqual(["S01: skracanie 3/3", "S02: skracanie 3/3", "REGUŁA: story 2 potrzebne"]);
  });
  it("ignores single failures, disputed cases and pairs whose written twin fails", () => {
    const run = [
      speech("S11", { ...bad, disputed: true }),
      speech("S03", { ...bad, pairOf: "G09" }),
      outcome({ id: "G09", knowledgeMatch: false }),
    ];
    expect(decisionLines([run, run, [...run, speech("S04", bad)]])).toEqual(["REGUŁA: story 2 niepotrzebne"]);
  });
  it("counts a paired case when its written twin passes", () => {
    const run = [speech("S03", { ...bad, pairOf: "G09" }), outcome({ id: "G09" })];
    expect(decisionLines([run, run, run])).toEqual(["S03: wiedza 3/3", "REGUŁA: story 2 potrzebne"]);
  });
});
```

- [ ] **Step 2: Uruchom testy — nowe mają nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: FAIL — `decisionLines is not a function` (albo błąd importu).

- [ ] **Step 3: Zaimplementuj `decisionLines`**

Wiersze stabilnych przypadków w kolejności id, a przy tym samym id w kolejności wymiarów: wiedza, odrzucenie, skracanie.

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: PASS, 11 testów.

- [ ] **Step 5: Dodaj `--runs=N` do skryptu**

- `--runs=N` (domyślnie 1, dozwolone 1 albo 3 — po przeglądzie końcowym zawężone z 1–5; inna wartość kończy skrypt kodem 2 przed jakimkolwiek wywołaniem).
- Cały dotychczasowy przebieg (pętla, podsumowanie, wiersze grup, lista niezgodności) wykonuje się N razy; przed każdym wiersz `przebieg=i/N`.
- Po ostatnim przebiegu wypisz wiersze `decisionLines`.
- Bramka: OK tylko, gdy przeszła w każdym przebiegu; kod wyjścia jak dotąd. `--fake` nadal kończy się kodem 0.
- W komentarzu nagłówka dopisz przykład `corepack pnpm eval:school-grader -- --runs=3`.

- [ ] **Step 6: Sprawdź przebieg bez modelu**

Run: `corepack pnpm eval:school-grader -- --fake --runs=3`
Expected: kod wyjścia 0; trzy wiersze `przebieg=1/3`…`przebieg=3/3`; przed `fake: raport informacyjny, bez bramki` wiersz zaczynający się od `REGUŁA: story 2`.

Run: `corepack pnpm eval:school-grader -- --fake --runs=9`
Expected: kod wyjścia 2.

- [ ] **Step 7: Commit**

```bash
git add tests/probes/school-grader-report.ts tests/school-grader-report.test.ts scripts/evaluate-school-grader.mts
git commit -m "Sonda gradera: powtórzenia i reguła decyzyjna dla mowy"
```

### Task 4: Pomiar bazowy na prawdziwym modelu (AC-03)

**Files:**
- Create: `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/speech-baseline.md`
- Modify: `docs/architecture.md:937` (zdanie o bramce zestawu)

**Interfaces:**
- Consumes: skrypt z zadań 2–3.
- Produces: zapisany pomiar bazowy i rozstrzygnięcie reguły — wejście story 2.

- [ ] **Step 1: Zatrzymaj się i poproś właściciela o zgodę na przebieg**

Podaj: 117 wywołań modelu z `UMIEM_GRADER_*` (39 przypadków × 3 przebiegi, domyślnie Gemini 3.8 Flash), bez limitu kosztu w skrypcie. Bez zgody nie uruchamiaj kroku 2; zadanie zostaje otwarte.

- [ ] **Step 2: Uruchom pomiar**

Run: `corepack pnpm eval:school-grader -- --runs=3`
Expected: pierwszy wiersz `arm=real model=… promptVersion=…`; trzy przebiegi; wiersz `REGUŁA: story 2 potrzebne` albo `REGUŁA: story 2 niepotrzebne`; `BRAMKA: OK` (bramka liczy tylko pisane — inny wynik zgłoś właścicielowi, nie poprawiaj zestawu ani promptu). Pomiar z 2026-11-10 dał `BRAMKA: NIE SPEŁNIONA` z powodu przypadków pisanych G05, G06 i G27; opis w `speech-baseline.md`.

- [ ] **Step 3: Zapisz wynik w `speech-baseline.md`**

Zawartość: data, commit, pełne wyjście skryptu w bloku kodu, wiersz reguły powtórzony na górze. Dwie uwagi stałe: etykiety to oczekiwanie docelowe właściciela; nie zweryfikowano, czy rozpoznawanie mowy zapisuje „yyy”. Bez rekomendacji zmian promptu — to robi story 2.

- [ ] **Step 4: Zaktualizuj `docs/architecture.md:937`**

Do zdania o bramce dopisz: zestaw zawiera też przypadki mówione, raportowane osobno i poza bramką.

- [ ] **Step 5: Sprawdź dryf dokumentacji i commit**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/docs-architecture-drift.test.ts`
Expected: PASS.

```bash
git add _bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/speech-baseline.md docs/architecture.md
git commit -m "Sonda gradera: pomiar bazowy odpowiedzi mówionych"
```

- [ ] **Step 6: Odbiór (`done_checkpoint`)**

Pokaż właścicielowi wiersz reguły, wiersze `mówione:` i listę `[MOWA]`. Nie zaczynaj story 2 przed jego decyzją.

## Wiersz AC → test

| AC | Test |
| --- | --- |
| AC-01 | `tests/school-grader-golden-set.test.ts` |
| AC-02 | `tests/school-grader-report.test.ts` (`formOkForCase`, `isUnneededShorten`, `groupReportLines`) + zadanie 2 krok 6 |
| AC-03 | `tests/school-grader-report.test.ts` (`decisionLines`) + sprawdzenie ręczne: zadanie 4 kroki 1–3 (zgoda, model i wersja promptu w wyjściu, data w pliku) |
