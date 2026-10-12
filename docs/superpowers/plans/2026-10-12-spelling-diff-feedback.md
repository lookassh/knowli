# Feedback pisowni z różnicą liter — plan implementacji (issue #9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Po błędnej próbie pisemnej pokazać dziecku jego zapis i właściwy zapis z zaznaczonym miejscem różnicy (pigułki), liczone deterministycznie na serwerze względem najbliższego zatwierdzonego wariantu.

**Architecture:** Czysta funkcja domenowa `compareSpelling` (Damerau–Levenshtein z odczytem alignmentu) → wybór rodzaju feedbacku w `chooseFeedback` → segmenty w `FeedbackDto` (`kind: "spelling_hint"`) → kid-ui wyłącznie renderuje pigułki. Ekspozycje i oceny umiejętności pozostają nienaruszone.

**Tech Stack:** TypeScript strict, Zod (kontrakty), Vitest (unit/integration), Playwright (e2e), React + istniejący `styles.css` kid-ui.

**Spec:** `docs/superpowers/specs/2026-10-12-spelling-diff-feedback-design.md`

## Global Constraints

- Worktree: `C:/Users/looka/.zcode/worktrees/knowli/spelling-diff-feedback`, gałąź `feature/spelling-diff-feedback`. Commituj wyłącznie na tej gałęzi; bez push i PR do czasu polecenia właściciela.
- pnpm przez pełną ścieżkę (corepack zepsuty na tej maszynie): `"$(npm prefix -g)/pnpm.cmd" <cmd>` ( dalej zapisywane jako `pnpm <cmd>`).
- Filtrowanie testów: unit — `pnpm exec vitest run --config vitest.unit.config.ts <plik>`; integration — `pnpm exec vitest run --config vitest.integration.config.ts <plik>` (wymaga działającego Dockera, patrz `docker info`); e2e — `pnpm exec playwright test <plik>` (NIE `pnpm test:e2e -- <plik>` — nie filtruje). Przy równoległych sesjach e2e użyj izolatora: `UMIEM_TEST_RUN_ID=<unikalny> UMIEM_E2E_PORT=<wolny>`.
- **Oceny umiejętności pozostają bez zmian** (A16/SPEC §12.8): odległość tekstu nigdy nie zalicza Recall; diff nie zmienia `outcome`, `independent`, `confirmationEligible`, liczby prób, przejścia zadania ani budżetu sesji.
- Kid DTO pozostaje `.strict()` i bez sekretów; komunikaty UI po polsku (krótkie), identyfikatory i kod po angielsku.
- Oznaczenie różnicy musi mieć drugi kanał informacji poza kolorem (ramka pigułki).
- Bramka review przed zakończeniem: `superpowers:requesting-code-review` na całym zakresie `main..HEAD`.

---

### Task 1: Kontrakt — `spellingDiff` w `FeedbackDto` + komunikaty

**Files:**
- Modify: `packages/contracts/src/kid.ts` (FeedbackDtoSchema + nowe schematy)
- Modify: `packages/contracts/src/messages.ts` (nowe klucze obok `feedbackIncorrect`, ~linia 324)
- Test: Create `packages/contracts/src/kid-feedback.test.ts`

**Interfaces:**
- Consumes: istniejący `FeedbackDtoSchema` (kind enum, `correctText`, superRefine o `speech`).
- Produces (dla późniejszych zadań): typy `SpellingDiffSegmentDto` (`{ text: string; state: "plain" | "pill" }`), `SpellingDiff` (`{ given: SpellingDiffSegmentDto[]; expected: SpellingDiffSegmentDto[]; capitalizationHint?: boolean }`); `FeedbackDto["kind"]` zawiera `"spelling_hint"`; `FeedbackDto["spellingDiff"]?: SpellingDiff`; klucze `messages.kid`: `feedbackSpelling`, `feedbackSpellingCapitalization`, `spellingYourAnswer`, `spellingCorrect`, `spellingDiffAria`.

- [ ] **Step 1: Napisz testy schematu (RED)**

Utwórz `packages/contracts/src/kid-feedback.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FeedbackDtoSchema } from "./kid";

const diff = {
  given: [{ text: "We", state: "plain" }, { text: "nd", state: "pill" }, { text: "esday", state: "plain" }],
  expected: [{ text: "We", state: "plain" }, { text: "dn", state: "pill" }, { text: "esday", state: "plain" }],
};

describe("FeedbackDto — spelling_hint i spellingDiff (issue #9)", () => {
  it("przyjmuje spelling_hint z segmentami diffu", () => {
    const parsed = FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday", spellingDiff: diff });
    expect(parsed.success).toBe(true);
  });

  it("przyjmuje spelling_hint z opcjonalną wskazówką kapitalizacyjną", () => {
    const parsed = FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, capitalizationHint: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("odrzuca spelling_hint bez spellingDiff", () => {
    const parsed = FeedbackDtoSchema.safeParse({ kind: "spelling_hint", correctText: "Wednesday" });
    expect(parsed.success).toBe(false);
  });

  it("odrzuca spellingDiff przy innych rodzajach feedbacku", () => {
    for (const kind of ["great", "incorrect", "almost", "capitalization_hint", "not_assessed", "content_matched"] as const) {
      const parsed = FeedbackDtoSchema.safeParse({ kind, correctText: "Wednesday", spellingDiff: diff });
      expect(parsed.success).toBe(false);
    }
  });

  it("odrzuca puste segmenty i nieznane stany", () => {
    expect(FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, given: [{ text: "", state: "plain" }] },
    }).success).toBe(false);
    expect(FeedbackDtoSchema.safeParse({
      kind: "spelling_hint",
      correctText: "Wednesday",
      spellingDiff: { ...diff, expected: [{ text: "x", state: "bold" }] },
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/contracts/src/kid-feedback.test.ts`
Expected: FAIL — `spelling_hint` nie jest w enum, `spellingDiff` nie istnieje.

- [ ] **Step 3: Zaimplementuj schematy**

W `packages/contracts/src/kid.ts`, przed `FeedbackDtoSchema` dodaj:

```ts
/** Fragment zapisu w porównaniu pisowni; `pill` = fragment do wyróżnienia (issue #9). */
export const SpellingDiffSegmentSchema = z.object({
  text: z.string().min(1),
  state: z.enum(["plain", "pill"]),
});
export type SpellingDiffSegmentDto = z.infer<typeof SpellingDiffSegmentSchema>;

/**
 * Porównanie zapisu dziecka z właściwym wariantem: dwa zsegmentowane wiersze.
 * Segmenty `expected` składają się dokładnie na `correctText`; bez odległości
 * i technicznych score'ów (dziecko nie widzi liczb).
 */
export const SpellingDiffSchema = z.object({
  given: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  expected: z.array(SpellingDiffSegmentSchema).min(1).max(32),
  capitalizationHint: z.boolean().optional(),
});
export type SpellingDiff = z.infer<typeof SpellingDiffSchema>;
```

W `FeedbackDtoSchema`:
- `kind`: `z.enum([..., "spelling_hint", ...])` (pełna lista: `"great", "capitalization_hint", "almost", "incorrect", "content_matched", "not_assessed", "spelling_hint"`),
- dodaj pole `spellingDiff: SpellingDiffSchema.optional(),`
- w istniejącym `superRefine` dodaj na początku:

```ts
  if (feedback.kind === "spelling_hint" && feedback.spellingDiff === undefined) {
    ctx.addIssue({ code: "custom", path: ["spellingDiff"], message: "spelling_hint requires spellingDiff" });
  }
  if (feedback.kind !== "spelling_hint" && feedback.spellingDiff !== undefined) {
    ctx.addIssue({ code: "custom", path: ["spellingDiff"], message: "spellingDiff is only allowed with spelling_hint" });
  }
```

W `packages/contracts/src/messages.ts`, w bloku `kid` obok pozostałych `feedback*` (po `feedbackIncorrect`) dodaj:

```ts
    feedbackSpelling: "Prawie! Popraw zapis:",
    feedbackSpellingCapitalization: "Prawie! {word} piszemy wielką literą",
    spellingYourAnswer: "Twój zapis",
    spellingCorrect: "Poprawnie",
    spellingDiffAria: "Wpisałeś: {given}. Poprawnie: {expected}.",
```

- [ ] **Step 4: Uruchom testy (GREEN) i całość unit**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/contracts/src/kid-feedback.test.ts`
Expected: PASS (5 testów).
Run: `pnpm test:unit`
Expected: PASS — istniejące testy kontraktów (np. `speech-feedback.test.ts`) przechodzą bez zmian (nowy kind jest domknięty w superRefine, stare DTO bez `spellingDiff` nadal poprawne).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/kid.ts packages/contracts/src/messages.ts packages/contracts/src/kid-feedback.test.ts
git commit -m "feat(contracts): spelling_hint z segmentami diffu pisowni w FeedbackDto"
```

---

### Task 2: Domena — `compareSpelling` (Damerau–Levenshtein, segmentacja)

**Files:**
- Create: `packages/server/src/domain/spelling-diff.ts`
- Test: Create `packages/server/src/domain/spelling-diff.test.ts`

**Interfaces:**
- Consumes: `AnswerKey` z `./types` (`{ target: string; acceptedAnswers: readonly string[] }`).
- Produces: `SpellingDiffSegment` (`{ text: string; state: "plain" | "pill" }` — strukturalnie zgodny z `SpellingDiffSegmentDto` z kontraktów), `SpellingComparison` (`{ variant: string; distance: number; withinThreshold: boolean; capitalizationHint: boolean; given: SpellingDiffSegment[]; expected: SpellingDiffSegment[] }`), `compareSpelling(answer: string, key: AnswerKey): SpellingComparison | null` (null dla pustej odpowiedzi po normalizacji).

- [ ] **Step 1: Napisz testy (RED)**

Utwórz `packages/server/src/domain/spelling-diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compareSpelling } from "./spelling-diff";
import type { AnswerKey } from "./types";

function key(target: string, acceptedAnswers: readonly string[] = []): AnswerKey {
  return { exerciseType: "spelling", target, acceptedAnswers };
}

describe("compareSpelling — porównanie zapisu z zatwierdzonym wariantem (issue #9)", () => {
  it("brakująca litera: pigułka na brakującym fragmencie wzorca", () => {
    const result = compareSpelling("Wenesday", key("Wednesday"))!;
    expect(result.variant).toBe("Wednesday");
    expect(result.distance).toBe(1);
    expect(result.withinThreshold).toBe(true);
    expect(result.given).toEqual([{ text: "Wenesday", state: "pill" }]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);
    expect(result.capitalizationHint).toBe(false);
  });

  it("nadmiarowa litera: pigułka na nadmiarowym fragmencie wpisu", () => {
    const result = compareSpelling("Wedneseday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "Wednes", state: "plain" },
      { text: "e", state: "pill" },
      { text: "day", state: "plain" },
    ]);
    expect(result.expected).toEqual([{ text: "Wednesday", state: "pill" }]);
  });

  it("zamieniona litera: pigułki w obu wierszach", () => {
    const result = compareSpelling("Widnesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "Wi", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "We", state: "pill" },
      { text: "nesday", state: "plain" },
    ]);
  });

  it("przestawiona para sąsiednich liter liczy się jako jedna operacja", () => {
    const result = compareSpelling("Wendesday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.given).toEqual([
      { text: "We", state: "plain" },
      { text: "nd", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
    expect(result.expected).toEqual([
      { text: "We", state: "plain" },
      { text: "dn", state: "pill" },
      { text: "esday", state: "plain" },
    ]);
  });

  it("wielkość liter nie liczy się do odległości, ale ustawia wskazówkę", () => {
    const result = compareSpelling("wendsday", key("Wednesday"))!;
    expect(result.distance).toBe(1);
    expect(result.capitalizationHint).toBe(true);
  });

  it("próg: maksymalnie 2 operacje dla długich słów, 1 dla krótkich", () => {
    expect(compareSpelling("Wednsdya", key("Wednesday"))!.withinThreshold).toBe(true); // 2 przestawienia
    expect(compareSpelling("Wdnsdy", key("Wednesday"))!.withinThreshold).toBe(false); // 3 operacje
    expect(compareSpelling("cta", key("cat"))!.withinThreshold).toBe(true); // 1 (słowo ≤4 znaki)
    expect(compareSpelling("caat", key("cat"))!.withinThreshold).toBe(false); // 2 (słowo ≤4 znaki)
  });

  it("wybiera najbliższy wariant; remis rozstrzyga kanoniczny target", () => {
    const result = compareSpelling("colour", key("color", ["colour", "colourful"]))!;
    expect(result.variant).toBe("colour");
    expect(result.distance).toBe(0);
    const tie = compareSpelling("abc", key("abd", ["abe"]))!;
    expect(tie.variant).toBe("abd"); // target pierwszy wśród kandydatów
  });

  it("pusta odpowiedź i sam odstęp dają null", () => {
    expect(compareSpelling("", key("Wednesday"))).toBeNull();
    expect(compareSpelling("   ", key("Wednesday"))).toBeNull();
  });
});
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/spelling-diff.test.ts`
Expected: FAIL — brak modułu `./spelling-diff`.

- [ ] **Step 3: Zaimplementuj `spelling-diff.ts`**

```ts
import type { AnswerKey } from "./types";

/** Fragment zapisu w porównaniu pisowni; `pill` = różnica do wyróżnienia (issue #9). */
export interface SpellingDiffSegment {
  text: string;
  state: "plain" | "pill";
}

/** Porównanie odpowiedzi z jednym zatwierdzonym wariantem (SPEC §12.8, design 2026-10-12). */
export interface SpellingComparison {
  /** Wariant, do którego dopasowano odpowiedź (najbliższy edycyjnie). */
  variant: string;
  /** Odległość Damerau–Levenshteina bez rozróżniania wielkości liter. */
  distance: number;
  /** Czy odległość mieści się w progu diagnozy liter. */
  withinThreshold: boolean;
  /** Różnica wielkości liter w obrębie zgodnych pozycji. */
  capitalizationHint: boolean;
  given: SpellingDiffSegment[];
  expected: SpellingDiffSegment[];
}

type Step =
  | { op: "match"; a: number; b: number }
  | { op: "substitute"; a: number; b: number }
  | { op: "delete"; a: number }
  | { op: "insert"; b: number }
  | { op: "transpose"; a: number; b: number };

/**
 * Odległość Damerau–Levenshtein (restricted: przestawienia pary sąsiednich
 * liter) z odczytem alignmentu. Odpowiedź i warianty to krótkie pojedyncze
 * słowa, więc pełna macierz O(n·m) jest wystarczająca.
 */
function align(a: string, b: string): { distance: number; steps: Step[] } {
  const x = [...a.toLowerCase()];
  const y = [...b.toLowerCase()];
  const n = x.length;
  const m = y.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      steps.push({ op: "transpose", a: i - 2, b: j - 2 });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)) {
      steps.push({ op: x[i - 1] === y[j - 1] ? "match" : "substitute", a: i - 1, b: j - 1 });
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      steps.push({ op: "delete", a: i - 1 });
      i -= 1;
    } else {
      steps.push({ op: "insert", b: j - 1 });
      j -= 1;
    }
  }
  steps.reverse();
  return { distance: d[n][m], steps };
}

function pushSegment(segments: SpellingDiffSegment[], text: string, pill: boolean): void {
  const state = pill ? "pill" : "plain";
  const last = segments[segments.length - 1];
  if (last !== undefined && last.state === state) {
    last.text += text;
  } else {
    segments.push({ text, state });
  }
}

/**
 * Porównuje odpowiedź dziecka z najbliższym zatwierdzonym wariantem klucza.
 * Diagnoza liter jest komunikatem, nigdy podstawą oceny: podobieństwo tekstu
 * nie zalicza znaczenia (A16). Zwraca null dla pustej odpowiedzi.
 */
export function compareSpelling(answer: string, key: AnswerKey): SpellingComparison | null {
  const given = answer.normalize("NFC").trim();
  if (given === "") {
    return null;
  }
  const candidates = [key.target, ...key.acceptedAnswers]
    .map((candidate) => candidate.normalize("NFC").trim())
    .filter((candidate) => candidate !== "");
  if (candidates.length === 0) {
    return null;
  }
  const threshold = Math.min(...candidates.map((candidate) => [...candidate].length)) <= 4 ? 1 : 2;
  let best: { variant: string; distance: number; steps: Step[] } | null = null;
  for (const variant of candidates) {
    const result = align(given, variant);
    if (best === null || result.distance < best.distance) {
      best = { variant, ...result };
    }
  }

  let capitalizationHint = false;
  const givenSegments: SpellingDiffSegment[] = [];
  const expectedSegments: SpellingDiffSegment[] = [];
  const givenChars = [...given];
  const variantChars = [...best.variant];
  for (const step of best.steps) {
    switch (step.op) {
      case "match": {
        capitalizationHint ||= givenChars[step.a] !== variantChars[step.b];
        pushSegment(givenSegments, givenChars[step.a], false);
        pushSegment(expectedSegments, variantChars[step.b], false);
        break;
      }
      case "substitute": {
        pushSegment(givenSegments, givenChars[step.a], true);
        pushSegment(expectedSegments, variantChars[step.b], true);
        break;
      }
      case "delete": {
        pushSegment(givenSegments, givenChars[step.a], true);
        break;
      }
      case "insert": {
        pushSegment(expectedSegments, variantChars[step.b], true);
        break;
      }
      case "transpose": {
        pushSegment(givenSegments, givenChars[step.a] + givenChars[step.a + 1], true);
        pushSegment(expectedSegments, variantChars[step.b] + variantChars[step.b + 1], true);
        break;
      }
    }
  }
  return {
    variant: best.variant,
    distance: best.distance,
    withinThreshold: best.distance <= threshold,
    capitalizationHint,
    given: givenSegments,
    expected: expectedSegments,
  };
}
```

Uwaga o oczekiwanych segmentach w testach: backtracking preferuje transpozycję przed dopasowaniem, a przy „Wenesday” alignment wstawia brakujące „d” przed „n” (pierwsze minimum od lewej po odwróceniu kroków) — jeśli RED/GREEN pokaże inną (ale równie minimalną) lokalizację pigułki, np. „Wednesd/ay”, doprecyzuj testy do faktycznie wyznaczonej lokalizacji **o ile dystans i liczba pigułek pozostają zgodne z designem**; lokalizacja nie jest częścią kontraktu, liczy się liczba operacji i czytelność.

- [ ] **Step 4: Uruchom testy (GREEN)**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/spelling-diff.test.ts`
Expected: PASS (8 testów).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/spelling-diff.ts packages/server/src/domain/spelling-diff.test.ts
git commit -m "feat(server): compareSpelling — damerau-levenshtein z segmentami diffu"
```

---

### Task 3: Domena — `chooseFeedback` wybiera `spelling_hint`; ekspozycja klucza wariantu

**Files:**
- Modify: `packages/server/src/domain/feedback.ts`
- Test: Modify `packages/server/src/domain/feedback.test.ts`

**Interfaces:**
- Consumes: `compareSpelling`/`SpellingComparison`/`SpellingDiffSegment` z Task 2; `SpellingDiff` z Task 1 (strukturalnie zgodne).
- Produces: `FeedbackKind` zawiera `"spelling_hint"`; `FeedbackChoice.spellingDiff?: { given: SpellingDiffSegment[]; expected: SpellingDiffSegment[]; capitalizationHint?: boolean }`; `chooseFeedback(grade: Grade, correctText: string, diff?: SpellingComparison | null): FeedbackChoice`; `feedbackExposureKeys` uwzględnia `feedback.correctText`.

- [ ] **Step 1: Dopisz testy (RED)**

Na końcu pliku `packages/server/src/domain/feedback.test.ts` dodaj (importy rozszerz o `type SpellingComparison` z `./spelling-diff`):

```ts
describe("chooseFeedback — diagnoza liter po błędzie pisowni (issue #9)", () => {
  const typoDiff: SpellingComparison = {
    variant: "Wednesday",
    distance: 1,
    withinThreshold: true,
    capitalizationHint: false,
    given: [{ text: "Wenesday", state: "pill" }],
    expected: [
      { text: "We", state: "plain" },
      { text: "d", state: "pill" },
      { text: "nesday", state: "plain" },
    ],
  };

  it("literówka w progu daje spelling_hint z segmentami i wariantem jako correctText", () => {
    const result = chooseFeedback(grade({ recall: sg("incorrect"), spelling: sg("incorrect") }), "Wednesday", typoDiff);
    expect(result.kind).toBe("spelling_hint");
    expect(result.correctText).toBe("Wednesday");
    expect(result.spellingDiff).toEqual({
      given: typoDiff.given,
      expected: typoDiff.expected,
    });
  });

  it("spelling_hint dokleja wskazówkę kapitalizacyjną, gdy jedyna pozostała różnica to wielkość liter", () => {
    const result = chooseFeedback(
      grade({ recall: sg("incorrect"), spelling: sg("incorrect") }),
      "Wednesday",
      { ...typoDiff, capitalizationHint: true },
    );
    expect(result.spellingDiff).toEqual({ given: typoDiff.given, expected: typoDiff.expected, capitalizationHint: true });
  });

  it("odległość poza progiem pozostaje przy incorrect z pełnym rozwiązaniem", () => {
    const result = chooseFeedback(
      grade({ recall: sg("incorrect"), spelling: sg("incorrect") }),
      "Wednesday",
      { ...typoDiff, withinThreshold: false, distance: 4 },
    );
    expect(result.kind).toBe("incorrect");
    expect(result.spellingDiff).toBeUndefined();
  });

  it("kapitalizacja bez literówek pozostaje przy capitalization_hint (diff nie nadpisuje)", () => {
    const result = chooseFeedback(
      grade({
        recall: sg("correct"),
        spelling: sg("incorrect", { details: { spelling: { matchedVariant: "Wednesday", wordMatched: true, letterOrderMatched: true, capitalizationCorrect: false, capitalizationOnlyDefect: true } } }),
      }),
      "Wednesday",
      typoDiff,
    );
    expect(result.kind).toBe("capitalization_hint");
  });

  it("diff nie zmienia pochwały ani „Prawie” przy zaliczonych umiejętnościach", () => {
    expect(chooseFeedback(grade({ recall: sg("correct"), spelling: sg("correct") }), "Wednesday", typoDiff).kind).toBe("great");
  });

  it("feedbackExposureKeys uwzględnia ujawniony correctText (wariant, nie tylko canonical)", () => {
    const feedback = FeedbackDtoSchema.parse({
      kind: "spelling_hint",
      correctText: "colour",
      spellingDiff: { given: [{ text: "colur", state: "pill" }], expected: [{ text: "colou", state: "plain" }, { text: "r", state: "pill" }] },
    });
    const keys = feedbackExposureKeys(feedback, "color", "en-GB");
    expect(keys).toContain(computeTargetKey("color", "en-GB"));
    expect(keys).toContain(computeTargetKey("colour", "en-GB"));
  });
});
```

Dopisz import `FeedbackDtoSchema` z `@learning/contracts` na górze pliku (jeśli jeszcze nie ma).

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/feedback.test.ts`
Expected: FAIL — `spelling_hint` nie istnieje; `chooseFeedback` przyjmuje 2 argumenty; exposure keys bez klucza wariantu.

- [ ] **Step 3: Zaimplementuj zmiany w `feedback.ts`**

1. Import: `import type { SpellingComparison, SpellingDiffSegment } from "./spelling-diff";`
2. `FeedbackKind` — dodaj `"spelling_hint"` do unii.
3. `FeedbackChoice` — dodaj pole:

```ts
  /** Porównanie pisowni przy literówce w progu diagnozy (issue #9). */
  spellingDiff?: { given: SpellingDiffSegment[]; expected: SpellingDiffSegment[]; capitalizationHint?: boolean };
```

4. Sygnatura: `export function chooseFeedback(grade: Grade, correctText: string, diff?: SpellingComparison | null): FeedbackChoice {`
5. Bezpośrednio przed końcowym `return { kind: "incorrect", correctText, ... }` dodaj:

```ts
  // literówka w progu: wpis i właściwy zapis z zaznaczoną różnicą (issue #9);
  // „prawie” odnosi się wyłącznie do zapisu — znaczenie pozostaje niezaliczone
  if (
    diff?.withinThreshold === true &&
    Object.entries(grade.skills).some(([skill, skillGrade]) => skill === "spelling" && skillGrade.outcome === "incorrect")
  ) {
    return {
      kind: "spelling_hint",
      correctText: diff.variant,
      spellingDiff: {
        given: diff.given,
        expected: diff.expected,
        ...(diff.capitalizationHint ? { capitalizationHint: true } : {}),
      },
      ...recognizedAnswer(grade),
      ...speech,
    };
  }
```

6. W `feedbackExposureKeys` zmień listę `texts` tak, aby obejmowała `feedback.correctText`:

```ts
  const texts = [feedback.speech?.referenceText, feedback.heardText, feedback.correctText].filter(
    (text): text is string => Boolean(text),
  );
```

- [ ] **Step 4: Uruchom testy (GREEN) i sąsiedztwo**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/feedback.test.ts`
Expected: PASS.
Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain`
Expected: PASS — `evaluate.test.ts` i `spoken-answer.test.ts` bez regresji.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/feedback.ts packages/server/src/domain/feedback.test.ts
git commit -m "feat(server): spelling_hint w chooseFeedback i ekspozycja klucza ujawnionego wariantu"
```

---

### Task 4: Serwer — próba tekstowa liczy diff i zwraca `spelling_hint`

**Files:**
- Modify: `packages/server/src/modules/attempts.ts` (`finalizeAttemptRow`, ~linie 251–300)
- Test: Modify `tests/integration/attempts.test.ts` (nowy przypadek w istniejącym `describe`)

**Interfaces:**
- Consumes: `compareSpelling` z Task 2, `chooseFeedback(grade, correctText, diff?)` z Task 3; `finalizeAttemptRow` ma dostęp do `attempt.answer` (`{ text: string }` dla `modality === "text"`), `key: AnswerKey`, `grade.skills.spelling`.
- Produces: `AttemptDto.feedback` z `kind: "spelling_hint"` i `spellingDiff` dla literówki w progu; brak zmian w ocenach, `taskState`, budżecie.

- [ ] **Step 1: Dopisz test integracyjny (RED)**

W `tests/integration/attempts.test.ts` dodaj test w istniejącym `describe` (wzorce: `publishDeckWithAssignment`, `setDueCheck`, `startSession`, `nextTask`, `submitAttempt`, `feedbackEvents` — patrz test „poprawna odpowiedź tekstowa…”):

```ts
  it("literówka w progu daje spelling_hint z segmentami; oceny i próby bez zmian (issue #9)", async () => {
    const { deckId, versionId } = await publishDeckWithAssignment(services, childId, DAY_ITEMS.slice(0, 3));
    await setDueCheck(childId, versionId, 0, "needs_confirmation", 3);
    const session = await startSession(services, { childId, deckId, microphoneEnabled: false });
    const task = (await nextTask(services, session.sessionId))!;
    expect(task.exerciseType).toBe("recall");

    const dto = await submitAttempt(services, {
      taskId: task.taskId,
      clientAttemptId: randomUUID(),
      modality: "text",
      text: "Monda", // Monday bez „y”
    });
    expect(AttemptDtoSchema.safeParse(dto).success).toBe(true);
    expect(dto.feedback?.kind).toBe("spelling_hint");
    expect(dto.feedback?.correctText).toBe("Monday");
    expect(dto.feedback?.spellingDiff).toMatchObject({
      given: expect.anything(),
      expected: expect.anything(),
    });
    expect(
      dto.feedback!.spellingDiff!.expected.map((segment) => segment.text).join(""),
    ).toBe("Monday");
    // pierwszy błąd zostawia drugą próbę: budżet i liczba prób bez zmian
    expect(dto.taskState).toBe("issued");

    const [attempt] = await attemptRows(task.taskId);
    const grades = await assessmentsOf(attempt!.id);
    expect(grades).toHaveLength(2);
    for (const grade of grades) {
      expect(grade.outcome).toBe("incorrect"); // podobieństwo nie zalicza znaczenia (A16)
    }
    // ujawnienie właściwego zapisu zapieczętowane przed odpowiedzią HTTP
    const events = await feedbackEvents(task.taskId);
    expect(events).toHaveLength(1);
    expect(events[0]!.sealed).toBe(true);
  });
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Wymagania: Docker uruchomiony (`docker info`).
Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/attempts.test.ts`
Expected: FAIL — `dto.feedback?.kind` to `"incorrect"` (bez diffu).

- [ ] **Step 3: Zaimplementuj liczenie diffu w `finalizeAttemptRow`**

W `packages/server/src/modules/attempts.ts`:

1. Import: `import { compareSpelling } from "../domain/spelling-diff";`
2. W `finalizeAttemptRow`, po `const correctText = correctTextOf(task, key);` i przed `let feedback = ...` dodaj:

```ts
  // diagnoza liter wyłącznie dla odpowiedzi pisemnej z ocenianą pisownią (issue #9);
  // to komunikat, nie podstawa oceny — odległość nie zalicza znaczenia (A16)
  const answerText =
    modality === "text" ? ((attempt.answer as { text?: string } | null)?.text ?? null) : null;
  const spellingIncorrect = grade.skills.spelling?.outcome === "incorrect";
  const diff =
    answerText !== null &&
    spellingIncorrect &&
    ["recall", "spelling", "letter_completion"].includes(key.exerciseType)
      ? compareSpelling(answerText, key)
      : null;
```

3. Zmień wywołanie: `let feedback: FeedbackDto | null = session.mode === "mock_test" ? null : chooseFeedback(grade, correctText, diff);`

- [ ] **Step 4: Uruchom testy (GREEN) i cały plik**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/attempts.test.ts`
Expected: PASS — nowy przypadek oraz wszystkie istniejące (retry, „Nie pamiętam”, 299 s, leniwa finalizacja).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/attempts.ts tests/integration/attempts.test.ts
git commit -m "feat(server): próba pisemna z literówką zwraca spelling_hint z diffem"
```

---

### Task 5: Kid UI — wiersze „Twój zapis”/„Poprawnie” z pigułkami

**Files:**
- Create: `packages/kid-ui/src/screens/spelling-diff-view.ts` + `spelling-diff-view.test.ts`
- Modify: `packages/kid-ui/src/screens/AnswerFeedback.tsx`
- Modify: `packages/kid-ui/src/styles.css`

**Interfaces:**
- Consumes: `FeedbackDto` (`spellingDiff?: SpellingDiff`), `messages` z `@learning/contracts` (klucze z Task 1), `format` z `../format`.
- Produces: `joinedText(segments: SpellingDiffSegmentDto[]): string` (sklejony zapis — opis dla czytników i testy); render sekcji `data-testid="kid-spelling-diff"` z wierszami `kid-spelling-given`/`kid-spelling-expected` i segmentami `kid-spelling-pill`.

- [ ] **Step 1: Napisz test funkcji widoku (RED)**

Utwórz `packages/kid-ui/src/screens/spelling-diff-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { joinedText } from "./spelling-diff-view";

describe("joinedText — sklejony zapis segmentów diffu (issue #9)", () => {
  it("skleja segmenty w pełny zapis", () => {
    expect(
      joinedText([
        { text: "We", state: "plain" },
        { text: "nd", state: "pill" },
        { text: "esday", state: "plain" },
      ]),
    ).toBe("Wendesday");
  });

  it("pusta lista daje pusty tekst", () => {
    expect(joinedText([])).toBe("");
  });
});
```

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/spelling-diff-view.test.ts`
Expected: FAIL — brak modułu.

- [ ] **Step 3: Zaimplementuj funkcję widoku i render**

Utwórz `packages/kid-ui/src/screens/spelling-diff-view.ts`:

```ts
import type { SpellingDiffSegmentDto } from "@learning/contracts";

/** Sklejony zapis segmentów — pełny tekst do opisu dla czytników ekranu. */
export function joinedText(segments: SpellingDiffSegmentDto[]): string {
  return segments.map((segment) => segment.text).join("");
}
```

W `AnswerFeedback.tsx`:

1. Import: `import { joinedText } from "./spelling-diff-view";`
2. W `feedbackText` dodaj przypadek przed `default`/na końcu switcha:

```ts
    case "spelling_hint":
      return dto.spellingDiff?.capitalizationHint
        ? format(messages.kid.feedbackSpellingCapitalization, { word: dto.correctText ?? "" })
        : messages.kid.feedbackSpelling;
```

3. W `feedbackTone` dodaj `case "spelling_hint":` do grupy zwracającej `"kid-feedback--retry"` (niebieski język „spróbuj jeszcze raz”).
4. W JSX, po bloku `feedback.fragments`, dodaj:

```tsx
        {feedback.spellingDiff && (
          <div className="kid-spelling-diff" data-testid="kid-spelling-diff">
            <p className="kid-sr-only">
              {format(messages.kid.spellingDiffAria, {
                given: joinedText(feedback.spellingDiff.given),
                expected: joinedText(feedback.spellingDiff.expected),
              })}
            </p>
            <div className="kid-spelling-row" data-testid="kid-spelling-given">
              <span className="kid-spelling-row-label">{messages.kid.spellingYourAnswer}</span>
              {feedback.spellingDiff.given.map((segment, index) => (
                <span
                  key={index}
                  className={segment.state === "pill" ? "kid-spelling-pill kid-spelling-pill--given" : "kid-spelling-plain"}
                  data-testid={segment.state === "pill" ? "kid-spelling-pill" : undefined}
                >
                  {segment.text}
                </span>
              ))}
            </div>
            <div className="kid-spelling-row" data-testid="kid-spelling-expected">
              <span className="kid-spelling-row-label">{messages.kid.spellingCorrect}</span>
              {feedback.spellingDiff.expected.map((segment, index) => (
                <span
                  key={index}
                  className={segment.state === "pill" ? "kid-spelling-pill kid-spelling-pill--expected" : "kid-spelling-plain"}
                  data-testid={segment.state === "pill" ? "kid-spelling-pill" : undefined}
                >
                  {segment.text}
                </span>
              ))}
            </div>
          </div>
        )}
```

Jeśli kid-ui nie ma klasy `kid-sr-only`, sprawdź w `styles.css` istniejącą klasę „visually hidden” i użyj jej; w razie braku dodaj definicję w kroku CSS.

W `packages/kid-ui/src/styles.css` (sekcja feedback, obok `.kid-heard-text`/`.kid-fragments`):

```css
.kid-spelling-diff {
  display: grid;
  gap: 8px;
  justify-items: center;
  margin-top: 8px;
}

.kid-spelling-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 8px;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.kid-spelling-row-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.7;
  width: 100%;
  text-align: center;
}

/* Pigułka: ramka jest drugim kanałem informacji poza kolorem (issue #9) */
.kid-spelling-pill {
  border: 2px solid currentColor;
  border-radius: 10px;
  padding: 0 6px;
}

.kid-spelling-pill--given {
  color: #1d4ed8;
  background: #eaf1ff;
}

.kid-spelling-pill--expected {
  color: #1a7f37;
  background: #e6f4ea;
}

.kid-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

Dopasuj odcienie do istniejących zmiennych kolorystycznych feedbacku w `styles.css` (`.kid-feedback--retry`, `.kid-fragment--good`), jeśli projekt ich używa.

- [ ] **Step 4: Uruchom testy (GREEN) + typecheck kid-ui**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens`
Expected: PASS — nowy test + istniejące `feedback-tone.test.ts` (switch w `feedbackText`/`feedbackTone` pokrywa nowy kind bez błędów exhaustiveness).
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kid-ui/src/screens/spelling-diff-view.ts packages/kid-ui/src/screens/spelling-diff-view.test.ts packages/kid-ui/src/screens/AnswerFeedback.tsx packages/kid-ui/src/styles.css
git commit -m "feat(kid-ui): wiersze „Twój zapis”/„Poprawnie” z pigułkami diffu pisowni"
```

---

### Task 6: E2E — literówka pokazuje pigułki po ocenie, nie wcześniej

**Files:**
- Test: Create `tests/e2e/spelling-diff-feedback.spec.ts`

**Interfaces:**
- Consumes: pełny przepływ aplikacji (profil dziecka → sesja → recall z `kid-input`), funkcje pomocnicze lokalne wg wzorca `tests/e2e/kid-flow.spec.ts` (`query`, `parentSession`, `createChild`, `createAssignedDeck`, `seedDue`, `openLearn`, `currentTaskId`, `settled`, `answerTarget` — skopiuj je do nowego pliku, to konwencja istniejących speców).

- [ ] **Step 1: Napisz test (RED)**

Utwórz `tests/e2e/spelling-diff-feedback.spec.ts` — nagłówek, importy i helpery skopiowane z `tests/e2e/kid-flow.spec.ts` (Playwright `test`/`expect`, `pool` z `tests/e2e/helpers`, wymienione funkcje), a następnie:

```ts
test("literówka w pisowni pokazuje diff z pigułkami dopiero po ocenie (issue #9)", async ({ page }) => {
  test.setTimeout(240_000);
  const parent = await parentSession(page);
  const child = await createChild(parent, "Ola Diff", "fox");
  const { deckId, publishedVersionId } = await createAssignedDeck(
    parent,
    child.id,
    "Dni tygodnia — diff pisowni",
    randomUUID(),
  );
  await seedDue(child.id, publishedVersionId, 0, "spelling");
  await openLearn(page, "Ola Diff");
  await page.waitForSelector('[data-testid="kid-input"]', { timeout: 30_000 });

  // przed odpowiedzią nie ma żadnej diagnozy liter
  await expect(page.getByTestId("kid-spelling-diff")).toHaveCount(0);

  const taskId = await currentTaskId(page);
  const target = await answerTarget(taskId);
  const typo = target.slice(0, -2) + target.slice(-1); // usunięcie przedostatniej litery: odległość 1
  await page.getByTestId("kid-input").fill(typo);
  await page.getByTestId("kid-submit").click();

  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  const diff = page.getByTestId("kid-spelling-diff");
  await expect(diff).toBeVisible();
  await expect(page.getByTestId("kid-spelling-given")).toContainText(typo);
  await expect(page.getByTestId("kid-spelling-expected")).toContainText(target);
  // drugi kanał informacji: pigułki istnieją niezależnie od koloru
  await expect(page.getByTestId("kid-spelling-pill").first()).toBeVisible();
  // pomoc po odpowiedzi nie zwiększa liczby prób: przycisk „Spróbuj jeszcze raz” wraca do zadania
  await expect(page.getByTestId("kid-next")).toHaveText(/Spróbuj jeszcze raz/);
});
```

Jeśli `seedDue(..., "spelling")` nie wymusza zadania z `kid-input` (a `kid-skip`), sprawdź w `kid-flow.spec.ts` który skill i status wywołują ekran pisemny i dostosuj (wzorcem jest `needs_confirmation` ze streakiem 3 → samodzielne sprawdzenie pisemne). Avatar dziecka (`"fox"`) zamień na wartość używaną w istniejących wywołaniach `createChild` w `kid-flow.spec.ts`.

- [ ] **Step 2: Uruchom i zapisz wynik**

Wymagania: Docker; przy równoległych sesjach izolator `UMIEM_TEST_RUN_ID=spelling-diff-1 UMIEM_E2E_PORT=<wolny>`.
Run: `pnpm exec playwright test tests/e2e/spelling-diff-feedback.spec.ts`

Kolejność a dowód RED: dowód RED→GREEN dla diagnozy liter dają testy jednostkowe i integracyjne zadań 1–4 (tam każdy test był uruchamiany przed implementacją). Ten spec jest testem akceptacyjnym pełnego stosu, dlatego:
- wykonany **przed** zadaniami 1–5 (na czystym `main`): FAIL — timeout na `kid-spelling-diff` po odpowiedzi; zapisz ten wynik jako dowód RED, jeśli zaczynasz plan od tego specu;
- wykonany **po** zadaniach 1–5 (kolejność numerowana): oczekiwane PASS od razu — potwierdź, że asercja „przed odpowiedzią brak diffu” faktycznie była sprawdzana (test wypełnia pole i czeka na `kid-feedback`), a nie przeszła przez pominięty krok.

- [ ] **Step 3: Doprowadź do przejścia (jeśli czerwony)**

Run: `pnpm exec playwright test tests/e2e/spelling-diff-feedback.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/spelling-diff-feedback.spec.ts
git commit -m "test(e2e): literówka pokazuje pigułki diffu po ocenie, bez dodatkowych prób"
```

---

### Task 7: Dokumentacja i pełna weryfikacja

**Files:**
- Modify: `docs/SPEC.md` (§12.8, §16)
- Modify: `docs/architecture.md` (§9 — kontrakt Kid API)

**Interfaces:**
- Consumes: cała implementacja z zadań 1–6.
- Produces: dokumentacja zgodna z wdrożonym kontraktem; pełne przebiegi testów jako dowód.

- [ ] **Step 1: Uzupełnij SPEC §12.8 i §16**

W §12.8 („Samodzielna pisownia”), po akapicie o komunikacie kapitalizacyjnym („To właściwe słowo! Monday piszemy wielką literą”) dodaj akapit:

```markdown
Po błędnej próbie pisemnej, której zapis jest bliski zatwierdzonemu wariantowi (co najwyżej dwie
operacje liter: brakująca, nadmiarowa, zamieniona lub przestawiona para; jedna dla słów do czterech
znaków), karta wyniku pokazuje obok siebie zapis dziecka i właściwy zapis z wyróżnionym miejscem
różnicy. Wyróżnienie ma formę obwódki, więc jest czytelne także bez rozróżniania kolorów, a wielkość
liter pozostaje objęta osobnym komunikatem. Diagnoza liter jest komunikatem, nie podstawą oceny:
podobieństwo tekstu nie zalicza przypomnienia ani pisowni, nie zwiększa liczby prób i nie wpływa na
budżet sesji. Pokazanie właściwego zapisu pozostaje ujawnieniem zapisanym przed doręczeniem feedbacku.
Pusta odpowiedź, pominięcie, „Nie pamiętam” i problemy techniczne nie otrzymują diagnozy liter.
```

W §16 („Reakcja na trudności i feedback”) dopisz do listy przykładów komunikatów pozycję:

```markdown
- „Prawie! Popraw zapis:” z zaznaczoną różnicą między wpisem dziecka a właściwym zapisem przy błędzie
  bliskiemu poprawnemu wariantowi;
```

- [ ] **Step 2: Uzupełnij architecture.md §9**

W sekcji kontraktu Kid API (§9), przy opisie `FeedbackDto`, dopisz zdanie opisujące nowe pole i rodzaj:

```markdown
`FeedbackDto` może zawierać `spellingDiff` — porównanie zapisu dziecka (`given`) z właściwym wariantem
(`expected`) w postaci segmentów `plain`/`pill`, wyłącznie przy rodzaju `spelling_hint`. Segmenty `expected`
składają się dokładnie na `correctText`, który w tym przypadku jest najbliższym zatwierdzonym wariantem
(i jako taki trafia do ujawnień feedbacku). Diff jest wyliczany wyłącznie na serwerze; klient go renderuje.
```

- [ ] **Step 3: Pełna weryfikacja (dowód przed raportem)**

Run (każde z oczekiwanym PASS):
1. `pnpm test:unit`
2. `docker info` → uruchom Docker Desktop, jeśli nie działa
3. `pnpm test:integration`
4. `pnpm typecheck`
5. `pnpm exec playwright test tests/e2e/spelling-diff-feedback.spec.ts tests/e2e/kid-flow.spec.ts`
6. `pnpm build`

- [ ] **Step 4: Commit**

```bash
git add docs/SPEC.md docs/architecture.md
git commit -m "docs: feedback pisowni z diagnozą liter w SPEC §12.8/§16 i kontrakcie §9"
```

- [ ] **Step 5: Bramka zakończenia**

Zgodnie z nagłówkiem planu: `superpowers:requesting-code-review` na zakresie `main..HEAD` (całość feature'u, nie ostatni commit), potem obsługa uwag przez `receiving-code-review`, i dopiero potem ewentualny `finishing-a-development-branch` na polecenie właściciela. PR tworzy wyłącznie właściciel wyraźnie zlecając; scalanie wyłącznie Squash and merge.

---

## Checklist zgodności ze spec (dla wykonawcy)

- [ ] Próg: ≤2 operacje (≤1 dla wariantów ≤4 znaków) — Task 2
- [ ] Damerau–Levenshtein z transpozycjami, case-insensitive — Task 2
- [ ] Wybór wariantu: najbliższy, remis → canonical target — Task 2
- [ ] Exact-match wariantu nigdy nie jest literówką innego — Task 2 (distance 0) + Task 3 (great/capitalization_hint wygrywają)
- [ ] DTO: segmenty plain/pill, spellingDiff tylko przy spelling_hint — Task 1
- [ ] Precedencja great > capitalization_hint > spelling_hint > incorrect — Task 3
- [ ] Oceny/próby/budżet bez zmian; A16 nienaruszone — Task 4 (test integracyjny)
- [ ] Ekspozycja ujawnionego wariantu zapieczętowana przed HTTP — Task 4 (test)
- [ ] Brak diagnozy dla pustych/skip/dont_remember/awarii/mock_test — Task 4 (warunek `modality === "text"` + spelling incorrect; mock_test ma feedback null)
- [ ] Pigułki z drugim kanałem (ramka) — Task 5
- [ ] Czytniki ekranu: pełny opis słowny — Task 5
- [ ] Pomoc tylko po odpowiedzi — Task 6 (asercja przed submitem)
- [ ] Dokumentacja zaktualizowana — Task 7
