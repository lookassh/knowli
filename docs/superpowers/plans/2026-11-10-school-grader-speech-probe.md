# Sonda mowy w zestawie kalibracyjnym gradera szkolnego — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zmierzyć, jak model oceniający traktuje odpowiedzi mówione (wiedza, precyzja, werdykty odrzucone przez walidację), bez zmiany promptu i kodu oceny.

**Architecture:** Zestaw `school-grader-golden-set.json` dostaje przypadki oznaczone `"input": "speech"`. Skrypt `pnpm eval:school-grader` liczy dla nich wynik osobno czystą funkcją raportu; dotychczasowe liczniki i bramka obejmują wyłącznie przypadki pisane. Pomiar na prawdziwym modelu to osobne zadanie za zgodą właściciela.

**Tech Stack:** TypeScript (tsx), Vitest (`vitest.unit.config.ts`, wzorzec `tests/*.test.ts`), istniejący port `AnswerGraderProvider`.

**Spec:** `_bmad-output/specs/spec-dyktowana-odpowiedz-sciezka-dziecka/` — story 1 z `stories.yaml`, CAP-1 w `SPEC.md`, wiersze AC-01–03 w `acceptance-scenarios.md`, stan kodu w `brownfield.md`.

## Global Constraints

- Bez zmian w `packages/` — prompt gradera, walidacja werdyktu i wersja promptu zostają.
- Przypadki wyłącznie fikcyjne; żadnych danych dziecka.
- Przypadki mówione są raportowane osobno i nie wchodzą do bramki zestawu przed story 2.
- Przebieg na prawdziwym modelu tylko po zgodzie właściciela; `pnpm eval:school-grader` nie ma limitu kosztu, wykonuje jedno wywołanie na przypadek.
- Wyników różnych modeli się nie porównuje: przy wyniku zapisz model, wersję promptu i datę.
- Kod i identyfikatory po angielsku, treść przypadków i raport po polsku.

## Review Focus

- Przypadek mówiony na pytaniu `one_sentence`: skrypt nie może liczyć zdań (jak produkcja dla niepoprawionej dyktowanej odpowiedzi), inaczej kropki z rozpoznawania mowy zafałszują precyzję. Test w zadaniu 2.
- Błąd dostawcy (401, 429, timeout) przy przypadku mówionym: trafia do „odrzucone” grupy mówionej z powodem w wierszu, nie zmienia bramki pisanej. Test w zadaniu 2.
- Zestaw bez przypadków mówionych (stara kopia): raport wypisuje grupę z zerami zamiast dzielić przez zero. Test w zadaniu 2.
- Bramka po zmianie: nieudany przypadek mówiony nie może dać „BRAMKA: NIE SPEŁNIONA”. Sprawdzenie w zadaniu 2, krok 6.
- Odpowiedź mówiona dłuższa niż 600 znaków: test zestawu odrzuca taki przypadek, bo produkcja ucina dyktowanie na 600 znakach. Test w zadaniu 1.

---

### Task 1: Przypadki mówione w zestawie (AC-01)

**Files:**
- Modify: `tests/probes/fixtures/school-grader-golden-set.json`
- Test: `tests/school-grader-golden-set.test.ts` (nowy)

**Interfaces:**
- Produces: w każdym przypadku opcjonalne pole `input?: "speech"` (brak = pisany). Identyfikatory przypadków mówionych `S01`–`S10`.

- [ ] **Step 1: Napisz test zestawu**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const golden = JSON.parse(readFileSync(new URL("./probes/fixtures/school-grader-golden-set.json", import.meta.url), "utf8"));
const speech = golden.cases.filter((c: { input?: string }) => c.input === "speech");
const SPEECH_CATEGORIES = [
  "mowa — wypełniacze", "mowa — restart zdania", "mowa — autokorekta faktu",
  "mowa — przekręcona nazwa", "mowa — dygresja nie na temat", "mowa — kilka zdań z pauz",
  "mowa — częściowa z wypełniaczami", "mowa — błąd rzeczowy z wypełniaczami",
];

describe("school grader golden set — speech cases", () => {
  it("has at least 8 speech cases covering every speech category", () => {
    expect(speech.length).toBeGreaterThanOrEqual(8);
    for (const category of SPEECH_CATEGORIES) expect(speech.map((c: { category: string }) => c.category)).toContain(category);
  });
  it("keeps every case well-formed", () => {
    const ids = golden.cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of golden.cases) {
      expect(golden.questions[c.question], c.id).toBeDefined();
      expect(["correct", "partial", "incorrect"]).toContain(c.expected.knowledge);
      expect(["concise", "verbose", "unfocused"]).toContain(c.expected.precision);
      expect([undefined, "speech"]).toContain(c.input);
      expect([...c.childAnswer].length, c.id).toBeLessThanOrEqual(600);
    }
  });
  it("keeps the 27 written cases and the gate untouched", () => {
    expect(golden.cases.filter((c: { input?: string }) => c.input === undefined)).toHaveLength(27);
    expect(golden.gate.hardCategoriesMustPass).toEqual(["błędna zależność mimo słów kluczowych", "istotny błąd rzeczowy"]);
    expect(speech.every((c: { category: string }) => !golden.gate.hardCategoriesMustPass.includes(c.category))).toBe(true);
  });
});
```

- [ ] **Step 2: Uruchom test — ma nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-golden-set.test.ts`
Expected: FAIL — `expected 0 to be greater than or equal to 8`.

- [ ] **Step 3: Dopisz przypadki do `cases` i podnieś `version` do 3**

Każdy przypadek ma `"input": "speech"` i `"confused": false` w `expected`. Treść dokładnie taka (zapis jak z rozpoznawania mowy):

| id | question | category | childAnswer | expected |
| --- | --- | --- | --- | --- |
| S01 | fotosynteza | mowa — wypełniacze | `Yyy no to jest tak, że roślina, no, z wody i dwutlenku węgla, yyy, przy świetle robi cukry.` | correct / concise |
| S02 | fotosynteza | mowa — restart zdania | `Fotosynteza to jest, to znaczy roślina bierze wodę i dwutlenek węgla i jak jest światło, to wytwarza z tego cukry.` | correct / concise |
| S03 | chrzest | mowa — autokorekta faktu | `Mieszko przyjął chrzest, żeby osłabić, nie, żeby wzmocnić swoją władzę, i żeby jego państwo należało do chrześcijańskiej Europy, i żeby sąsiedzi nie mogli napadać pod pretekstem nawracania.` | correct / concise |
| S04 | poludnik | mowa — autokorekta faktu | `Południk to taka umowna linia na Ziemi, która łączy wschód z zachodem, znaczy nie, biegun północny z południowym.` | correct / concise |
| S05 | chrzest | mowa — przekręcona nazwa | `Mieszkał pierwszy przyjął chrzest, żeby wzmocnić władzę, wejść do chrześcijańskiej Europy i żeby sąsiedzi nie mieli pretekstu do wojny o nawracanie.` | correct / concise |
| S06 | ssak-ptak | mowa — dygresja nie na temat | `No ssaki karmią młode mlekiem i mają sierść, a ptaki składają jaja i mają pióra. A my mamy w domu papugę i ona umie mówić dzień dobry.` | correct / verbose, `fragments: "offTopic"`, `fragmentContains: "papug"` |
| S07 | fotosynteza-jedno-zdanie | mowa — kilka zdań z pauz | `Roślina bierze wodę. I dwutlenek węgla. I przy świetle robi z tego cukry.` | correct / concise |
| S08 | ssak-ptak | mowa — kilka zdań z pauz | `Ssaki karmią młode mlekiem. Ptaki składają jaja. Ssaki mają sierść. A ptaki pióra.` | correct / concise |
| S09 | fotosynteza | mowa — częściowa z wypełniaczami | `Yyy no roślina, yyy, bierze światło i wodę, no i tyle.` | partial / concise, `missingElementIds: ["e1", "e2"]` |
| S10 | ssak-ptak | mowa — błąd rzeczowy z wypełniaczami | `No to, yyy, ssaki składają jaja, a ptaki, no, karmią młode mlekiem.` | incorrect / concise |

S09 i S10 pilnują, żeby późniejsza tolerancja mowy (story 2) nie zawyżała wiedzy.

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-golden-set.test.ts`
Expected: PASS, 3 testy.

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
- Consumes: pole `input?: "speech"` przypadku z zadania 1.
- Produces:

```ts
export interface CaseOutcome {
  readonly input: "written" | "speech";
  /** null = werdykt odrzucony przez walidację albo błąd dostawcy. */
  readonly knowledgeMatch: boolean | null;
  readonly precisionMatch: boolean | null;
}
/** Dwa wiersze raportu, zawsze w kolejności: pisane, mówione. */
export function groupReportLines(outcomes: readonly CaseOutcome[]): string[];
```

- [ ] **Step 1: Napisz test raportu**

```ts
import { describe, expect, it } from "vitest";
import { groupReportLines } from "./probes/school-grader-report";

describe("groupReportLines", () => {
  it("reports knowledge, precision and rejected verdicts per input group", () => {
    expect(groupReportLines([
      { input: "written", knowledgeMatch: true, precisionMatch: true },
      { input: "written", knowledgeMatch: false, precisionMatch: true },
      { input: "speech", knowledgeMatch: true, precisionMatch: false },
      { input: "speech", knowledgeMatch: null, precisionMatch: null },
    ])).toEqual([
      "pisane: przypadki=2 wiedzaZgodna=1 precyzjaZgodna=2 odrzucone=0",
      "mówione: przypadki=2 wiedzaZgodna=1 precyzjaZgodna=0 odrzucone=1",
    ]);
  });
  it("prints a zero row for a group with no cases", () => {
    expect(groupReportLines([{ input: "written", knowledgeMatch: true, precisionMatch: true }])[1])
      .toBe("mówione: przypadki=0 wiedzaZgodna=0 precyzjaZgodna=0 odrzucone=0");
  });
});
```

- [ ] **Step 2: Uruchom test — ma nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: FAIL — nie można znaleźć modułu `./probes/school-grader-report`.

- [ ] **Step 3: Zaimplementuj `groupReportLines` w `tests/probes/school-grader-report.ts`**

Czysta funkcja bez importów; format wiersza dokładnie jak w teście.

- [ ] **Step 4: Uruchom test — ma przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/school-grader-report.test.ts`
Expected: PASS, 2 testy.

- [ ] **Step 5: Podłącz raport w `scripts/evaluate-school-grader.mts`**

Decyzje, których kod sam nie wskazuje:

- `GoldenCase` dostaje `input?: "speech"`.
- Dla przypadku mówionego `formOk` przekazywane do `validateSchoolVerdict` to zawsze `null` (jak `formOkFor(..., skipFormCheck)` w `lesson-attempts.ts:608`), także na pytaniu `one_sentence`.
- Każdy przypadek dopisuje jeden `CaseOutcome`; odrzucenie i błąd dostawcy dają `knowledgeMatch: null, precisionMatch: null`.
- Dotychczasowe liczniki (`knowledgeOk`, `precisionOk`, `missing*`, `form*`, `invalid`, `confusion*`, `fragments*`), `total` i bramka liczą wyłącznie przypadki pisane. Przypadek mówiony po zapisaniu `CaseOutcome` pomija resztę pętli.
- Niezgodność przypadku mówionego trafia do `failures` z przedrostkiem `[MOWA]` i nigdy z `[TWARDA]`, np. `[MOWA] S03 (mowa — autokorekta faktu): wiedza partial ≠ correct; precyzja verbose ≠ concise` albo `[MOWA] S03 (…): werdykt odrzucony przez walidator`.
- Po dotychczasowym wierszu podsumowania wypisz dwa wiersze z `groupReportLines`.
- W komentarzu nagłówka pliku dopisz jedno zdanie: przypadki mówione są raportowane osobno i nie bramkują.

- [ ] **Step 6: Sprawdź przebieg bez modelu**

Run: `corepack pnpm eval:school-grader -- --fake`
Expected: kod wyjścia 0; wiersz podsumowania zaczyna się od `przypadki=27`; po nim wiersze `pisane: przypadki=27 …` i `mówione: przypadki=10 …`; ostatni wiersz `fake: raport informacyjny, bez bramki`.

- [ ] **Step 7: Sprawdź typy i commit**

Run: `corepack pnpm typecheck`
Expected: bez błędów.

```bash
git add tests/probes/school-grader-report.ts tests/school-grader-report.test.ts scripts/evaluate-school-grader.mts
git commit -m "Sonda gradera: raport osobno dla odpowiedzi pisanych i mówionych"
```

### Task 3: Pomiar bazowy na prawdziwym modelu (AC-03)

**Files:**
- Create: `tests/probes/results/school-grader-speech-baseline.md`
- Modify: `docs/architecture.md:937` (zdanie o bramce zestawu)

**Interfaces:**
- Consumes: raport z zadania 2.
- Produces: zapisany pomiar bazowy, punkt odniesienia dla AC-08 w story 2.

- [ ] **Step 1: Zatrzymaj się i poproś właściciela o zgodę na przebieg**

Podaj: 37 wywołań modelu z `UMIEM_GRADER_*` (domyślnie Gemini 3.8 Flash), bez limitu kosztu w skrypcie. Bez zgody nie uruchamiaj kroku 2; zadanie zostaje otwarte.

- [ ] **Step 2: Uruchom pomiar**

Run: `corepack pnpm eval:school-grader`
Expected: pierwszy wiersz `arm=real model=… promptVersion=…`; wiersze `pisane:` i `mówione:`; `BRAMKA: OK` (bramka liczy tylko pisane — inny wynik zgłoś właścicielowi, nie poprawiaj zestawu ani promptu).

- [ ] **Step 3: Zapisz wynik w `tests/probes/results/school-grader-speech-baseline.md`**

Zawartość: data, commit, pełne wyjście skryptu w bloku kodu (model i wersja promptu są w pierwszym wierszu), a pod nim tabela przypadków `S01`–`S10`: oczekiwane, otrzymane, zgodność. Bez interpretacji i bez rekomendacji zmian promptu — to robi story 2.

- [ ] **Step 4: Zaktualizuj `docs/architecture.md:937`**

Do zdania o bramce dopisz: zestaw zawiera też przypadki mówione, raportowane osobno i poza bramką.

- [ ] **Step 5: Sprawdź dryf dokumentacji i commit**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts tests/docs-architecture-drift.test.ts`
Expected: PASS.

```bash
git add tests/probes/results/school-grader-speech-baseline.md docs/architecture.md
git commit -m "Sonda gradera: pomiar bazowy odpowiedzi mówionych"
```

- [ ] **Step 6: Odbiór (`done_checkpoint`)**

Pokaż właścicielowi wiersz `mówione:` i listę `[MOWA]`. Nie zaczynaj story 2 przed jego decyzją.

## Wiersz AC → test

| AC | Test |
| --- | --- |
| AC-01 | `tests/school-grader-golden-set.test.ts` |
| AC-02 | `tests/school-grader-report.test.ts` + zadanie 2, krok 6 |
| AC-03 | zadanie 3, kroki 1–3 (zgoda, wyjście z modelem i wersją promptu, data w pliku wyniku) |
