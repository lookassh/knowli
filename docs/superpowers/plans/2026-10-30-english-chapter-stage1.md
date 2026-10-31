# Etap 1: przedmiot „Angielski — rozdział” — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodzic tworzy z wklejonego tekstu rozdziału lekcję `english_chapter` (zagadnienia z materiału, zadania stukane, luka, tłumaczenie), a dziecko ją ćwiczy; do tego próba generowania na prawdziwym modelu.

**Architecture:** Nowy `SubjectModule` w `subjects/english-chapter/` plus kilka generycznych, opcjonalnych opcji `SubjectModule` w silniku lekcji (cytaty, reguły promptów, tożsamość z poleceniem, tekst ekspozycji, czyszczenie świeżej puli, języki w Kid DTO). Tworzenie przez wspólne `createMaterialLesson`; bez zmian w zachowaniu `school` i `english_grammar`.

**Tech Stack:** TypeScript strict, Zod, Drizzle/PostgreSQL, oRPC, React (Kid UI bez Mantine, panel rodzica Mantine 9), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-english-chapter-design.md` (sekcje 2, 4, 7, 8, 9, 10 — Etap 1 to sekcja 4 bez `sourceMaterialId` i bez `ttsForFeedback`).

## Global Constraints

- Silnik (`packages/server/src/domain/lessons/**` poza `subjects/`) nie importuje przedmiotów i nie sprawdza `subject.id` (pilnuje `architecture.test.ts`).
- `school` i `english_grammar` zachowują dotychczasowe zachowanie: nowe opcje są opcjonalne, a ich brak = dzisiejsza logika. Wyjątek: `school` jawnie ustawia `sourceQuotes: true` i przenosi tekst match/group/cloze do `prompts.typeRules`.
- Kid DTO bez klucza odpowiedzi; nowe pola Kid DTO opcjonalne (starszy klient działa).
- Teksty UI po polsku w `packages/contracts/src/messages.ts`; Kid UI bez surowych `<button>/<input>` poza wspólnymi komponentami; Mantine tylko w `apps/web/src/parent`.
- Limity: odpowiedź i warianty przedmiotu bez v3 ≤120 znaków; materiał ≤16 000 znaków (`MAX_SCHOOL_MATERIAL_LENGTH`); pula 20–160 (jak szkoła); zagadnienia 3–5 (reguła promptu), technicznie ≤8 jak dziś.
- Nigdy `npm install`; materiał próby z podręcznika nie trafia do repozytorium.
- Komunikacja i dokumentacja po polsku, kod po angielsku; commity kończą się linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Materiał z wielkimi literami, łącznikami i skrótami („Monday”, „T-shirt”, „It's”) — walidacja słownikowa ma je przyjąć (test w Task 5).
2. Model zwraca `sourceRefs: null` albo `kind: null` dla przedmiotu bez cytatów — potok nie może się wywrócić ani odrzucić ćwiczenia (test w Task 2).
3. Dwa ćwiczenia z tym samym angielskim zdaniem i różnym polskim bodźcem w jednej partii — oba zostają (test w Task 3).
4. Istniejące lekcje szkolne i gramatyczne po zmianach: prefiks `school.d`, wymóg cytatów szkoły, `targetKey` gramatyki = z `answer` (testy w Task 2 i 3).
5. Rodzic edytuje ćwiczenie rozdziału na słowo spoza materiału i publikuje — dozwolone (test w Task 7).

---

### Task 1: Normalizator angielski we wspólnym katalogu

**Files:**
- Move: `packages/server/src/domain/lessons/subjects/english-grammar/{normalizer.ts,normalizer.test.ts,contractions.ts}` → `packages/server/src/domain/lessons/subjects/english/`
- Modify: importy w `english-grammar/module.ts`, `english-grammar/validators.ts`, `domain/lessons/evaluate.test.ts`

**Interfaces:**
- Produces: `englishNormalizer`, `MAX_NORMALIZER_VARIANTS` z `subjects/english/normalizer.ts` (bez zmiany zachowania).

- [ ] **Step 1:** `git mv` trzech plików; popraw importy (w tym względne w `normalizer.ts`).
- [ ] **Step 2:** Run: `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons` — Expected: wszystkie testy PASS (653+).
- [ ] **Step 3:** Commit `Lekcje: normalizator angielski w subjects/english`.

### Task 2: Opcje przedmiotu dla promptów, cytatów i zagadnień

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts` (`SubjectModule`, `SubjectPromptProfile`, `DynamicObjectiveData`)
- Modify: `packages/server/src/ports/ai.ts` (`LlmPromptProfileInput`, `LessonObjectivesInput`)
- Modify: `packages/server/src/providers/openai/llm.ts` (bloki L186-209, L239-244, `lessonObjectivesSystemPrompt`, `lessonObjectivesJsonSchema`)
- Modify: `packages/server/src/providers/openai/lesson-pool-schema.ts` (gałęzie match/group/cloze L122-165)
- Modify: `packages/server/src/providers/lesson-assignments.ts` (kopiowanie `sourceRefs`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`buildPoolInput` L350-394, `buildDynamicTopicData` L431-470, `rawObjectiveSchema` L396, wywołanie objectives L1036-1069)
- Modify: `packages/server/src/domain/lessons/subjects/school/{module.ts,prompts.ts}`
- Modify: `packages/contracts/src/lessons.ts` (`DynamicObjectiveDtoSchema` L154: `kind` opcjonalne)
- Test: `packages/server/src/providers/openai/lesson-pool-schema.test.ts` (utwórz, jeśli brak), `packages/server/src/providers/openai/llm.test.ts` (lub istniejący test promptu), `packages/server/src/modules/materials/lessons/lesson-drafts.test.ts`

**Interfaces:**
- Produces:
  - `SubjectModule.sourceQuotes?: boolean` (brak = `false`); `groundingRequired` w `buildPoolInput` = `subject.sourceQuotes === true`.
  - `SubjectPromptProfile.typeRules?: Partial<Record<"lesson_match" | "lesson_group" | "lesson_cloze", string>>` i `objectivesRules?: string`; `LlmPromptProfileInput.typeRules?` (to samo), `LessonObjectivesInput.objectivesRules?: string`.
  - `DynamicObjectiveData.kind?: "words" | "frame"`; `buildDynamicTopicData(rawObjectives, subjectId: string, deckId, topicTitle, validate?)` — id `` `${subjectId}.d${deckId}.${slug}` ``.
  - `SubjectModule.materialSubjectTitle?: "parent" | "fixed"` (szkoła `"parent"`; używane w Task 6).

- [ ] **Step 1: Testy (failing)**
  - `lessonPoolJsonSchema` z `groundingRequired: false`: gałęzie `lesson_match`/`lesson_group`/`lesson_cloze` mają `sourceRefs` typu `["array","null"]`; z `true` — `minItems: 1` jak dziś.
  - `lessonSystemPrompt`: przy `groundingRequired: false` brak frazy „plus sourceRefs” i bloku „sourceRefs is REQUIRED”; tekst z `promptProfile.typeRules.lesson_match` występuje w prompcie; dla profilu szkoły prompt zawiera dotychczasowe zdania o parach z materiału („taken from the parent material”).
  - `lessonObjectivesSystemPrompt` zawiera `objectivesRules`, gdy podane; schemat zagadnień ma pole `kind` z `enum ["words","frame"]` i `null`.
  - `buildDynamicTopicData(raw, "english_chapter", "deck1", "T")` daje id `english_chapter.ddeck1.<slug>` i przenosi `kind`; dla `"school"` — `school.ddeck1.<slug>` (jak dziś); `kind: null` → brak pola.
  - `materializeGeneratedAssignments` dla rekordu z `sourceRefs: null` daje ćwiczenie bez pola `sourceRefs` (nie `null`).
- [ ] **Step 2:** Run testy zmienionych plików — Expected: FAIL.
- [ ] **Step 3: Implementacja.** Adapter składa bloki match/group/cloze z części strukturalnej (pola, limity, „code computes the answer”) i semantyki z `promptProfile.typeRules[type]` (brak reguły → sama część strukturalna). Wzmianki o `sourceRefs` w tych blokach tylko przy `groundingRequired`. Szkoła: `sourceQuotes: true`, `materialSubjectTitle: "parent"`, `typeRules` = dzisiejsze semantyczne zdania z `llm.ts` L186-209 przeniesione dosłownie. `objectivesRules` doklejane do `lessonObjectivesSystemPrompt` jako „Subject rules for objectives: …”; schemat zagadnień dostaje `kind` (`["string","null"]`, enum). `executeLessonGeneration` przekazuje `objectivesRules` i `subject.id` do `buildDynamicTopicData`. Kontrakt: `DynamicObjectiveDtoSchema.kind` opcjonalne.
- [ ] **Step 4:** Run testy + `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server packages/contracts` — Expected: PASS.
- [ ] **Step 5:** Commit `Lekcje: opcje przedmiotu dla cytatów, reguł promptu i rodzaju zagadnień`.

### Task 3: Haki silnika: tożsamość, tekst ekspozycji, czyszczenie świeżej puli

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts`
- Modify: `packages/server/src/domain/lessons/exercise-identity.ts` (`lessonExerciseStimulus` L14, `lessonExerciseIdentity` L64, `lessonExerciseStimulusRecord` L72)
- Modify: `packages/server/src/domain/lessons/pool-validation.ts` (dedup L854-866)
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (L625, L824, L884, L918, L1140-1184, L1204-1260, `LessonContext` L61-78)
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (L528; DTO szkicu)
- Modify: `packages/contracts/src/lessons.ts` (`LessonDraftDtoSchema` L308-329)
- Test: `exercise-identity.test.ts`, `pool-validation.test.ts`, `lesson-drafts.test.ts`, `packages/contracts/src/lessons.test.ts`

**Interfaces:**
- Produces:
  - `SubjectModule.instructionIsStimulus?: boolean`; `lessonExerciseIdentity(exercise, options?: { instructionIsStimulus?: boolean }): string` — przy `true` bodziec `lesson_choice`/`lesson_gap`/`lesson_order` to `JSON.stringify([normalizedInstruction, dotychczasowyBodziec])`; analogicznie `lessonExerciseStimulus`/`Record`.
  - `SubjectModule.exposureText?(draft: LessonExerciseDraft): string`; `lessonExerciseTargetKey(subject: SubjectModule, draft: LessonExerciseDraft): string` w `packages/server/src/domain/lessons/exposure-key.ts` = `computeTargetKey(subject.exposureText?.(draft) ?? draft.answer, subject.answerLocale)`; używane w `lesson-drafts.ts:884` i `lesson-api.ts:528`.
  - `SubjectModule.refineGeneratedPool?(drafts: readonly LessonExerciseDraft[], ctx: { material: string }): { kept: LessonExerciseDraft[]; rejected: { exercise: LessonExerciseDraft; reason: string }[] }`.
  - `LessonContext.rejectedReasons?: Record<string, number>`; `LessonDraftDtoSchema.rejectedReasons: z.record(z.string(), z.number().int().positive()).optional()`.

- [ ] **Step 1: Testy (failing)**
  - identity: dwa `lesson_gap` z tym samym `stem` i różnym `instructionPl` — różne identity przy `instructionIsStimulus: true`, równe bez opcji.
  - `validatePool` przedmiotu testowego z `instructionIsStimulus: true` nie odrzuca takiej pary jako duplikatu.
  - `lessonExerciseTargetKey`: bez `exposureText` = `computeTargetKey(answer, locale)` (grammar bez zmian); z `exposureText` = klucz z jego wyniku.
  - generacja (`lesson-drafts.test.ts`, funkcja czysta wydzielona z L1140-1184, np. `refineAndCount`): odrzucenia z `refineGeneratedPool` zwiększają `rejectedCount` i trafiają do `rejectedReasons` zliczone po `reason` (`{"słowo spoza materiału: raining": 2}`); przedmiot bez haka — bez zmian.
  - kontrakt: `rejectedReasons` opcjonalne, liczby dodatnie.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementacja.** `refineGeneratedPool` wołane tylko w `executeLessonGeneration` po `withoutRedundantAcceptedVariants`, przed `splitByPoolExtra`; nie w edycji rodzica ani publikacji. `rejectedReasons` sumowane z poprzednim kontekstem (jak `rejectedCount`), także w ścieżce porażki (L1216-1220). Tożsamość z opcją przekazywana z `subject` we wszystkich wywołaniach (L625, L824, L918, L1176, `pool-validation.ts:858`). `readLessonDeck`/DTO szkicu zwraca `rejectedReasons`.
- [ ] **Step 4:** Run testy obszaru `packages/server/src/domain/lessons`, `packages/server/src/modules/materials`, `packages/contracts` — Expected: PASS.
- [ ] **Step 5:** Commit `Lekcje: tożsamość z poleceniem, tekst ekspozycji i czyszczenie świeżej puli`.

### Task 4: Języki treści w Kid DTO i Kid UI

**Files:**
- Modify: `packages/contracts/src/kid.ts` (członkowie unii L251-348)
- Modify: `packages/server/src/domain/lessons/types.ts` (`openAnswerPromptLocale?: string`)
- Modify: `packages/server/src/modules/learning/lessons/lesson-materialize.ts` (choice L242-262, order L279-291, gap L292-296, match L342-365, group L366-394, cloze L395-437, open_answer L438-448)
- Modify: `packages/kid-ui/src/exercises/lesson/{LessonChoiceView,LessonOrderView,LessonMatchView,LessonGroupView,LessonClozeView,LessonGapView,LessonSentenceView}.tsx`, `packages/kid-ui/src/exercises/lesson/AssignmentPool.tsx`
- Test: `packages/contracts/src/kid-lesson.test.ts`, `lesson-materialize.test.ts`, `packages/kid-ui/src/exercises/lesson/lesson-views.test.tsx`

**Interfaces:**
- Produces: `contentLocale?: "pl-PL" | "en-GB"` w promptach `lesson_choice`, `lesson_order`, `lesson_gap`, `lesson_match`, `lesson_group`, `lesson_cloze`; `answerLocale?: "pl-PL" | "en-GB"` w `lesson_open_answer`; prop `lang?: string` w `AssignmentPool` (pula i sloty).

- [ ] **Step 1: Testy (failing)**
  - materialize: dla przedmiotu z `answerLocale: "en-GB"` prompty tych sześciu typów mają `contentLocale: "en-GB"`, szkoła — `"pl-PL"`; open_answer ma `answerLocale` z przedmiotu, a `promptLocale` z `openAnswerPromptLocale`, gdy ustawione (brak = reguła L441-443 bez zmian; gramatyka nadal bez `promptLocale`).
  - Kid UI (`lesson-views.test.tsx`): przy `contentLocale: "en-GB"` — `lang="en-GB"` na stem i przyciskach opcji wyboru, klockach, lewej kolumnie par (`kid-lesson-match-left`), elementach grup, segmentach tekstu cloze i słowach banku, zdaniu luki; prawa kolumna par i etykiety grup bez `lang`. Open answer z `promptLocale: "pl-PL"`, `answerLocale: "en-GB"` → źródło `lang="pl-PL"`, pole odpowiedzi `lang="en-GB"`. Bez nowych pól — dotychczasowe atrybuty (test regresji).
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementacja.** Serwer ustawia `contentLocale` z `subject.answerLocale`, gdy to `pl-PL`/`en-GB`. `LessonChoiceView` przekazuje `optionLang` do `AnswerGrid`. `AssignmentPool` dostaje `lang` i nakłada go na tekst elementów; widoki przekazują go tylko dla treści o pewnym języku. `LessonSentenceView`: `lang` pola = `answerLocale ?? dotychczasowa logika`.
- [ ] **Step 4:** Run `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui packages/contracts packages/server/src/modules/learning` — Expected: PASS.
- [ ] **Step 5:** Commit `Lekcje: język treści w zadaniach i atrybuty lang w Kid UI`.

### Task 5: Moduł `english_chapter`

**Files:**
- Create: `packages/server/src/domain/lessons/subjects/english-chapter/{module.ts,prompts.ts,validators.ts,lexicon.ts,exposure.ts}` i testy `module.test.ts`, `validators.test.ts`, `lexicon.test.ts`, `exposure.test.ts`
- Modify: `packages/server/src/domain/lessons/subjects/index.ts` (`PRODUCTION_SUBJECTS` + `englishChapterSubject`)

**Interfaces:**
- Consumes: opcje z Task 2–4; `englishNormalizer` (Task 1).
- Produces:
  - `englishChapterSubject: SubjectModule` — `id: "english_chapter"`, `titlePl: "Angielski — rozdział"`, `answerLocale: "en-GB"`, `promptLocale: "pl-PL"`, `exerciseTypes`: card, match, group, cloze, choice, order, gap, open_answer; `topics: []`; `poolDeduplication: "exercise"`; `poolMinimums: { guided: 3, productive: 3, independent: 2 }`; `sourceQuotes: false`; `instructionIsStimulus: true`; `openAnswerPromptLocale: "pl-PL"`; `materialSubjectTitle: "fixed"`; `ttsForAnswers: false`; `ttsForPrompts: false`; `normalizer: englishNormalizer`.
  - `lexicon.ts`: `FUNCTION_WORDS: ReadonlySet<string>` (≈60 słów: zaimki osobowe i dzierżawcze, a/an/the, am/is/are/was/were/be, do/does/don't/doesn't, can/can't, i'm/it's/he's/she's/you're/we're/they're/isn't/aren't/what's, and/or/but/not/no/yes, this/that/these/those, in/on/at/to/of/with/for, what/where/who/how, today, very); `materialLexicon(material: string): ReadonlySet<string>`; `checkElement(text: string, lexicon): { ok: true } | { ok: false; unknown: string }`.
  - `exposure.ts`: `chapterExposureText(draft: LessonExerciseDraft): string`.
  - `validators.ts`: `validateChapterExercise(ex, topic): string[]`, `refineChapterPool(drafts, { material })`.

- [ ] **Step 1: Testy (failing)**
  - `lexicon.test.ts`: materiał „Monday, T-shirt, It's raining. boots, I'm wearing a coat.” → `checkElement` ok dla `monday`, `T-shirt`, `shirt`, `rain` (odmiana), `boot`, `It is raining` (skrót), `a coat` (rodzajnik pominięty); nie ok dla `snowing` (unknown `snowing`) i dla samego `the` (brak słowa treści); `’` = `'`.
  - `validators.test.ts`: odrzuca `lesson_gap` bez luki i z dwiema lukami; `lesson_choice`/`lesson_gap`/`lesson_order` z `instructionPl` krótszym niż 12 znaków po trim albo równym (bez wielkości liter i końcowej kropki) jednemu z `GENERIC_CHAPTER_INSTRUCTIONS` = [„Wybierz słowo”, „Wybierz”, „Wpisz brakujące słowo”, „Wpisz słowo”, „Ułóż zdanie”, „Uzupełnij”, „Uzupełnij zdanie”] (eksport z `validators.ts`); pole `hint`; `lesson_order` z dwoma klockami „a”; odpowiedź 121 znaków. `refineChapterPool`: odrzuca wybór z opcją spoza materiału (`reason` = „słowo spoza materiału: snowing”), usuwa wariant tłumaczenia spoza materiału i zostawia ćwiczenie, zostawia ćwiczenie zgodne.
  - `exposure.test.ts`: choice `It's ___ today.` + poprawna opcja `sunny` → `it's sunny today` znormalizowane (trim, pojedyncze spacje, bez końcowego `.!?…`); gap analogicznie z `answer`; cloze — tekst z wstawionymi `gapAnswers`; order/open_answer — `answer` bez końcowej interpunkcji; match/group — `answer`.
  - `module.test.ts`: rejestr produkcyjny buduje się (`createProductionSubjectRegistry()` nie rzuca); `buildDynamicTopic` z `kind: "frame"` daje typy card, match, order, choice, cloze, gap, open_answer, a `words` (i brak `kind`) — card, match, group, choice, cloze, gap, open_answer; każdy cel przechodzi `validateSubject` (podpowiedzi dla każdej kategorii).
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementacja.**
  - Kategorie przedmiotu: `wrong_word` „Pomylone słowo”, `spelling` „Pisownia”; cele używają też bazowych `incomplete` (brakujące słowo) i `wrong_order` (szyk). Szablony podpowiedzi po polsku, krótkie, dla dziecka, np. `wrong_word`: „To inne słowo. Zajrzyj na kartę ze słówkami.”, `spelling`: „Sprawdź litery w tym słowie.”, `incomplete`: „Brakuje słowa. Dopisz je.”, `wrong_order`: „Słowa są w złej kolejności.”, `other`: „Spróbuj jeszcze raz.”.
  - Tokenizacja wg specyfikacji §4.4 (NFC, małe litery, apostrofy, łącznik → całość i części, skróty przez `englishNormalizer`, odmiana `-s/-es/-ies→-y/-ing/-ed` z podwojoną spółgłoską w obu kierunkach, pominięte wiodące a/an/the/to).
  - Prompty (`prompts.ts`, po angielsku dla modelu, treści dla dziecka po polsku): `generationRole` — autor ćwiczeń angielskiego dla 8-latka na słowach i ramach rozdziału, wyłącznie słowa z materiału; `gradingRole` — czy zdanie oddaje znaczenie polskiego zdania z polecenia, poprawny synonim co najwyżej `almost`; `almostDefinition` — literówka poza sprawdzanym słowem = almost bez kategorii, błąd sprawdzanego słowa = incorrect; `fieldRules` — bodziec po polsku w `instructionPl` (polskie zdanie + krótkie polecenie) dla choice/gap/order, `prompt` tłumaczenia = polskie zdanie, `hint` zawsze null, stem z dokładnie jedną luką `___`, `focus` = sprawdzane słowo, zdania bez przestawnych części, ≤120 znaków; `typeRules` — match: lewa strona angielskie słowo/zwrot/pytanie z materiału, prawa polskie znaczenie albo angielska odpowiedź; group: tylko gdy słowa zagadnienia dzielą się na 2–3 kategorie, etykiety po polsku; cloze: luki na słowa z rozdziału, pułapki z materiału; `objectivesRules` — 3–5 zagadnień, `kind` words/frame, każde słowo głównie w jednym zagadnieniu, karty: lista „słowo — polskie znaczenie” albo wzór ramy z 1–3 przykładami.
- [ ] **Step 4:** Run `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons` — Expected: PASS (w tym `architecture.test.ts`).
- [ ] **Step 5:** Commit `Lekcje: przedmiot „Angielski — rozdział”`.

### Task 6: Tworzenie lekcji z materiału i panel rodzica

**Files:**
- Modify: `packages/contracts/src/lessons.ts` (`SubjectCatalogDtoSchema` L94-109, nowy `MaterialLessonCommandSchema` obok L142)
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`createSchoolLesson` L200-264 → `createMaterialLesson`), `lesson-api.ts` (`lessonCatalog` L111), `modules/materials/index.ts`, `packages/server/src/index.ts`
- Modify: `apps/web/src/parent/orpc-contract.ts` (obok L372-375), `apps/web/src/orpc/parent-router.ts` (obok L353-355, mapa L544-552)
- Modify: `apps/web/src/parent/lessons/NewLessonForm.tsx`, `LessonEditor.tsx` (L1065), `packages/contracts/src/messages.ts` (`lessons` L713+)
- Test: `packages/contracts/src/lessons.test.ts`, `apps/web/src/orpc/parent-router.test.ts`, `apps/web/src/parent/lessons/new-lesson-form.test.tsx`, `packages/server/src/modules/materials/lessons/lesson-drafts.test.ts`

**Interfaces:**
- Produces:
  - `MaterialLessonCommandSchema` (`.strict()`): `deckId?`, `subjectId` (1–64), `topicTitlePl` (trim, 1–120), `material` (trim, 1–16000), `instruction?` (≤500), `poolSize?` (20–160), `clientRequestId`; typ `MaterialLessonCommand`.
  - `createMaterialLesson(services, cmd: { subjectId: string; subjectTitlePl?: string; topicTitlePl: string; material: string; instruction?: string; poolSize?: number; deckId?: string; clientRequestId: string }): Promise<{ runId: string; deckId: string }>`; `createSchoolLesson` = parse `SchoolLessonCommandSchema` + `createMaterialLesson({ subjectId: "school", ... })`; `createLessonFromMaterial(services, cmd: MaterialLessonCommand)` — odrzuca (`validation`) przedmiot bez `buildDynamicTopic` albo z `materialSubjectTitle: "parent"`.
  - Tytuł zestawu: `"<subjectTitlePl ?? subject.titlePl>: <topicTitlePl>"`, dla rozdziału „Angielski — rozdział: Unit 1” skracany do 120 znaków.
  - `SubjectCatalogDto.subjects[].creation: "catalog" | "material"` i `subjectTitleRequired: boolean` (z `buildDynamicTopic` i `materialSubjectTitle === "parent"`).
  - oRPC `lessons.createFromMaterial`: POST `/lessons/material`, 202, `{ runId, deckId }`, `sameOriginMiddleware`.

- [ ] **Step 1: Testy (failing)**
  - kontrakty: `MaterialLessonCommandSchema` przyjmuje materiał 16 000 znaków, odrzuca 16 001, dodatkowe pole i pusty `topicTitlePl`; katalog wymaga `creation`.
  - router: `lessons.createFromMaterial` woła `createLessonFromMaterial` z wejściem; trasa w tabeli tras (`parent-router.test.ts` ok. L351).
  - formularz (`new-lesson-form.test.tsx`): przedmiot `{id: "english_chapter", creation: "material", subjectTitleRequired: false}` — `buildCommand` zwraca `{ kind: "material", command: { subjectId: "english_chapter", topicTitlePl, material, ... } }` bez nazwy przedmiotu; szkoła (`subjectTitleRequired: true`) — jak dziś `kind: "school"`; markup rozdziału nie ma pola `school-subject-name`, ma pole tytułu z etykietą „Rozdział (np. Unit 1)” i licznik `/16000`.
  - `createLessonFromMaterial` dla `english_grammar` → `validation`.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3: Implementacja.** Formularz wybiera ścieżkę po `creation`/`subjectTitleRequired` zamiast `topics.length === 0`; nowy wariant `PendingLesson` `{ kind: "material" }` i wywołanie `parentClient.lessons.createFromMaterial`. Komunikaty: `chapterTopicLabel` „Rozdział (np. Unit 1)”, `chapterMaterialHint` „Wklej słowa, zwroty i zdania z rozdziału (np. z NotebookLM).”. `LessonEditor` pod `rejected-count` pokazuje listę `rejectedReasons` (do 5 najczęstszych, „{reason} ×{n}”, `data-testid="rejected-reasons"`) i przy zagadnieniu znaczek rodzaju („Słowa” / „Rama zdaniowa”), gdy `kind` jest ustawione.
- [ ] **Step 4:** Run testy plików + `corepack pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit `Lekcje: tworzenie lekcji „Angielski — rozdział” z materiału`.

### Task 7: Fałszywy provider i testy integracyjne rozdziału

**Files:**
- Modify: `packages/server/src/providers/fake.ts` (L109-229, L266, L296-310)
- Create: `tests/integration/lesson-chapter.test.ts`
- Modify: `tests/integration-buckets.ts` (najlżejszy kosz)

**Interfaces:**
- Consumes: `createLessonFromMaterial`, `executeLessonGeneration`, `readLessonDeck`, `publishLessonDraft`, `startSession`/`nextTask`/`submitAttempt`, `fakeGeneration()` (`tests/integration/fakes.ts:39`), `createSubjectRegistry([englishChapterSubject])`.

- [ ] **Step 1: Fałszywy provider.** Dla `input.subjectId === "english_chapter"`: bez `sourceRefs`; `instructionPl` = unikalne polskie zdanie-bodziec z numerem ćwiczenia; stem choice/gap z jedną luką i słowem z materiału (`materialWord`); opcje choice ze słów materiału; `hint` brak; open_answer z odpowiedzią ze słów materiału i `focus`; zagadnienia z `kind: "words"` (pierwsze) i `"frame"` (kolejne, gdy materiał ma nagłówki `Zagadnienie N:`).
- [ ] **Step 2: Testy integracyjne** (`lesson-chapter.test.ts`, wzór: `tests/integration/lesson-generation.test.ts:933-1118`):
  - generacja: zagadnienia z prefiksem `english_chapter.d`, `kind` zapisane w `dynamicTopic`, ćwiczenia bez `sourceRefs`, payload v2, szkic publikowalny (pokrycie 3/3/2).
  - odrzucenie: `llm.queueLesson` z wyborem zawierającym słowo spoza materiału → `rejectedCount` ≥1 i `rejectedReasons["słowo spoza materiału: <słowo>"]`; wariant tłumaczenia spoza materiału usunięty, ćwiczenie zostaje.
  - rodzic: edycja wariantu luki na słowo spoza materiału i publikacja przechodzą.
  - samodzielność: po odpowiedzi na wybór zdania S zadanie luki z tym samym wypełnionym zdaniem ma `answerPreviouslyExposed`/`recent_exposure`; luka w innym zdaniu z tym samym słowem — nie.
  - Kid DTO: prompt wyboru ma `contentLocale: "en-GB"`, tłumaczenie `promptLocale: "pl-PL"` i `answerLocale: "en-GB"`; w kartkówce luka zachowuje `instructionPl` z bodźcem.
  - regresja szkoły: `createSchoolLesson` dalej tworzy cele `school.d…` z `sourceRefs`.
- [ ] **Step 3:** Run: `corepack pnpm exec vitest run --config vitest.integration.config.ts tests/integration/lesson-chapter.test.ts tests/integration/lesson-generation.test.ts` — Expected: PASS. Dopisz plik do najlżejszego kosza `INTEGRATION_BUCKETS`; `corepack pnpm exec vitest run --config vitest.unit.config.ts tests/integration-buckets.test.ts` — PASS.
- [ ] **Step 4:** Commit `Lekcje: testy integracyjne lekcji „Angielski — rozdział”`.

### Task 8: E2E formularza rodzica (mocked)

**Files:**
- Modify: `tests/e2e/parent-lessons-layout.spec.ts` (katalog L30, `openNewLesson` L36-58, test L84-100)

- [ ] **Step 1:** Dodaj do katalogu `english_chapter` (`creation: "material"`, `subjectTitleRequired: false`) i test: wybór „Angielski — rozdział”, wpisanie tytułu i materiału, „Utwórz” → POST `/lessons/material` z `subjectId: "english_chapter"`, bez pola nazwy przedmiotu; istniejące testy szkoły dalej przechodzą (`/lessons/school`).
- [ ] **Step 2:** Run: `$env:UMIEM_E2E_WEB_MODE='dev'; corepack pnpm exec playwright test tests/e2e/parent-lessons-layout.spec.ts` — Expected: PASS.
- [ ] **Step 3:** Commit `E2E: formularz lekcji „Angielski — rozdział”`.

### Task 9: Próba generowania na prawdziwym modelu

**Files:**
- Create: `vitest.probe.config.ts` (jak integracyjny, `include: ["tests/probes/**/*.probe.test.ts"]`), `tests/probes/chapter-generation.probe.test.ts`
- Modify: `package.json` (`"probe:chapter": "vitest run --config vitest.probe.config.ts"`)

- [ ] **Step 1:** Próba: czyta `.env` (wzór `scripts/evaluate-school-grader.mts:68-84`) i ścieżkę materiału z `UMIEM_PROBE_MATERIAL` (plik poza repozytorium; brak → `skip`), buduje usługi z `createGenerationDepsFromEnv(process.env)` (prawdziwy LLM) i rejestrem `[englishChapterSubject]`, woła `createLessonFromMaterial` + `executeLessonGeneration`, a potem wypisuje: liczbę i rodzaje zagadnień, liczbę ćwiczeń per zagadnienie i etap, `rejectedCount`, `rejectedReasons`, braki pokrycia (`coverage`) i czy szkic jest publikowalny. Bez asercji jakości — tylko raport.
- [ ] **Step 2:** Run: `$env:UMIEM_PROBE_MATERIAL='<scratchpad>/probe/unit1-material.txt'; corepack pnpm probe:chapter` — zapisz wynik do opisu PR. Gdy minima nie są spełnione albo odrzuceń jest >30%, popraw prompty/`FUNCTION_WORDS`/reguły odmiany w Task 5 i powtórz (najwyżej 3 iteracje); każdą zmianę opisz w PR.
- [ ] **Step 3:** Commit `Lekcje: próba generowania rozdziału na prawdziwym modelu`.

### Task 10: Dokumentacja

**Files:**
- Modify: `docs/SPEC.md` (nowa `## 37. Lekcja „Angielski — rozdział” (2026-10-30)` po §36), `docs/architecture.md` (§19: nowe opcje `SubjectModule`; §22: temat dynamiczny także poza szkołą, `createMaterialLesson`), `docs/superpowers/specs/2026-10-30-english-chapter-design.md` (§4.1 kategorie: `wrong_word`, `spelling` + bazowe `incomplete`, `wrong_order`; §4.6: `MaterialLessonCommand` i `lessons.createFromMaterial` zamiast `ChapterLessonCommand`; §10: stan Etapu 1)

- [ ] **Step 1:** Opisz stan kodu Etapu 1 i to, co niezweryfikowane (pilotaż z dzieckiem, urządzenie, wynik próby).
- [ ] **Step 2:** Commit `Dokumentacja: lekcja „Angielski — rozdział” (Etap 1)`.

### Task 11: Weryfikacja całości i PR

- [ ] **Step 1:** Run kolejno: `corepack pnpm typecheck`, `corepack pnpm test:unit`, `corepack pnpm test:integration`, `corepack pnpm test:e2e:shards`, `corepack pnpm build` — Expected: wszystko PASS (raportuj faktyczne wyniki).
- [ ] **Step 2:** Niezależny przegląd kilkoma subagentami (architektura/silnik, dane i ujawnienia, produkt i testy) na diffie gałęzi; popraw potwierdzone uwagi i powtórz testy dotkniętych obszarów.
- [ ] **Step 3:** Push `claude/english-chapter-1-lesson` i PR do `main` z opisem: zakres, wpływ API → MCP → skill (brak: raport Hermesa filtruje `kind='vocabulary'`), wyniki testów, wynik próby, niezweryfikowane.
