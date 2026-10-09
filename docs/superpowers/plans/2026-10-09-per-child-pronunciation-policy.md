# Polityka wymowy per dziecko i fragmenty słowa — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Progi oceny wymowy konfigurowalne per dziecko (niezmienne wersje polityk + edytor i lista kalibracyjna w panelu rodzica) oraz podświetlanie dobrze/„prawie” wymówionych fragmentów słowa w feedbacku dziecka.

**Architecture:** Profil dziecka wskazuje własną wersję polityki (`child_profiles.policy_id`); edycja progów tworzy nowy niezmienny wiersz `learning_policies` i przepina profil w jednej transakcji. Globalna wersja `learning-v2` (= v1 + pasma 70/50) staje się domyślną. Adapter Azure przechodzi na `Granularity: "Phoneme"`; czysta funkcja domenowa mapuje fonemy na grupy liter, a fragmenty (tekst + werdykt, bez liczb) jadą do dziecka wyłącznie przez `FeedbackDto`.

**Tech Stack:** Next.js App Router, Drizzle ORM + przeglądane migracje SQL, Zod, Vitest (unit + integracyjne na prawdziwym PostgreSQL), Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-09-per-child-pronunciation-policy-design.md`

## Global Constraints

- pnpm na tej maszynie działa tylko przez pełną ścieżkę: `"$HOME/AppData/Local/npm-global/pnpm"` (corepack zepsuty).
- Bramki z korzenia repo: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build` — nie deklaruj zielonych bramek bez outputu.
- Teksty UI po polsku wyłącznie w `packages/contracts/src/messages.ts`; kod, identyfikatory i commity po angielsku (conventional commits, np. `feat: …`, `fix: …`).
- Kid DTO nigdy nie zawiera liczb, score’ów ani IPA (SPEC §7); liczby widzi tylko rodzic.
- Polityki są niezmienne (trigger `learning_policies_immutable`); zmiana parametrów wyłącznie jako nowy wiersz wersji.
- Schemat TypeScript (`packages/server/src/db/schema.ts`) jest autorytatywny; migracje SQL przeglądane przed commitem.
- e2e: wyścig click↔fetch — czekaj na odpowiedź API (`waitForResponse`) przed asercjami DOM.
- Praca na gałęzi `impl/foundation`; merge do main wyłącznie po „akceptuję” właściciela.
- Testy integracyjne mowy używają fake providerów (`fakeSpeechDeps()` / lokalnych fake’ów konfigurowalnych), nigdy prawdziwego Azure.

---

### Task 1: `learning-v2`, kolumna `policy_id` profilu i przypinanie polityki dziecka

**Files:**
- Modify: `packages/server/src/db/schema.ts` (childProfiles, ~linie 65–78)
- Create: `packages/server/src/policies/learning-v2.ts`
- Modify: `packages/server/src/policies/registry.ts`
- Modify: `packages/server/src/modules/sessions.ts` (~linia 254, wstawianie wiersza sesji)
- Create: `packages/server/drizzle/0003_child_policy.sql` (+ wpis w `drizzle/meta/_journal.json` przez `db:generate`)
- Test: `tests/integration/sessions.test.ts` (nowy describe)

**Interfaces:**
- Consumes: istniejące `learningPolicies`, `childProfiles` (schema.ts), `loadPolicy`, `ensureLearningPolicy` (registry.ts), helpery `publishDeckWithAssignment`, `startSession`, `query` z `tests/integration/sessions.test.ts` / `tests/integration/helpers.ts`.
- Produces: `LEARNING_V2_POLICY` (export z `policies/learning-v2.ts`), `CURRENT_POLICY_ID = "learning-v2"`, kolumna `childProfiles.policyId: string | null`. Taski 2/5 korzystają z `Policy.pronunciationBands`; Task 6 z `childProfiles.policyId` i `CURRENT_POLICY_ID`.

- [ ] **Step 1: Write the failing test** — w `tests/integration/sessions.test.ts` dodaj describe (helpery i setup kopiuj z istniejących testów tego pliku):

```ts
describe("polityka per dziecka (design 2026-10-09)", () => {
  it("nowa sesja przypina learning-v2 z pasmami 70/50", async () => {
    const { deckId } = await publishDeckWithAssignment(baseServices, childId, ITEMS);
    const session = await startSession(baseServices, { childId, deckId, microphoneEnabled: true });
    const row = (
      await query<{ policy_id: string }>(
        `select policy_id from learning_app.learning_sessions where id = $1`,
        [session.sessionId],
      )
    )[0]!;
    expect(row.policy_id).toBe("learning-v2");
  });

  it("własna polityka profilu wygrywa z domyślną", async () => {
    const { deckId } = await publishDeckWithAssignment(baseServices, childId, ITEMS);
    await query(
      `update learning_app.child_profiles set policy_id = 'learning-v1' where id = $1`,
      [childId],
    );
    const session = await startSession(baseServices, { childId, deckId, microphoneEnabled: false });
    const row = (
      await query<{ policy_id: string }>(
        `select policy_id from learning_app.learning_sessions where id = $1`,
        [session.sessionId],
      )
    )[0]!;
    expect(row.policy_id).toBe("learning-v1");
  });
});
```

(`baseServices`/`childId`/`ITEMS`/`publishDeckWithAssignment`/`startSession`/`query` — istniejące fixture i helpery pliku, ten sam wzorzec co w `tests/integration/speech.test.ts`; po drugim teście przywróć `policy_id` na null, jeśli plik dziści shared `childId` między testami — dodaj `afterEach` z `update … set policy_id = null`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:integration -- tests/integration/sessions.test.ts`
Expected: FAIL — sesja przypina `learning-v1` (albo `learning-v2` nie istnieje w bazie).

- [ ] **Step 3: Implement**

`packages/server/src/policies/learning-v2.ts`:

```ts
import type { Policy } from "../domain/types";
import { LEARNING_V1_POLICY } from "./learning-v1";

/**
 * learning-v2 (design 2026-10-09): reguły identyczne z v1 plus domyślne pasma
 * wymowy z próby technicznej (docs/speech-spike.md — dorosły: poprawne 62–94).
 * „fake-pron” siedzi obok azure, żeby tryb bez kluczy (E2E/smoke) oceniał
 * deterministycznie; pasma nieużywanego providera są martwe.
 */
export const LEARNING_V2_POLICY: Policy = {
  ...LEARNING_V1_POLICY,
  version: "learning-v2",
  pronunciationBands: {
    "azure-pronunciation": { scaleMax: 100, correctMinScore: 70, partialMinScore: 50 },
    "fake-pron": { scaleMax: 100, correctMinScore: 70, partialMinScore: 50 },
  },
};
```

`packages/server/src/policies/registry.ts` — importuj `LEARNING_V2_POLICY`, zmień:

```ts
/** Identyfikator bieżącej polityki — przypinany do nowych sesji bez własnej polityki dziecka. */
export const CURRENT_POLICY_ID = LEARNING_V2_POLICY.version;

export async function ensureLearningPolicy(exec: Executor): Promise<void> {
  for (const policy of [LEARNING_V1_POLICY, LEARNING_V2_POLICY]) {
    await exec
      .insert(learningPolicies)
      .values({ id: policy.version, config: PolicyConfigSchema.parse(policy) as unknown as Record<string, unknown> })
      .onConflictDoNothing({ target: learningPolicies.id });
  }
}
```

`packages/server/src/db/schema.ts` — w `childProfiles` dodaj kolumnę (przed definicją `learningPolicies`; leniwa referencja działa):

```ts
    policyId: text("policy_id").references((): AnyPgColumn => learningPolicies.id),
```

Migracja: `"$HOME/AppData/Local/npm-global/pnpm" --dir packages/server db:generate`, sprawdź wygenerowany plik (musi zawierać wyłącznie `ALTER TABLE … child_profiles … ADD COLUMN policy_id …` + FK), zmień nazwę na `0003_child_policy.sql` i nagłówek komentarza na styl repozytorium:

```sql
-- Polityka nauki per dziecko (design 2026-10-09): profil wskazuje własną
-- wersję polityki (np. pasma wymowy); null = bieżąca wersja globalna.
```

`packages/server/src/modules/sessions.ts` — w `startSession`, w transakcji przed wstawieniem wiersza `learning_sessions`, odczytaj politykę dziecka i użyj jej w `.values({ … })` zamiast stałej:

```ts
      const childRow = (
        await tx.select({ policyId: childProfiles.policyId }).from(childProfiles).where(eq(childProfiles.id, input.childId))
      )[0];
      // …w values() sesji:
      policyId: childRow?.policyId ?? CURRENT_POLICY_ID,
```

(dopilnuj importu `childProfiles`, jeśli brakuje).

- [ ] **Step 4: Run test to verify it passes**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:integration -- tests/integration/sessions.test.ts`
Expected: PASS (oba nowe testy + cała reszta pliku).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/policies/ packages/server/src/modules/sessions.ts packages/server/drizzle/ tests/integration/sessions.test.ts
git commit -m "feat: per-child learning policy pinning with learning-v2 default bands"
```

---

### Task 2: Semantyka pasm — `below` nieocenione, `speechAttempt` w ścieżce pasem

**Files:**
- Modify: `packages/server/src/modules/speech.ts` (koniec `assessSpeechEvidence`, ~linie 149–175)
- Test: `packages/server/src/modules/speech.test.ts` (istniejące helpery `ctx`, `bandedPolicy`, `speechKey`, `evidence`)

**Interfaces:**
- Consumes: `assessSpeechEvidence(evidence, key, ctx)`, `PronunciationDetails.band`.
- Produces: pasmo `below` → `skills.pronunciation.outcome = "unevaluated"` z `details.pronunciation = { provider, score, band: "below" }`; `grade.speechAttempt` obecny w ŚCIEŻCE pasem (dziś tego brakuje — latentny bug: przy pasmach zadanie nie dostałoby `contentMatched`). Task 5 dokłada tu `speechFragments`.

- [ ] **Step 1: Write the failing tests** — w `speech.test.ts` dodaj:

```ts
describe("pasma wymowy (design 2026-10-09)", () => {
  it("below pozostaje nieocenione — niepewna ocena, nie błąd wiedzy", () => {
    const grade = assessSpeechEvidence(
      evidence({ pronunciation: { status: "ok", overallScore: 30, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(grade.skills.pronunciation?.outcome).toBe("unevaluated");
    expect(grade.skills.pronunciation?.details?.pronunciation).toMatchObject({ score: 30, band: "below" });
  });

  it("speechAttempt jest obecny przy ocenie z pasm — treść domyka zadanie niezależnie od bandu", () => {
    for (const overallScore of [95, 55, 30]) {
      const grade = assessSpeechEvidence(
        evidence({ pronunciation: { status: "ok", overallScore, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
        speechKey(),
        ctx({ policy: bandedPolicy() }),
      );
      expect(grade.speechAttempt).toEqual({ contentMatched: true });
    }
  });

  it("partial to trudność (incorrect z bandem), correct zalicza", () => {
    const partial = assessSpeechEvidence(
      evidence({ pronunciation: { status: "ok", overallScore: 45, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(partial.skills.pronunciation?.outcome).toBe("incorrect");
    expect(partial.skills.pronunciation?.details?.pronunciation).toMatchObject({ band: "partial" });
    expect(partial.skills.pronunciation?.confirmationEligible).toBe(false);
    const correct = assessSpeechEvidence(
      evidence({ pronunciation: { status: "ok", overallScore: 80, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday" } }),
      speechKey(),
      ctx({ policy: bandedPolicy() }),
    );
    expect(correct.skills.pronunciation?.outcome).toBe("correct");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/modules/speech.test.ts`
Expected: FAIL — `below` daje `incorrect`, `speechAttempt` jest `undefined` w ścieżce pasem.

- [ ] **Step 3: Implement** — w `assessSpeechEvidence` zastąp końcówkę (od `const band:`) oraz `return`:

```ts
  const band: PronunciationDetails["band"] =
    p.overallScore >= bands.correctMinScore
      ? "correct"
      : p.overallScore >= bands.partialMinScore
        ? "partial"
        : "below";
  if (band === "below") {
    // poniżej progu „prawie” to niepewna ocena, nie błąd wiedzy (design
    // 2026-10-09, docs/speech-spike.md) — wynik zostaje w details dla rodzica
    skills.pronunciation = { ...unevaluated(undefined), details: { pronunciation: { ...details, band } } };
  } else {
    skills.pronunciation = {
      outcome: band === "correct" ? "correct" : "incorrect",
      independent: attempt.independent,
      confirmationEligible: attempt.independent && attempt.confirmationEligible && band === "correct",
      details: { pronunciation: { ...details, band } },
    };
  }
  return { skills, attempt, ...(speechAttempt ? { speechAttempt } : {}) };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/modules/speech.test.ts`
Expected: PASS (nowe + wszystkie stare).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/modules/speech.ts packages/server/src/modules/speech.test.ts
git commit -m "fix: pronunciation below partial band stays unassessed and speechAttempt reaches band path"
```

---

### Task 3: Fonemy w adapterze Azure i fake providerze

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (typy przy `PronunciationResult`, ~linie 84–95)
- Modify: `packages/server/src/providers/azure/pronunciation.ts`
- Modify: `packages/server/src/providers/fake.ts` (`FakePronunciationProvider`, ~linie 190–196)
- Test: `packages/server/src/providers/azure/pronunciation.test.ts`

**Interfaces:**
- Consumes: `AzurePronunciationOptions.fetchImpl` (wstrzykiwany w testach), `letterGroups` z Tasku 4 (fake) — **uwaga na kolejność**: ten task korzysta z `letterGroups`; wykonaj Task 4 najpierw LUB tymczasowo zwróć z fake'a puste `words` i uzupełnij w Tasku 4 (rekomendacja: najpierw Task 4).
- Produces: `PronunciationResult.words?: PronunciationWord[]`, `PronunciationWord = { text: string; accuracyScore: number | null; errorType: string | null; phonemes: PronunciationPhoneme[] }`, `PronunciationPhoneme = { phoneme: string; accuracyScore: number | null }`. Azure normalizuje `ErrorType: "None"` → `null`.

- [ ] **Step 1: Write the failing test** — w `providers/azure/pronunciation.test.ts` dodaj (wzorzec istniejących testów: `fetchImpl` zwraca `Response` z JSON):

```ts
it("parsuje Words/Phonemes z Granularity Phoneme i normalizuje ErrorType None", async () => {
  const provider = createAzurePronunciationProvider({
    subscriptionKey: "k",
    region: "germanywestcentral",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          RecognitionStatus: "Success",
          DisplayText: "cherry.",
          NBest: [
            {
              AccuracyScore: 82,
              Words: [
                {
                  Word: "cherry",
                  AccuracyScore: 82,
                  ErrorType: "None",
                  Phonemes: [
                    { Phoneme: "tʃ", AccuracyScore: 90 },
                    { Phoneme: "ɛ", AccuracyScore: 61 },
                    { Phoneme: "r", AccuracyScore: 88 },
                    { Phoneme: "i", AccuracyScore: 85 },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
  });
  const result = await provider.assess({ bytes: new Uint8Array([1]), mimeType: "audio/wav", locale: "en-GB" }, "cherry");
  expect(result.status).toBe("ok");
  expect(result.overallScore).toBe(82);
  expect(result.words).toEqual([
    {
      text: "cherry",
      accuracyScore: 82,
      errorType: null,
      phonemes: [
        { phoneme: "tʃ", accuracyScore: 90 },
        { phoneme: "ɛ", accuracyScore: 61 },
        { phoneme: "r", accuracyScore: 88 },
        { phoneme: "i", accuracyScore: 85 },
      ],
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/providers/azure/pronunciation.test.ts`
Expected: FAIL — `result.words` jest `undefined`.

- [ ] **Step 3: Implement**

`ports/ai.ts` — przy `PronunciationResult` dodaj typy i pole:

```ts
/** Pojedynczy fonem oceny wymowy (Azure, Granularity Phoneme). */
export interface PronunciationPhoneme {
  phoneme: string;
  accuracyScore: number | null;
}

/** Jedno słowo oceny wymowy z fonemami; ErrorType null = bez zastrzeżeń. */
export interface PronunciationWord {
  text: string;
  accuracyScore: number | null;
  errorType: string | null;
  phonemes: PronunciationPhoneme[];
}

export interface PronunciationResult {
  status: "ok" | "no_speech" | "failed";
  overallScore: number | null;
  recognizedText: string | null;
  /** Fonemy per słowo, gdy provider je zwraca; opcjonalne dla zgodności. */
  words?: PronunciationWord[];
}
```

`providers/azure/pronunciation.ts`:

1. import `z` z `zod`;
2. `Granularity: "Word"` → `"Phoneme"` w `assessmentParams`;
3. typ odpowiedzi rozszerz i waliduj:

```ts
const WordSchema = z.object({
  Word: z.string(),
  AccuracyScore: z.number().nullish(),
  ErrorType: z.string().nullish(),
  Phonemes: z.array(z.object({ Phoneme: z.string(), AccuracyScore: z.number().nullish() })).optional(),
});

const ResponseSchema = z.object({
  RecognitionStatus: z.string().optional(),
  DisplayText: z.string().optional(),
  NBest: z
    .array(z.object({ Confidence: z.number().optional(), AccuracyScore: z.number().optional(), Words: z.array(WordSchema).optional() }))
    .optional(),
});
```

4. w sukcesie (`const payload = …`):

```ts
        const payload = ResponseSchema.parse(await response.json());
        const best = payload.NBest?.[0];
        if (payload.RecognitionStatus !== "Success" || !best) {
          return { status: "no_speech", overallScore: null, recognizedText: null };
        }
        const score = best.AccuracyScore;
        return {
          status: "ok",
          overallScore: typeof score === "number" ? score : null,
          recognizedText: payload.DisplayText?.trim() || null,
          ...(best.Words
            ? {
                words: best.Words.map((word) => ({
                  text: word.Word.toLowerCase(),
                  accuracyScore: word.AccuracyScore ?? null,
                  errorType: word.ErrorType && word.ErrorType !== "None" ? word.ErrorType : null,
                  phonemes: (word.Phonemes ?? []).map((phoneme) => ({
                    phoneme: phoneme.Phoneme,
                    accuracyScore: phoneme.AccuracyScore ?? null,
                  })),
                })),
              }
            : {}),
        };
```

Usuń stary interfejs `AzurePronunciationResponse` (zastąpiony schematem Zod). Testy o kształcie bez `Words` muszą dalej przechodzić (pole opcjonalne).

`providers/fake.ts` — `FakePronunciationProvider`:

```ts
/** Fake oceny wymowy: wysoki wynik i fonemy idealnie zgrane z grupami liter. */
export class FakePronunciationProvider implements PronunciationProvider {
  readonly name = "fake-pron";
  async assess(_audio: AudioInput, expectedText: string): Promise<PronunciationResult> {
    const word = expectedText.trim().toLowerCase();
    return {
      status: "ok",
      overallScore: 95,
      recognizedText: expectedText,
      words: [
        {
          text: word,
          accuracyScore: 95,
          errorType: null,
          phonemes: letterGroups(word).map((group) => ({ phoneme: group, accuracyScore: 96 })),
        },
      ],
    };
  }
}
```

(immport: `import { letterGroups } from "../domain/pronunciation-fragments";`)

- [ ] **Step 4: Run tests**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/providers/azure/pronunciation.test.ts packages/server/src/providers/fake.test.ts 2>/dev/null || "$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/providers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ports/ai.ts packages/server/src/providers/azure/pronunciation.ts packages/server/src/providers/azure/pronunciation.test.ts packages/server/src/providers/fake.ts
git commit -m "feat: parse azure phoneme-level words and align fake provider phonemes"
```

---

### Task 4: Domena fragmentów — `letterGroups` i `buildPronunciationFragments`

**Files:**
- Create: `packages/server/src/domain/pronunciation-fragments.ts`
- Modify: `packages/server/src/domain/types.ts` (`Grade` += `speechFragments`)
- Test: `packages/server/src/domain/pronunciation-fragments.test.ts`

**Interfaces:**
- Produces (konsumowane w Taskach 3 i 5):
  - `letterGroups(word: string): string[]`
  - `buildPronunciationFragments(target: string, word: FragmentInput | undefined, bands: { correctMinScore: number; partialMinScore: number }, overallBand: "correct" | "partial"): PronunciationFragment[]`
  - `PronunciationFragment = { text: string; verdict: "good" | "almost" }`, `FragmentInput = { text: string; errorType: string | null; phonemes: Array<{ phoneme: string; accuracyScore: number | null }> }` (strukturalnie zgodne z `PronunciationWord`)
  - `SpeechFragment` w `domain/types.ts`: `Grade` += `speechFragments?: Array<{ text: string; verdict: "good" | "almost" }>`

- [ ] **Step 1: Write the failing tests** — `packages/server/src/domain/pronunciation-fragments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPronunciationFragments, letterGroups } from "./pronunciation-fragments";

const bands = { correctMinScore: 70, partialMinScore: 50 };

function phonemes(entries: Array<[string, number | null]>) {
  return entries.map(([phoneme, accuracyScore]) => ({ phoneme, accuracyScore }));
}

describe("letterGroups", () => {
  it("tnie digrafy zachłannie", () => {
    expect(letterGroups("cherry")).toEqual(["ch", "e", "rr", "y"]);
    expect(letterGroups("monday")).toEqual(["m", "o", "n", "d", "ay"]);
    expect(letterGroups("ship")).toEqual(["sh", "i", "p"]);
  });
});

describe("buildPronunciationFragments", () => {
  it("zgrane fonemy dają scalone zielone grupy", () => {
    const fragments = buildPronunciationFragments(
      "cherry",
      { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96], ["ɛ", 94], ["r", 95], ["i", 96]]) },
      bands,
      "correct",
    );
    expect(fragments).toEqual([{ text: "cherry", verdict: "good" }]);
  });

  it("słaby fonem dzieli słowo na good/ almost", () => {
    const fragments = buildPronunciationFragments(
      "cherry",
      { text: "cherry", errorType: null, phonemes: phonemes([["tʃ", 96], ["ɛ", 40], ["r", 95], ["i", 96]]) },
      bands,
      "correct",
    );
    expect(fragments).toEqual([
      { text: "ch", verdict: "good" },
      { text: "e", verdict: "almost" },
      { text: "rry", verdict: "good" },
    ]);
  });

  it("symbole literowe (fake provider) i końcowe nieme e dopasowują się", () => {
    const fragments = buildPronunciationFragments(
      "grape",
      { text: "grape", errorType: null, phonemes: phonemes([["g", 96], ["r", 96], ["eɪ", 96], ["p", 96]]) },
      bands,
      "correct",
    );
    expect(fragments).toEqual([{ text: "grape", verdict: "good" }]);
  });

  it("ErrorType i za mało fonemów dają cały wyraz", () => {
    expect(
      buildPronunciationFragments("cherry", { text: "cherry", errorType: "Mispronunciation", phonemes: phonemes([["tʃ", 96]]) }, bands, "partial"),
    ).toEqual([{ text: "cherry", verdict: "almost" }]);
    expect(buildPronunciationFragments("no", { text: "no", errorType: null, phonemes: phonemes([["n", 96]]) }, bands, "correct")).toEqual([
      { text: "no", verdict: "good" },
    ]);
  });

  it("nieudane dopasowanie liter do fonemów daje cały wyraz", () => {
    const fragments = buildPronunciationFragments(
      "apple",
      { text: "apple", errorType: null, phonemes: phonemes([["æ", 96], ["p", 96], ["ə", 96], ["l", 96]]) },
      bands,
      "correct",
    );
    expect(fragments).toEqual([{ text: "apple", verdict: "good" }]);
  });

  it("brak słowa — fallback całego wyrazu z bandu", () => {
    expect(buildPronunciationFragments("cherry", undefined, bands, "partial")).toEqual([{ text: "cherry", verdict: "almost" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/domain/pronunciation-fragments.test.ts`
Expected: FAIL — moduł nie istnieje.

- [ ] **Step 3: Implement** — `packages/server/src/domain/pronunciation-fragments.ts`:

```ts
/**
 * Fragmenty wymowy dla dziecka (design 2026-10-09): fonemy Azure mapowane na
 * grupy liter słowa docelowego, z werdyktem good/almost z pasm dziecka.
 * Wyłącznie wizualne — o ocenie umiejętności decyduje score całej wypowiedzi.
 * Bez liczb i IPA w DTO dziecka (SPEC §7).
 */

export interface PronunciationFragment {
  text: string;
  verdict: "good" | "almost";
}

export interface FragmentInput {
  text: string;
  errorType: string | null;
  phonemes: Array<{ phoneme: string; accuracyScore: number | null }>;
}

const VOWEL_LETTERS = new Set(["a", "e", "i", "o", "u", "y"]);
const VOWEL_PHONEMES = new Set([
  "æ", "ɛ", "ɪ", "ɒ", "ʌ", "ʊ", "ə", "ɜ", "ɐ", "ɑ", "ɔ", "i", "u", "e", "o", "a",
  "iː", "uː", "ɔː", "ɑː", "ɜː", "eɪ", "aɪ", "ɔɪ", "aʊ", "əʊ", "oʊ", "ɪə", "eə", "ʊə",
]);
const DIGRAPHS = new Set([
  "ch", "sh", "th", "ph", "wh", "ck", "ng", "qu", "ee", "ea", "oo", "ou", "ai", "ay",
  "oa", "oi", "oy", "au", "aw", "er", "ir", "ur", "ar", "or", "ie", "ue", "ui",
]);
const GROUP_PHONEMES: Record<string, string[]> = {
  ch: ["tʃ"], sh: ["ʃ"], th: ["θ", "ð"], ph: ["f"], wh: ["w"], ck: ["k"], ng: ["ŋ"],
  qu: ["kw", "k"], ee: ["iː"], ea: ["iː", "ɛ", "eɪ"], oo: ["uː", "ʊ"], ou: ["aʊ", "uː", "ə"],
  ai: ["eɪ"], ay: ["eɪ", "e"], oa: ["əʊ", "oʊ"], oi: ["ɔɪ"], oy: ["ɔɪ"], au: ["ɔː"], aw: ["ɔː"],
  er: ["ɜː", "ər"], ir: ["ɜː", "ər"], ur: ["ɜː", "ər"], ar: ["ɑː", "ər"], or: ["ɔː", "ər"],
  ie: ["iː", "aɪ"], ue: ["uː", "juː"], ui: ["uː", "juː", "ʊ"],
};
const LETTER_PHONEMES: Record<string, string[]> = {
  a: ["eɪ", "æ", "ɑː", "ə"], b: ["b"], c: ["k", "s"], d: ["d"], e: ["iː", "e", "ə", "ɪ"],
  f: ["f"], g: ["ɡ", "dʒ"], h: ["h"], i: ["ɪ", "aɪ"], j: ["dʒ"], k: ["k"], l: ["l"],
  m: ["m"], n: ["n", "ŋ"], o: ["ɒ", "əʊ", "oʊ", "ɔː", "ə"], p: ["p"], q: ["kw"],
  r: ["r", "ɹ"], s: ["s", "z"], t: ["t"], u: ["ʌ", "uː", "juː", "ʊ", "ə"],
  v: ["v"], w: ["w"], x: ["ks", "kz"], y: ["j", "aɪ", "i"], z: ["z"],
};

/** Zachłanny podział słowa na grupy liter: digrafy przed pojedynczymi literami. */
export function letterGroups(word: string): string[] {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "").split("");
  const groups: string[] = [];
  let i = 0;
  while (i < letters.length) {
    const pair = letters.slice(i, i + 2).join("");
    if (i + 1 < letters.length && DIGRAPHS.has(pair)) {
      groups.push(pair);
      i += 2;
    } else {
      groups.push(letters[i]!);
      i += 1;
    }
  }
  return groups;
}

function candidatesFor(group: string): string[] | undefined {
  if (GROUP_PHONEMES[group]) return GROUP_PHONEMES[group];
  // podwojona spółgłoska (rr, ll, ss…) brzmi jak pojedyncza
  if (group.length === 2 && group[0] === group[1]) return LETTER_PHONEMES[group[0]!];
  return LETTER_PHONEMES[group];
}

function groupMatches(group: string, phoneme: string): boolean {
  const candidates = candidatesFor(group);
  if (candidates?.includes(phoneme)) return true;
  if (phoneme === group) return true; // symbole literowe (fake provider)
  const last = group[group.length - 1]!;
  return VOWEL_LETTERS.has(last) && VOWEL_PHONEMES.has(phoneme);
}

interface AlignedGroup {
  text: string;
  scores: number[];
}

/** Zachłanne dopasowanie grup liter do fonemów; null = brak pewnego dopasowania. */
function align(target: string, phonemes: FragmentInput["phonemes"]): AlignedGroup[] | null {
  const groups = letterGroups(target);
  const aligned: AlignedGroup[] = [];
  let p = 0;
  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]!;
    const head = phonemes[p];
    if (head && groupMatches(group, head.phoneme)) {
      aligned.push({ text: group, scores: head.accuracyScore === null ? [] : [head.accuracyScore] });
      p += 1;
    } else if (group === "e" && p >= phonemes.length - (groups.length - g - 1)) {
      // nieme „e” — konsumuje zero fonemów, gdy reszta fonemów wystarcza reszcie liter
      aligned.push({ text: group, scores: [] });
    } else {
      return null;
    }
  }
  if (phonemes.length - p > 1) return null; // pojedynczy nadmiarowy fonem tolerowany (schwa/wstawienie)
  return aligned;
}

export function buildPronunciationFragments(
  target: string,
  word: FragmentInput | undefined,
  bands: { correctMinScore: number; partialMinScore: number },
  overallBand: "correct" | "partial",
): PronunciationFragment[] {
  const normalized = target.toLowerCase();
  const fallback: PronunciationFragment[] = [
    { text: normalized, verdict: overallBand === "correct" ? "good" : "almost" },
  ];
  const phonemes = word?.phonemes ?? [];
  if (!word || word.errorType !== null || phonemes.length < 2) return fallback;
  const aligned = align(normalized, phonemes);
  if (!aligned) return fallback;

  const marked = aligned.map<PronunciationFragment>((group) => {
    // brak score'u traktujemy optymistycznie — fragmenty są wyłącznie wizualne
    const scores = group.scores.length > 0 ? group.scores : [bands.correctMinScore];
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    return { text: group.text, verdict: mean >= bands.correctMinScore ? "good" : "almost" };
  });

  const merged: PronunciationFragment[] = [];
  for (const fragment of marked) {
    const last = merged[merged.length - 1];
    if (last && last.verdict === fragment.verdict) last.text += fragment.text;
    else merged.push({ ...fragment });
  }
  while (merged.length > 6) {
    let idx = 0;
    let bestLength = Infinity;
    for (let i = 0; i + 1 < merged.length; i += 1) {
      const length = merged[i]!.text.length + merged[i + 1]!.text.length;
      if (length < bestLength) {
        bestLength = length;
        idx = i;
      }
    }
    const first = merged[idx]!;
    const second = merged[idx + 1]!;
    merged.splice(idx, 2, {
      text: first.text + second.text,
      verdict: first.verdict === "almost" || second.verdict === "almost" ? "almost" : "good",
    });
  }
  return merged;
}
```

`domain/types.ts` — przy `Grade` dodaj:

```ts
/** Fragmenty wymowy pokazywane dziecku (design 2026-10-09) — bez liczb. */
export interface SpeechFragment {
  text: string;
  verdict: "good" | "almost";
}
```

i w `Grade`: `speechFragments?: SpeechFragment[];` (obok `speechAttempt`).

- [ ] **Step 4: Run test to verify it passes**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/domain/pronunciation-fragments.test.ts`
Expected: PASS. Jeśli test „nieme e” nie przechodzi — doprecyzuj warunek ciszy (`p >= phonemes.length - pozostałe grupy`), zachowując regułę: zero fonemów tylko dla końcowego/niepasującego „e”, nadmiar fonemów ≤ 1.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/pronunciation-fragments.ts packages/server/src/domain/pronunciation-fragments.test.ts packages/server/src/domain/types.ts
git commit -m "feat: letter-group alignment of pronunciation phonemes into kid fragments"
```

---

### Task 5: Ocena i feedback z fragmentami (serwer → kontrakt → kid-ui)

**Files:**
- Modify: `packages/server/src/modules/speech.ts` (końcówka pasem z Tasku 2)
- Modify: `packages/server/src/domain/feedback.ts` + `feedback.test.ts`
- Modify: `packages/contracts/src/kid.ts` (`FeedbackDtoSchema`)
- Modify: `packages/kid-ui/src/screens/LearnScreen.tsx` + `packages/kid-ui/src/styles.css`
- Test: `packages/server/src/modules/speech.test.ts`, `packages/server/src/domain/feedback.test.ts`, `tests/integration/speech.test.ts`

**Interfaces:**
- Consumes: `buildPronunciationFragments`, `SpeechFragment`, `p.words`, `match.matchedVariant`, `FeedbackDto`.
- Produces: `FeedbackDto.fragments?: Array<{ text: string; verdict: "good" | "almost" }>` (max 6) — konsumowane przez kid-ui i e2e (Task 7).

- [ ] **Step 1: Write the failing unit tests**

W `modules/speech.test.ts` (describe z Tasku 2) dodaj:

```ts
it("band correct z fonemami daje speechFragments; rozjazd słowa — cały wyraz", () => {
  const aligned = evidence({
    pronunciation: {
      status: "ok", overallScore: 90, recognizedText: "Thursday", provider: "fake-pron", expectedText: "Thursday",
      words: [{ text: "thursday", accuracyScore: 90, errorType: null,
        phonemes: [{ phoneme: "θ", accuracyScore: 95 }, { phoneme: "ɜː", accuracyScore: 40 }, { phoneme: "r", accuracyScore: 92 }, { phoneme: "s", accuracyScore: 91 }, { phoneme: "d", accuracyScore: 93 }, { phoneme: "eɪ", accuracyScore: 92 }] }],
    },
  });
  const grade = assessSpeechEvidence(aligned, speechKey(), ctx({ policy: bandedPolicy() }));
  expect(grade.speechFragments).toEqual([
    { text: "th", verdict: "good" },
    { text: "u", verdict: "almost" },
    { text: "rsday", verdict: "good" },
  ]);
  // Thursday → th,u,r,s,d,ay; „r” jako fonem pasuje do „r”, „s” do „s”, „d” do „d”, „eɪ” do „ay”
});
```

W `domain/feedback.test.ts` dodaj (konstrukcję `Grade` dopasuj do sąsiednich testów pliku — kluczowa jest obecność `speechFragments`):

```ts
it("feedback great niesie fragmenty wymowy, content_matched nie", () => {
  const fragments = [{ text: "ch", verdict: "good" as const }, { text: "e", verdict: "almost" as const }];
  const base = {
    attempt: { independent: true, confirmationEligible: true },
    speechFragments: fragments,
  };
  const great = chooseFeedback(
    { ...base, skills: { pronunciation: { outcome: "correct", independent: true, confirmationEligible: true } } } as never,
    "cherry",
  );
  expect(great.kind).toBe("great");
  expect(great.fragments).toEqual(fragments);
  const matched = chooseFeedback(
    { ...base, skills: {}, speechAttempt: { contentMatched: true } } as never,
    "cherry",
  );
  expect(matched.kind).toBe("content_matched");
  expect(matched.fragments).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit -- packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.test.ts`
Expected: FAIL — `speechFragments` undefined, `fragments` w feedbackzie brak.

- [ ] **Step 3: Implement**

`modules/speech.ts` — w ścieżce pasem (po wyliczeniu `band`, przed `return`):

```ts
  const word =
    p.words?.length === 1 && p.words[0]!.text.toLowerCase() === match.matchedVariant.toLowerCase()
      ? p.words[0]
      : undefined;
  const speechFragments =
    band === "below"
      ? undefined
      : buildPronunciationFragments(match.matchedVariant, word, bands, band === "correct" ? "correct" : "partial");
```

i finalny return:

```ts
  return {
    skills,
    attempt,
    ...(speechAttempt ? { speechAttempt } : {}),
    ...(speechFragments ? { speechFragments } : {}),
  };
```

(import `buildPronunciationFragments` z `../domain/pronunciation-fragments`).

`domain/feedback.ts`:

```ts
export interface FeedbackChoice {
  kind: FeedbackKind;
  correctText?: string;
  /** Fragmenty wymowy (design 2026-10-09) — tylko tekst i werdykt, bez liczb. */
  fragments?: Grade["speechFragments"];
}
```

W `chooseFeedback`: returny `great` i `almost` (w tym ścieżka `partial` wymowy) doklejają `...(grade.speechFragments ? { fragments: grade.speechFragments } : {})`; `incorrect`/`content_matched`/`not_assessed` — bez.

`contracts/src/kid.ts`:

```ts
export const PronunciationFragmentDtoSchema = z.object({
  text: z.string().min(1),
  verdict: z.enum(["good", "almost"]),
});

export const FeedbackDtoSchema = z.object({
  kind: z.enum(["great", "capitalization_hint", "almost", "incorrect", "content_matched", "not_assessed"]),
  correctText: z.string().min(1).optional(),
  fragments: z.array(PronunciationFragmentDtoSchema).max(6).optional(),
});
```

`kid-ui/src/screens/LearnScreen.tsx` — w karcie feedbacku, pod `<p className="kid-feedback-text">…</p>` (linia ~144):

```tsx
          {feedback.dto.fragments && feedback.dto.fragments.length > 0 && (
            <p className="kid-fragments" data-testid="kid-fragments">
              {feedback.dto.fragments.map((fragment, index) => (
                <span
                  key={index}
                  className={`kid-fragment kid-fragment--${fragment.verdict}`}
                  data-testid="kid-fragment"
                >
                  {fragment.text}
                </span>
              ))}
            </p>
          )}
```

`packages/kid-ui/src/styles.css`:

```css
.kid-fragments {
  display: flex;
  gap: 0.25rem;
  justify-content: center;
  margin-top: 0.75rem;
  font-size: 1.75rem;
  font-weight: 700;
}

.kid-fragment {
  padding: 0.1em 0.25em;
  border-radius: 0.4em;
}

.kid-fragment--good {
  background: #e3f4e3;
  color: #1c5c2e;
}

.kid-fragment--almost {
  background: #fdf6ec;
  color: #8a6116;
}
```

- [ ] **Step 4: Integration test (failing → passing)** — w `tests/integration/speech.test.ts` rozszerz lokalny fake oceny wymowy (`makeFakes`) o konfigurowalny wynik (`pronunciationScore` domyślnie 95; przy konfiguracji buduj `words` jak w `FakePronunciationProvider` — `letterGroups`). Następnie w describe ćwiczeń wymowy:

```ts
it("próba wymowy z fake'ami zwraca feedback z fragmentami (design 2026-10-09)", async () => {
  const fakes = makeFakes(clock); // transkacja „monday”, pronunciation 95, fonemy = letterGroups
  const services = speechServices(clock, fakes);
  const { deckId, versionId } = await publishDeckWithAssignment(baseServices, childId, ITEMS);
  await setDueProgress(childId, versionId, 0, "pronunciation");
  const session = await startSession(services, { childId, deckId, microphoneEnabled: true });
  // …pętga do zadania speech — wzorzec z istniejącego testu „ćwiczenie wymowy ocenia samą wymowę…”
  const dto = await submitSpeechAttempt(services, { taskId: task.taskId, clientAttemptId: randomUUID() }, wavInput(1));
  expect(dto.feedback?.fragments).toEqual([{ text: "monday", verdict: "good" }]);
  expect(dto.taskState).toBe("answered");
});
```

(„monday” → grupy `m,o,n,d,ay`, wszystkie 96 → jedna scalona zielona grupa. `learning-v2` z Tasku 1 daje pasma fake-pron 70/50.)

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:integration -- tests/integration/speech.test.ts`
Expected: PASS (nowy + wszystkie istniejące).

- [ ] **Step 5: Full unit pass + commit**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit`
Expected: PASS.

```bash
git add packages/server/src/modules/speech.ts packages/server/src/modules/speech.test.ts packages/server/src/domain/feedback.ts packages/server/src/domain/feedback.test.ts packages/contracts/src/kid.ts packages/kid-ui/src/screens/LearnScreen.tsx packages/kid-ui/src/styles.css tests/integration/speech.test.ts
git commit -m "feat: spoken-word fragments in speech feedback (no scores in kid DTO)"
```

---

### Task 6: API rodzica — `GET`/`PUT /api/v1/parent/children/:id/pronunciation`

**Files:**
- Modify: `packages/contracts/src/decks.ts` (DTO przy `ChildDto`)
- Modify: `packages/server/src/modules/profiles.ts`
- Create: `apps/web/src/app/api/v1/parent/children/[id]/pronunciation/route.ts`
- Test: `tests/integration/sessions.test.ts` lub nowy `tests/integration/pronunciation-settings.test.ts` (rekomendacja: nowy plik, wzorce setupu z `sessions.test.ts`/`auth-profiles.test.ts`)

**Interfaces:**
- Consumes: `CURRENT_POLICY_ID`, `loadPolicy`, `PolicyConfigSchema`, `childProfiles.policyId` (Task 1), `services.speech?.pronunciation.name`, `createChild` (profiles.ts), `withApi`/`assertSameOrigin`/`requireParentSession`/`getServerServices` (wzorzec: `apps/web/src/app/api/v1/parent/children/[id]/route.ts`).
- Produces: `PronunciationSettingsDto { pronunciationAvailable: boolean; thresholds: { correctMinScore: number; partialMinScore: number } | null; attempts: Array<{ word: string; score: number; band: "correct" | "partial" | "below" | null; attemptedAt: string }> }`; `updatePronunciationBands(services, childId, { correctMinScore, partialMinScore })`; trasy GET/PUT (Task 7 korzysta z URL i kształtu).

- [ ] **Step 1: Write the failing integration tests** — `tests/integration/pronunciation-settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createChild, createServices, fakeSpeechDeps, getPronunciationSettings, updatePronunciationBands } from "@learning/server";
import { buildTestServices, testDatabase } from "./helpers";

describe("ustawienia wymowy per dziecko (design 2026-10-09)", () => {
  it("GET: progi z learning-v2 przy aktywnej wymowie; unavailable bez providera", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "Szymon", avatarKey: "fox" });
    const withoutProvider = await getPronunciationSettings(bare, child.id);
    expect(withoutProvider.pronunciationAvailable).toBe(false);
    expect(withoutProvider.thresholds).toBeNull();

    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    const settings = await getPronunciationSettings(withSpeech, child.id);
    expect(settings.pronunciationAvailable).toBe(true);
    expect(settings.thresholds).toEqual({ correctMinScore: 70, partialMinScore: 50 });
  });

  it("PUT tworzy child-<id>-1, przepina profil, drugi PUT — -2; stare wiersze zostają", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "Krzyś", avatarKey: "owl" });
    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    await updatePronunciationBands(withSpeech, child.id, { correctMinScore: 75, partialMinScore: 55 });
    await updatePronunciationBands(withSpeech, child.id, { correctMinScore: 80, partialMinScore: 60 });

    const rows = await query<{ id: string }>(
      `select id from learning_app.learning_policies where id like $1 order by id`,
      [`child-${child.id}-%`],
    );
    expect(rows.map((row) => row.id)).toEqual([`child-${child.id}-1`, `child-${child.id}-2`]);
    const profile = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.child_profiles where id = $1`,
      [child.id],
    ))[0]!;
    expect(profile.policy_id).toBe(`child-${child.id}-2`);
    const config = (await query<{ config: { pronunciationBands: Record<string, { correctMinScore: number }> } }>(
      `select config from learning_app.learning_policies where id = $1`,
      [`child-${child.id}-2`],
    ))[0]!;
    expect(config.config.pronunciationBands["fake-pron"].correctMinScore).toBe(80);
  });

  it("PUT: brak providera → conflict; złe progi → validation; nieznany profil → not_found", async () => {
    const { services: bare, clock } = buildTestServices();
    const child = await createChild(bare, { displayName: "A", avatarKey: "cat" });
    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    await expectAppError(
      () => updatePronunciationBands(bare, child.id, { correctMinScore: 75, partialMinScore: 55 }),
      "conflict",
    );
    await expectAppError(
      () => updatePronunciationBands(withSpeech, child.id, { correctMinScore: 50, partialMinScore: 50 }),
      "validation",
    );
    await expectAppError(
      () => updatePronunciationBands(withSpeech, randomUUID(), { correctMinScore: 75, partialMinScore: 55 }),
      "not_found",
    );
  });

  it("aktywna sesja trzyma starą politykę po edycji progów", async () => {
    const { services: base, clock } = buildTestServices();
    const child = await createChild(base, { displayName: "B", avatarKey: "panda" });
    const withSpeech = createServices({ db: testDatabase().db, clock, speech: fakeSpeechDeps() });
    const { deckId } = await publishDeckWithAssignment(withSpeech, child.id, ITEMS);
    const session = await startSession(withSpeech, { childId: child.id, deckId, microphoneEnabled: true });
    await updatePronunciationBands(withSpeech, child.id, { correctMinScore: 90, partialMinScore: 70 });
    const row = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.learning_sessions where id = $1`,
      [session.sessionId],
    ))[0]!;
    expect(row.policy_id).toBe("learning-v2");
    const next = await startSession(withSpeech, { childId: child.id, deckId, microphoneEnabled: false });
    const nextRow = (await query<{ policy_id: string }>(
      `select policy_id from learning_app.learning_sessions where id = $1`,
      [next.sessionId],
    ))[0]!;
    expect(nextRow.policy_id).toBe(`child-${child.id}-1`);
  });

  it("trasy wymagają sesji rodzica", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const response = await GET(
      new Request(`http://localhost/api/v1/parent/children/${id}/pronunciation`),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(401);
  });
});
```

Na górze pliku dodaj importy helperów i tras (wzorzec `auth-profiles.test.ts`): `query`, `expectAppError`, `ITEMS`, `publishDeckWithAssignment`, `startSession` z `./helpers`/lokalnych wzorców `sessions.test.ts`/`speech.test.ts` oraz `import { GET, PUT } from "../../apps/web/src/app/api/v1/parent/children/[id]/pronunciation/route";` (przed importem ustaw `process.env.DATABASE_URL = testDatabaseUrl()` tak jak w `auth-profiles.test.ts`). Dodatkowo jeden pozytywny test HTTP (GET 200 z ciasteczkiem rodzica) według przepływu cookie z `auth-profiles.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:integration -- tests/integration/pronunciation-settings.test.ts`
Expected: FAIL — funkcje nie istnieją w eksporcie `@learning/server`.

- [ ] **Step 3: Implement**

`contracts/src/decks.ts` — przy `ChildDto`:

```ts
export const PronunciationAttemptDtoSchema = z.object({
  word: z.string().min(1),
  score: z.number(),
  band: z.enum(["correct", "partial", "below"]).nullable(),
  attemptedAt: z.string().min(1),
});

export const PronunciationSettingsDtoSchema = z.object({
  pronunciationAvailable: z.boolean(),
  thresholds: z.object({ correctMinScore: z.number(), partialMinScore: z.number() }).nullable(),
  attempts: z.array(PronunciationAttemptDtoSchema).max(20),
});

export const PronunciationBandsInputSchema = z.object({
  correctMinScore: z.number().int().min(0).max(100),
  partialMinScore: z.number().int().min(0).max(100),
}).refine((input) => input.correctMinScore > input.partialMinScore, {
  message: "correctMinScore must be greater than partialMinScore",
});

export type PronunciationSettingsDto = z.infer<typeof PronunciationSettingsDtoSchema>;
export type PronunciationBandsInput = z.infer<typeof PronunciationBandsInputSchema>;
```

`modules/profiles.ts` — dodaj (importy: `eq`, `like`, `sql` z drizzle-orm; `childProfiles`, `learningPolicies` ze schema; `CURRENT_POLICY_ID`, `loadPolicy`, `PolicyConfigSchema` z registry; `AppError`):

```ts
/** Ustawienia wymowy dziecka: progi z polityki efektywnej + próby do kalibracji (design 2026-10-09). */
export async function getPronunciationSettings(
  services: Services,
  childId: string,
): Promise<PronunciationSettingsDto> {
  const provider = services.speech?.pronunciation.name;
  const child = (await services.db.select().from(childProfiles).where(eq(childProfiles.id, childId)))[0];
  if (!child) throw new AppError("not_found", { message: "child profile not found" });
  if (!provider) return { pronunciationAvailable: false, thresholds: null, attempts: [] };
  const policy = await loadPolicy(services.db, child.policyId ?? CURRENT_POLICY_ID);
  const bands = policy.pronunciationBands[provider];
  const attemptRows = await services.db.execute(sql`
    select st.answer_key->>'target' as word,
           a.details->'pronunciation'->>'score' as score,
           a.details->'pronunciation'->>'band' as band,
           to_char(a.received_at, 'YYYY-MM-DD HH24:MI') as attempted_at
      from learning_app.assessments a
      join learning_app.session_tasks st on st.id = a.attempt_id
     where a.child_id = ${childId}
       and a.skill = 'pronunciation'
       and a.details->'pronunciation'->>'score' is not null
     order by a.received_at desc
     limit 20`);
  return {
    pronunciationAvailable: true,
    thresholds: bands ? { correctMinScore: bands.correctMinScore, partialMinScore: bands.partialMinScore } : null,
    attempts: (attemptRows.rows as Array<{ word: string; score: string; band: string | null; attempted_at: string }>).map((row) => ({
      word: row.word,
      score: Number(row.score),
      band: row.band === "correct" || row.band === "partial" || row.band === "below" ? row.band : null,
      attemptedAt: row.attempted_at,
    })),
  };
}

/** Zmiana progów = nowa, niezmienna wersja polityki przypięta do profilu (jedna transakcja). */
export async function updatePronunciationBands(
  services: Services,
  childId: string,
  input: { correctMinScore: number; partialMinScore: number },
): Promise<void> {
  const provider = services.speech?.pronunciation.name;
  if (!provider) throw new AppError("conflict", { message: "pronunciation is not configured" });
  const parsed = PronunciationBandsInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("validation", { message: "invalid pronunciation bands" });
  await services.db.transaction(async (tx) => {
    const child = (await tx.select().from(childProfiles).where(eq(childProfiles.id, childId)))[0];
    if (!child) throw new AppError("not_found", { message: "child profile not found" });
    const base = await loadPolicy(tx, child.policyId ?? CURRENT_POLICY_ID);
    const config = {
      ...base,
      pronunciationBands: {
        ...base.pronunciationBands,
        [provider]: { scaleMax: 100, correctMinScore: parsed.data.correctMinScore, partialMinScore: parsed.data.partialMinScore },
      },
    };
    const prefix = `child-${childId}-`;
    const existing = await tx.select({ id: learningPolicies.id }).from(learningPolicies).where(like(learningPolicies.id, `${prefix}%`));
    const newId = `${prefix}${existing.length + 1}`;
    await tx.insert(learningPolicies).values({
      id: newId,
      config: PolicyConfigSchema.parse(config) as unknown as Record<string, unknown>,
    });
    await tx.update(childProfiles).set({ policyId: newId }).where(eq(childProfiles.id, childId));
  });
}
```

Wyeksportuj obie funkcje z `packages/server/src/index.ts`.

`apps/web/src/app/api/v1/parent/children/[id]/pronunciation/route.ts` (wzorzec z `[id]/route.ts`):

```ts
import { getPronunciationSettings, updatePronunciationBands } from "@learning/server";
import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const dispatch = withApi<RouteContext>(async (request, context) => {
  assertSameOrigin(request);
  await requireParentSession(request, getServerServices());
  const { id } = await context.params;
  if (request.method === "GET") {
    const settings = await getPronunciationSettings(getServerServices(), id);
    return Response.json(settings);
  }
  await updatePronunciationBands(getServerServices(), id, (await request.json()) as { correctMinScore: number; partialMinScore: number });
  return new Response(null, { status: 204 });
});

export const GET = (request: Request, context: RouteContext): Promise<Response> => dispatch(request, context);
export const PUT = (request: Request, context: RouteContext): Promise<Response> => dispatch(request, context);
```

(Jeśli `withApi` wymaga osobnych handlerów per metoda z walidacją ciała inaczej — dopasuj do wzorca innych tras PUT/PATCH w `apps/web/src/app/api/v1/parent/`.)

- [ ] **Step 4: Run tests**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:integration -- tests/integration/pronunciation-settings.test.ts`
Expected: PASS. Dodatkowo jeden test HTTP z ciasteczkiem rodzica według wzorca `auth-profiles.test.ts` (setup → login → GET/PUT przez route handlery → 204/200/401) — jeśli plik ma do tego gotowe helpery, użyj ich.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/decks.ts packages/server/src/modules/profiles.ts packages/server/src/index.ts apps/web/src/app/api/v1/parent/children/\[id\]/pronunciation/route.ts tests/integration/pronunciation-settings.test.ts
git commit -m "feat: parent API for per-child pronunciation bands as new policy versions"
```

---

### Task 7: UI rodzica (ustawienia wymowy) + e2e

**Files:**
- Modify: `apps/web/src/parent/ChildEditor.tsx`
- Modify: `packages/contracts/src/messages.ts` (sekcja `children`)
- Test: `tests/e2e/parent-flow.spec.ts`, `tests/e2e/kid-flow.spec.ts`

**Interfaces:**
- Consumes: `PronunciationSettingsDto` z kontraktów, `apiFetch`/`errorMessage` z `./api`, trasy z Tasku 6, `feedback.dto.fragments` z Tasku 5.
- Produces: testidy `child-settings-<index>`, `child-threshold-good`, `child-threshold-almost`, `child-settings-save`, `child-attempts`, `child-attempt-row`; kid: `kid-fragments`, `kid-fragment` z klasą `kid-fragment--good`.

- [ ] **Step 1: Failing e2e (parent)** — w `parent-flow.spec.ts` dodaj test (login/wzorce z istniejących testów):

```ts
test("parent edits per-child pronunciation thresholds and sees calibration list", async ({ page }) => {
  // …wejście do panelu i utworzenie dziecka według wzorca istniejących testów…
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-settings-0").click();
  await expect(page.getByTestId("child-threshold-good")).toHaveValue("70");
  await expect(page.getByTestId("child-threshold-almost")).toHaveValue("50");
  await page.getByTestId("child-threshold-good").fill("75");
  await page.getByTestId("child-threshold-almost").fill("55");
  const saved = page.waitForResponse((response) => response.url().includes("/pronunciation") && response.request().method() === "PUT" && response.status() === 204);
  await page.getByTestId("child-settings-save").click();
  await saved;
  await page.reload();
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-settings-0").click();
  await expect(page.getByTestId("child-threshold-good")).toHaveValue("75");
  await expect(page.getByTestId("child-threshold-almost")).toHaveValue("55");
});
```

- [ ] **Step 2: Failing e2e (kid)** — w `kid-flow.spec.ts`, w gałęzi speech pętli (record → stop → feedback), dodaj asercję po pojawieniu się karty feedbacku:

```ts
  await expect(page.getByTestId("kid-fragment").first()).toHaveClass(/kid-fragment--good/);
```

(fake provider: fonemy 96 → jedna scalona zielona grupa; e2e działa pod `UMIEM_FAKE_PROVIDERS=1`.)

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:e2e -- tests/e2e/parent-flow.spec.ts tests/e2e/kid-flow.spec.ts`
Expected: FAIL (brak testidów/klas).

- [ ] **Step 3: Implement UI**

`messages.ts` — sekcja `children` += :

```ts
    pronunciationTitle: "Ustawienia wymowy",
    pronunciationThresholdGood: "Próg „dobrze” (0–100)",
    pronunciationThresholdAlmost: "Próg „prawie” (0–100)",
    pronunciationSave: "Zapisz progi",
    pronunciationUnavailable: "Ocena wymowy nie jest skonfigurowana (brak kluczy usługi mowy).",
    pronunciationAttemptsTitle: "Ostatnie próby wymowy",
    pronunciationBandCorrect: "dobrze",
    pronunciationBandPartial: "prawie",
    pronunciationBandBelow: "bez oceny",
    pronunciationEmpty: "Jeszcze żadna próba wymowy nie została oceniona.",
```

`ChildEditor.tsx` — dodaj komponent i rozwijanie w wierszu dziecka:

```tsx
function PronunciationSettings({ childId }: { childId: string }) {
  const [settings, setSettings] = useState<PronunciationSettingsDto | null>(null);
  const [good, setGood] = useState("");
  const [almost, setAlmost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<PronunciationSettingsDto>("GET", `/api/v1/parent/children/${childId}/pronunciation`);
    setSettings(data);
    if (data.thresholds) {
      setGood(String(data.thresholds.correctMinScore));
      setAlmost(String(data.thresholds.partialMinScore));
    }
  }, [childId]);

  useEffect(() => {
    load().catch((cause) => setError(errorMessage(cause)));
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("PUT", `/api/v1/parent/children/${childId}/pronunciation`, {
        correctMinScore: Number(good),
        partialMinScore: Number(almost),
      });
      await load();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="hint">…</p>;
  return (
    <section className="card">
      <h3>{messages.children.pronunciationTitle}</h3>
      {!settings.pronunciationAvailable || !settings.thresholds ? (
        <p>{messages.children.pronunciationUnavailable}</p>
      ) : (
        <>
          <label>
            {messages.children.pronunciationThresholdGood}
            <input data-testid="child-threshold-good" type="number" min={0} max={100} value={good} onChange={(event) => setGood(event.target.value)} />
          </label>
          <label>
            {messages.children.pronunciationThresholdAlmost}
            <input data-testid="child-threshold-almost" type="number" min={0} max={100} value={almost} onChange={(event) => setAlmost(event.target.value)} />
          </label>
          <button type="button" data-testid="child-settings-save" onClick={save} disabled={busy}>
            {messages.children.pronunciationSave}
          </button>
          <h4>{messages.children.pronunciationAttemptsTitle}</h4>
          <ul className="plain" data-testid="child-attempts">
            {settings.attempts.length === 0 && <li>{messages.children.pronunciationEmpty}</li>}
            {settings.attempts.map((attempt, index) => (
              <li data-testid="child-attempt-row" key={index}>
                {attempt.word} — {Math.round(attempt.score)}{" "}
                ({attempt.band === "correct" ? messages.children.pronunciationBandCorrect : attempt.band === "partial" ? messages.children.pronunciationBandPartial : messages.children.pronunciationBandBelow}){" "}
                · {attempt.attemptedAt}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
```

W wierszu listy dzieci dodaj przełącznik i warunkowe renderowanie:

```tsx
  const [openSettings, setOpenSettings] = useState<string | null>(null);
  // …w <li>:
  <button type="button" data-testid={`child-settings-${index}`} onClick={() => setOpenSettings(openSettings === child.id ? null : child.id)}>
    {messages.children.pronunciationTitle}
  </button>
  // …pod przyciskiem „Usuń”:
  {openSettings === child.id && <PronunciationSettings childId={child.id} />}
```

(zaimportuj `PronunciationSettingsDto` z `@learning/contracts` oraz `useCallback`/`useEffect` z react).

- [ ] **Step 4: Run e2e + unit**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:e2e`
Expected: PASS (wszystkie spektry). Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/parent/ChildEditor.tsx packages/contracts/src/messages.ts tests/e2e/parent-flow.spec.ts tests/e2e/kid-flow.spec.ts
git commit -m "feat: child pronunciation settings UI with calibration list and kid fragments e2e"
```

---

### Task 8: Dokumentacja, pełne bramki, deploy i weryfikacja

**Files:**
- Modify: `docs/SPEC.md`, `docs/architecture.md`
- Modify: `docs/implementation-plan.md` (odnotuj wykonanie — bez dopisywania nowych modułów)

**Interfaces:**
- Consumes: wszystko z Tasków 1–7.
- Produces: zaktualizowana dokumentacja uzgodnionych kontraktów; zweryfikowany lokalny deploy.

- [ ] **Step 1: Documentation** — SPEC.md:
  - w sekcji o ocenie wymowy (§15/§18, tam gdzie pasma): domyślne progi 70/50 (wersja `learning-v2`), polityka per dziecko, edycja progów w ustawieniach konta dziecka jako nowa wersja polityki, lista ostatnich prób wymowy z wynikami dla rodzica;
  - §7 (interfejs dziecka): feedback wymowy pokazuje fragmenty słowa (dobrze/„prawie”) bez liczb i IPA.
  architecture.md:
  - §9.3 (polityki): rozstrzyganie `child.policy_id ?? CURRENT_POLICY_ID`, wersje `child-<id>-<n>`, semantyka pasem (below → nieocenione);
  - §11 (mowa): fonemy z `Granularity: Phoneme`, fragmenty czysto wizualne, listy kalibracyjnej rodzica.

- [ ] **Step 2: Full gates**

Run z korzenia repo:
```bash
"$HOME/AppData/Local/npm-global/pnpm" test:unit
"$HOME/AppData/Local/npm-global/pnpm" test:integration
"$HOME/AppData/Local/npm-global/pnpm" test:e2e
"$HOME/AppData/Local/npm-global/pnpm" typecheck
"$HOME/AppData/Local/npm-global/pnpm" build
```
Expected: wszystkie PASS. Po e2e sprawdź zombie node na :24500 (`netstat -ano | grep 24500` + `taskkill //F //T //PID <pid>` — znana przypadłość).

- [ ] **Step 3: Deploy + żywa weryfikacja**

```bash
docker compose --env-file .env -f deploy/compose.yaml up -d --build --wait
curl -s http://localhost:8080/api/v1/health
```

Weryfikacja na żywo (read-only, bez fałszywych ocen dla dzieci):
1. `docker exec knowli-db-1 psql -U postgres -d knowli -c "select id from learning_app.learning_policies order by id"` — jest `learning-v2`.
2. W panelu rodzica (przeglądarka właściciela): zakładka „Dzieci” → „Ustawienia wymowy” Szymona: progi 70/50, lista prób z dotychczasowych sesji ( Azure score'e z details).
3. **Nie wykonuj** sesji dziecka w imieniu właściciela; prawdziwy przepływ fonemów potwierdzą dopiero realne sesje z dzieckiem — odnotuj to jako niezweryfikowane w raporcie.

- [ ] **Step 4: Commit + raport**

```bash
git add docs/SPEC.md docs/architecture.md docs/implementation-plan.md
git commit -m "docs: per-child pronunciation policy, default bands and spoken-word fragments"
```

Raport po polsku: co zmieniono, co zweryfikowano (bramki + deploy + weryfikacja live), co pozostaje niezweryfikowane (realne fonemy Azure z głosem dziecka, zachowanie progów po obserwacji).

---

## Uwagi wykonawcze

- Kolejność zależności: Task 4 przed Taskiem 3 (fake używa `letterGroups`); reszta po numerach.
- `tests/integration/sessions.test.ts` i `speech.test.ts` mają własne lokalne helpery (`query`, `expectAppError`, `makeFakes`, `publishDeckWithAssignment`, `setDueProgress`, `speechSession`) — nowe testy korzystają z nich zamiast duplikować setup.
- Zombie-objawy przy typechecku po zmianach kontraktów: uruchom typecheck po każdym tasku, nie tylko na końcu.
