# Zdania kart w generowaniu (PR wstępny #237) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Angielskie zdania wpisane w treść kart rozdziału są stałym źródłem ujawnień przy generowaniu puli (reguła twarda i lista zdań do unikania), bez zapisu do `lesson_context.examples` i bez zmian w pokryciu, publikacji i sesji.

**Architecture:** Opcjonalny hak `SubjectModule.cardExposureTexts` (tylko `english_chapter`) i czysta funkcja domenowa `generationExposureSources`, której wynik trafia wyłącznie do wejść `resolveGenerationLeaks.existingExamples` i `avoidSentencesFor.examples` w `executeLessonGeneration` i `stageTopUpRound`. Zapisywane przykłady i `stageDeficits` dostają przykłady nierozszerzone.

**Tech Stack:** TypeScript strict, Vitest (unit + integracja na PostgreSQL), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-04-lesson-pool-agent-stage1-design.md` §5 (wersja 2).

## Global Constraints

- Kod i identyfikatory po angielsku; komentarze, dokumentacja i opisy PR po polsku.
- Hak implementuje **tylko** `english_chapter`; gramatyka i szkoła go nie mają.
- Zdania kart **nigdy** nie trafiają do zapisywanego `lesson_context.examples`, `finalExamples` dla zapisu, renderowania karty ani fingerprintów nagrań.
- Bez zmian: `lessonCoverageGaps`/`stageDeficits`, publikacja, lista ujawnień edytora, raport ujawnień, `materializeCard`, krytyk (`lesson-review.ts`).
- Instalacja tylko `pnpm install --prefer-offline --frozen-lockfile`, nigdy `npm install`; ten PR nie zmienia zależności.
- Nie wypychaj do `main`, nie scalaj PR (AGENTS.md, Policy).

## Review Focus

- Karta z linią mieszaną polsko-angielską („Pokój — my room is big.”) — część angielska po „ — ” jest zdaniem tylko, gdy spełnia regułę; polska część nigdy (test w Task 1).
- Typograficzne apostrofy i cudzysłowy w zdaniu karty („There’s a bed.”) — reguła akceptuje apostrof typograficzny po normalizacji do `'` (test w Task 1).
- Dogenerowanie (`regenerate`) — zdania kart działają także dla nowej partii wobec przykładów szkicu (test w Task 2).
- Runda pod etap — źródło zdań kart w `resolveGenerationLeaks` i `avoidSentencesFor` rundy, a `stageDeficits` bez nich (test w Task 2).
- Zagadnienie, którego karty nie mają zdań — wynik równy wejściowym przykładom, bez pustych wpisów (test w Task 1).

---

### Task 1: Hak `cardExposureTexts` i `generationExposureSources`

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts` (pole w `SubjectModule`, obok `normalizeExposureText`)
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/exposure.ts`
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/module.ts`
- Create: `packages/server/src/domain/lessons/generation-exposure-sources.ts`
- Test: `packages/server/src/domain/lessons/subjects/english-chapter/exposure.test.ts`
- Test: `packages/server/src/domain/lessons/generation-exposure-sources.test.ts`

**Interfaces:**
- Produces:
  - `SubjectModule.cardExposureTexts?(cards: readonly { readonly body: string }[]): string[]` — komentarz JSDoc po polsku: teksty z treści kart, które dziecko widzi jako gotowe rozwiązania; używane wyłącznie przy generowaniu.
  - `chapterCardExposureTexts(cards: readonly { readonly body: string }[]): string[]` w `english-chapter/exposure.ts`.
  - `generationExposureSources(subject: Pick<SubjectModule, "cardExposureTexts">, topic: Pick<LessonTopic, "objectives">, examples: Readonly<Record<string, readonly string[]>>): Record<string, string[]>`.

- [ ] **Step 1: Testy `chapterCardExposureTexts`** w `exposure.test.ts`:

```ts
describe("chapterCardExposureTexts", () => {
  it("zdania angielskie z kart: kropka/pytajnik albo ≥ 3 słowa", () => {
    expect(chapterCardExposureTexts([{ body: "There is a bed in my room.\nWhere is the lamp?" }]))
      .toEqual(["There is a bed in my room.", "Where is the lamp?"]);
  });
  it("linia słówek nie jest zdaniem; część po „ — ” lub „ / ” oceniana osobno", () => {
    expect(chapterCardExposureTexts([{ body: "living room — salon\nbed — łóżko / I have a big bed." }]))
      .toEqual(["I have a big bed."]);
  });
  it("rama z wielokropkiem i tekst z polskimi znakami odpadają", () => {
    expect(chapterCardExposureTexts([{ body: "There's a … in the …\nTo jest mój pokój." }])).toEqual([]);
  });
  it("apostrof typograficzny normalizowany, duplikaty usunięte", () => {
    expect(chapterCardExposureTexts([{ body: "There’s a bed." }, { body: "There's a bed." }])).toEqual(["There's a bed."]);
  });
});
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/subjects/english-chapter/exposure.test.ts`
Expected: FAIL (`chapterCardExposureTexts` nie istnieje).

- [ ] **Step 3: Zaimplementuj `chapterCardExposureTexts`** — reguła `cardSentences` z PoC (`git show origin/probe/lesson-pool-agent:tests/probes/agent-generation-v2.probe.test.ts`, funkcja `cardSentences`): linie → części po `/\s+[—/]\s+/u` → apostrof typograficzny na `'` → pomiń puste, z wielokropkiem (`…` lub `...`) i niepasujące do `/^[A-Za-z][A-Za-z' ,.?!]*$/u` → zachowaj zakończone `[.?!]` albo mające ≥ 3 słowa → deduplikacja z zachowaniem kolejności. Podłącz w `englishChapterSubject` jako `cardExposureTexts: chapterCardExposureTexts`.

- [ ] **Step 4: Uruchom — PASS** (komenda jak w Step 2).

- [ ] **Step 5: Testy `generationExposureSources`** w `generation-exposure-sources.test.ts` (temat z dwoma zagadnieniami `o1`, `o2`; przedmiot-zaślepka z `cardExposureTexts: (cards) => cards.map((c) => c.body)`):

```ts
it("dokleja teksty kart do przykładów zagadnienia, bez duplikatów", () => {
  expect(generationExposureSources(subject, topic, { o1: ["Ex one."] }))
    .toEqual({ o1: ["Ex one.", "Card one."], o2: ["Card two."] });
});
it("przedmiot bez haka: kopia wejścia", () => {
  expect(generationExposureSources({}, topic, { o1: ["Ex one."] })).toEqual({ o1: ["Ex one."] });
});
it("zagadnienie bez tekstów kart i bez przykładów nie dostaje pustego wpisu", () => {
  const silent = { cardExposureTexts: () => [] };
  expect(generationExposureSources(silent, topic, {})).toEqual({});
});
it("nie mutuje wejścia", () => {
  const examples = { o1: ["Ex one."] };
  generationExposureSources(subject, topic, examples);
  expect(examples).toEqual({ o1: ["Ex one."] });
});
```

- [ ] **Step 6: Uruchom — FAIL**, potem **zaimplementuj** `generationExposureSources` (wynik: dla każdego zagadnienia tematu i każdego klucza `examples` — przykłady, potem teksty kart, bez duplikatów; klucze bez tekstów pominięte), potem **PASS**.

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/generation-exposure-sources.test.ts`

- [ ] **Step 7: Szybkie testy architektury lekcji**

Run: `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/architecture.test.ts packages/server/src/modules/module-boundaries.architecture.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/domain/lessons
git commit -m "Lekcje: zdania kart rozdziału jako źródło ujawnień — hak przedmiotu (#237)"
```

### Task 2: Podpięcie w generowaniu i dokumentacja

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`executeLessonGeneration` ok. l. 1732, 1830, 1862; `StageTopUpContext` ok. l. 1389; `stageTopUpRound` ok. l. 1470, 1498)
- Test: `tests/integration/lesson-chapter.test.ts` (describe „reguła twarda: rozwiązanie widoczne wcześniej”)
- Modify: `docs/architecture.md` §19.15, `docs/SPEC.md` (ok. l. 818)

**Interfaces:**
- Consumes: `generationExposureSources` (Task 1).
- Produces: `StageTopUpContext.generationSources: Readonly<Record<string, readonly string[]>>` — przykłady rundy rozszerzone o zdania kart; `ctx.examples` bez zmian (dla `stageDeficits`).

- [ ] **Step 1: Testy integracyjne** w describe „reguła twarda…” `lesson-chapter.test.ts` (wzór: istniejący test „pełna generacja: przykład karty zagadnienia A…”; karty z fake `generateLessonObjectives` to pierwsze dwa zdania sekcji materiału):

```ts
it("pełna generacja: tłumaczenie równe zdaniu z treści karty → poza szkicem, przykłady bez zdań kart", async () => {
  const { fakes, services } = await chapterWorld();
  const CARD = "There is a bed in my room.";
  routeLessonRound(fakes, async (input) => {
    const regular = await new FakeLlmProvider().generateLessonPool(input);
    return { ...regular, exercises: withTranslation(regular.exercises, { prompt: "W moim pokoju jest łóżko.", answer: CARD.slice(0, -1), focus: ["bed"] }) };
  });
  const { draft } = await generateChapter(services, `${CARD} I like my bed.`, "Pokój");
  expect(draft.exercises.some((exercise) => exercise.answer === CARD.slice(0, -1))).toBe(false);
  expect(draft.rejectedReasons).toEqual({ [EXPOSURE_REASON]: 1 });
  expect(Object.values(draft.examples).flat()).not.toContain(CARD);
});
it("generator dostaje zdania kart na liście do unikania", async () => {
  // jak test „generator dostaje zdania do unikania…”: pierwsze żądanie puli ma CARD w avoidSentences
});
it("dogenerowanie: zdanie karty działa także dla nowej partii", async () => { /* wzór: „dogenerowanie: nowa luka…” */ });
it("runda pod etap: zdanie karty odrzuca ćwiczenie rundy, braki etapów liczone bez zdań kart", async () => {
  /* wzór: „dogenerowanie z rundą pod etap…”; asercja: ćwiczenie rundy równe zdaniu karty odpada,
     a liczba żądań rundy jest taka sama jak bez haka (stageDeficits bez zdań kart) */
});
```

Asercje ostatnich trzech testów: odpowiedź równa zdaniu karty nie trafia do szkicu; `lessonRequests[...].avoidSentences` zawiera zdanie karty; `draft.examples` nie zawiera zdania karty.

- [ ] **Step 2: Uruchom — FAIL**

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/lesson-chapter.test.ts`
Expected: nowe testy FAIL, pozostałe PASS.

- [ ] **Step 3: Podepnij źródła** w `lesson-drafts.ts`:
  - `executeLessonGeneration`: `avoidSentencesFor({ examples: generationExposureSources(subject, activeTopic, mergeExamples(draftExamples, examples)), … })`; w obu `resolveGenerationLeaks` (`finalExamples` i reguła twarda) `existingExamples: generationExposureSources(subject, topic, draftExamples)`; `newExamples`, `finalExamples` i zapis `examples: { ...prevContext.examples, ...leaks.keptNewExamples }` bez zmian.
  - `StageTopUpContext`: nowe pole `generationSources`; wywołujący przekazuje `generationExposureSources(subject, topic, finalExamples)`. W `stageTopUpRound` `avoidSentencesFor` i `resolveGenerationLeaks.existingExamples` biorą `ctx.generationSources`; `deficitsOf` dalej `ctx.examples`.
  - Krytyk (`reviewPhase`, `examples: finalExamples`) bez zmian.

- [ ] **Step 4: Uruchom — PASS** (komenda jak w Step 2), potem pełne testy lekcji:

Run: `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/lesson-generation.test.ts tests/integration/lesson-chapter.test.ts tests/integration/lesson-review.test.ts tests/integration/lesson-exposure-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Dokumentacja**
  - `docs/architecture.md` §19.15: akapit — przy generowaniu (reguła twarda i zdania do unikania, także runda pod etap) źródłem ujawnień są też zdania z treści kart przedmiotu z hakiem `cardExposureTexts` (dziś rozdział); nie są zapisywane w `lesson_context.examples`; pokrycie, publikacja, edytor, raport i sesja liczą tylko przykłady (pokrycie nadal odwzorowuje scheduler).
  - `docs/SPEC.md` ok. l. 818: lista zdań do unikania — „przykłady kart, zdania z treści kart rozdziału i rozwiązania innych ćwiczeń”.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/modules/materials/lessons/lesson-drafts.ts tests/integration/lesson-chapter.test.ts docs/architecture.md docs/SPEC.md
git commit -m "Lekcje: zdania kart w regule ujawnień i zdaniach do unikania przy generowaniu (#237)"
```

### Task 3: Weryfikacja i PR

- [ ] **Step 1:** `pnpm typecheck` — PASS.
- [ ] **Step 2:** `pnpm test:unit` — PASS.
- [ ] **Step 3:** `pnpm test:integration` — PASS (ok. 5 min).
- [ ] **Step 4:** `pnpm build` — PASS.
- [ ] **Step 5:** `pnpm test:e2e:shards` — PASS (645 testów wg AGENTS.md; raportuj faktyczne liczby).
- [ ] **Step 6:** Trzech niezależnych krytyków na diffie gałęzi (memory: przegląd końcowy), poprawki.
- [ ] **Step 7:** Push gałęzi i PR do `main` (nie scalać). Opis po polsku: co zmieniono, czego świadomie nie zmieniono (§5 specu), wykonane sprawdzenia z liczbami, wpływ API → MCP → `SKILL.md`: brak (generowanie nie jest wystawione; `learning-overview` nie obejmuje lekcji). W PR także spec i oba plany (`docs/superpowers/specs/…`, `docs/superpowers/plans/…`).
