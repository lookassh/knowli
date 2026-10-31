# Ton TTS — etap B (ton per ćwiczenie i karta, odsłuch w panelu) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generator lekcji szkolnych wybiera ton (`cheerful`/`curious`/`gentle`/`mysterious`) dla pytań i kart, rodzic widzi i zmienia go w edytorze, odsłuchuje nagranie i może zlecić ponowne.

**Architecture:** Opcjonalne pole `voiceTone` w kontraktach ćwiczenia i karty, przenoszone przez wszystkie mapery; reguła szeptu w domenie (`lessonPromptStyle`); rekonsyliacja przekazuje ton do profilu z etapu A. Ponowne nagranie = nowa generacja tego samego fingerprintu (spec §2.4) przez dwie nowe procedury oRPC rodzica.

**Tech Stack:** TypeScript strict, Zod, oRPC + TanStack Query, Mantine 9 (panel rodzica), Drizzle/PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-tts-voice-style-design.md` (§2.1, §2.4, §4–8).

**Warunek startu:** etap A scalony do `main` (plan `2026-10-30-tts-voice-style-stage-a.md`); gałąź zsynchronizowana z bazą.

## Global Constraints

- `LessonVoiceToneSchema = z.enum(["cheerful", "curious", "gentle", "mysterious"])`; brak pola = styl roli; enum bez `default`.
- Ton nie trafia do Kid DTO, `SubjectCatalogDtoSchema`, `payload_version`, `objectiveImpacted`, `buildObjectiveCriteria`.
- Wynik LLM: nieznany ton usuwany przed ścisłą walidacją. Wejście rodzica: nieznany ton = błąd kontraktu. Przedmiot bez `ttsForPrompts`: `voiceTone` = błąd walidacji.
- Reguła szeptu: `mysterious` przy < 2 zdaniach tekstu nagrania → `curious`; zdanie = fragment zakończony `.`, `!`, `?`, `…` albo końcem tekstu, po normalizacji odstępów.
- Zdania tonów dokładnie z tabeli spec §4.3; ≤ 120 znaków.
- Schemat strict: `voiceTone: { type: ["null", "string"], enum: [null, "cheerful", "curious", "gentle", "mysterious"] }`, pole w `required`.
- Ponowne nagranie tylko w szkicu (opublikowana wersja → `AppError("immutable")`); dla stanu `ready` i `failed`; nowa generacja obowiązuje we wszystkich wersjach o tym fingerprincie.
- Teksty panelu po polsku w `messages`; Mantine tylko w `apps/web/src/parent`.
- Nie wypychaj do `main`, nie scalaj PR.

## Review Focus

- Rodzic poprawia literówkę w ćwiczeniu z tonem od LLM: ton musi przetrwać zapis (Task 6, test round-trip edytora; Task 4, test integracyjny patcha).
- Zmiana samego tonu w opublikowanej-i-skopiowanej lekcji: brak nowej `skill_version`, postęp dziecka nietknięty (Task 4).
- „Nagraj ponownie” kliknięte dwa razy szybko: nie powstają dwie oczekujące generacje (Task 5, test idempotencji pending).
- Karta-ciekawostka z jednym zdaniem i tonem `mysterious`: nagranie bez szeptu (`curious`) (Task 2 i Task 4).
- Gramatyka (`ttsForPrompts: false`): schemat generatora bez pola, walidacja odrzuca pole od rodzica (Task 3, Task 4).

---

### Task 1: Kontrakty i typy domeny

**Files:**
- Modify: `packages/contracts/src/lessons.ts` (`LessonVoiceToneSchema`, `LessonExerciseInputSchema`, `DynamicObjectiveDtoSchema.cards[]`), `packages/contracts/src/index.ts` (eksport)
- Modify: `packages/server/src/domain/lessons/types.ts` (`LessonExerciseDraft`, `LearningObjective.cards[]`, `DynamicObjectiveData.cards[]`)
- Test: `packages/contracts/src/lessons.test.ts`

**Interfaces:**
- Produces: `LessonVoiceToneSchema`, `type LessonVoiceTone`; `voiceTone?: LessonVoiceTone` w `LessonExerciseInput`, karcie `DynamicObjectiveDto`, `LessonExerciseDraft`, kartach `LearningObjective` i `DynamicObjectiveData`.

- [ ] **Step 1: Testy kontraktów:** ćwiczenie i karta z `voiceTone: "curious"` przechodzą; bez pola przechodzą; `voiceTone: "loud"` odrzucone; `SubjectCatalogDtoSchema` bez zmian — karta katalogu z `voiceTone` odrzucona przez jej `.strict()` (katalog statycznych tematów nie dostaje tonu).
- [ ] **Step 2:** `pnpm vitest run packages/contracts/src/lessons.test.ts` → FAIL.
- [ ] **Step 3:** Pola wg Interfaces z krótkim komentarzem (ton lektora; brak = styl domyślny; spec §4.1).
- [ ] **Step 4:** test → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Kontrakty lekcji: opcjonalny ton lektora ćwiczenia i karty`.

### Task 2: Reguła szeptu i zdania tonów

**Files:**
- Modify: `packages/server/src/domain/tts-style.ts`, `packages/server/src/providers/tts-style-profile.ts`
- Test: `packages/server/src/domain/tts-style.test.ts` (nowy), `packages/server/src/providers/tts-style-profile.test.ts`

**Interfaces:**
- Consumes: `LessonVoiceTone` (Task 1), `TtsRoleStyle`, `STYLE_SENTENCES_PL` (etap A).
- Produces: `export type TtsStyle = TtsRoleStyle | LessonVoiceTone`; `export function lessonPromptStyle(role: "lesson_question" | "lesson_card", tone: LessonVoiceTone | undefined, text: string): TtsStyle`; `export function sentenceCount(text: string): number`.

- [ ] **Step 1: Testy domeny:**
  - `lessonPromptStyle("lesson_card", undefined, "A.")` === `"lesson_card"`;
  - `("lesson_question", "cheerful", "A.")` === `"cheerful"`;
  - `("lesson_card", "mysterious", "Czy wiesz, że sowy widzą w nocy?")` === `"curious"`;
  - `("lesson_card", "mysterious", "Czy wiesz, że…? Sowy widzą w nocy.")` === `"mysterious"`;
  - `sentenceCount("  Ala ma kota.  Kot ma Alę ")` === 2; `sentenceCount("")` === 0; `sentenceCount("Ile? Dwa!")` === 2.
- [ ] **Step 2: Testy profilu:** dla każdego tonu `ttsRequestInstructions(tts, "pl-PL", tone)` kończy się zdaniem z spec §4.3; snapshot; długość ≤ 120.
- [ ] **Step 3:** → FAIL; implementacja (`STYLE_SENTENCES_PL` rozszerzone o tony); → PASS.
- [ ] **Step 4: Commit** `TTS: tony lekcji i reguła szeptu`.

### Task 3: Generator — schemat, prompty, materializatory, fake

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (`LessonPoolInput.voiceTones?: boolean`, `LessonObjectivesInput.voiceTones?: boolean`)
- Modify: `packages/server/src/providers/openai/lesson-pool-schema.ts` (gałąź ogólna, `keywordsExerciseSchema`, `matchExerciseSchema`, `groupExerciseSchema`, `clozeExerciseSchema`; bez `calculationExerciseSchema`)
- Modify: `packages/server/src/providers/openai/llm.ts` (`lessonSystemPrompt`, `lessonObjectivesJsonSchema`, `lessonObjectivesSystemPrompt`)
- Modify: `packages/server/src/providers/lesson-assignments.ts`, `packages/server/src/providers/lesson-keywords.ts` (przenoszą `voiceTone`)
- Modify: `packages/server/src/providers/fake.ts` (fake LLM lekcji: pierwsze ćwiczenie `voiceTone: "curious"`, pierwsza karta `voiceTone: "cheerful"`, gdy `voiceTones`)
- Modify: wywołujący budujący `LessonPoolInput`/`LessonObjectivesInput` w `modules/materials/lessons/lesson-drafts.ts` — `voiceTones: subject.ttsForPrompts === true`
- Test: `providers/openai/lesson-pool-schema.test.ts`, `providers/openai/llm.test.ts`, `providers/lesson-assignments.test.ts`, `providers/lesson-keywords.test.ts`

**Interfaces:**
- Consumes: `LessonVoiceToneSchema.options` (Task 1).
- Produces: `voiceTones` w portach; surowe ćwiczenia/karty z generatora mogą nieść `voiceTone: string | null`.

- [ ] **Step 1: Testy:**
  - `lessonPoolJsonSchema({...input, voiceTones: true})`: każda gałąź poza kalkulacją ma `voiceTone` w `properties` i `required` z enumem z Global Constraints; przy `voiceTones` falsy — brak pola.
  - `lessonObjectivesJsonSchema` (przez eksport testowy lub żądanie w `llm.test.ts`): karta ma `voiceTone` w `required` tylko przy `voiceTones`.
  - Prompt puli i zagadnień przy `voiceTones` zawiera regułę ze spec §4.3 (asercja na fragment `"voiceTone: choose only when it clearly fits"`), bez — nie zawiera.
  - Materializatory: `voiceTone: "gentle"` z wejścia obecne w wyniku; `null` pominięte.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/providers` → FAIL.
- [ ] **Step 3:** Implementacja wg Files (helper `voiceToneProperty()` w `lesson-pool-schema.ts`, użyty też w `llm.ts`).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `Generator lekcji: ton lektora w schemacie i promptach`.

### Task 4: Szkic serwera — przenoszenie, sanityzacja, walidacja, kryteria

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`v3FieldsOf`/`toExerciseDraft`, `buildLessonPayload`, `rawObjectiveSchema`, `buildDynamicTopicData`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (`exerciseDtoFromPayload`, DTO szkicu kart ~l.276–280 i ~l.131, patch tematu ~l.641–646, `objectiveImpacted` — bez zmian logiki, tylko test)
- Modify: `packages/server/src/domain/lessons/subjects/school/module.ts` (`buildDynamicTopic` przenosi `voiceTone` kart)
- Modify: `packages/server/src/domain/lessons/pool-validation.ts` (`validateLessonExercise`: `voiceTone` przy przedmiocie bez `ttsForPrompts` → błąd, wzór `v3FieldsPresent`)
- Test: `packages/server/src/domain/lessons/pool-validation.test.ts`, `tests/integration/lesson-parent-api.test.ts`, `tests/integration/lesson-generation.test.ts`

**Interfaces:**
- Consumes: Task 1 typy; Task 3 surowe pola.
- Produces: `voiceTone` obecny w payloadzie rewizji, `lesson_context.dynamicTopic` kart, DTO szkicu i `resolveLessonTopic(...).topic` kart.

- [ ] **Step 1: Testy jednostkowe:** `toExerciseDraft({...raw, voiceTone: "loud"})` → brak `voiceTone`; `"gentle"` zachowane; `null` → brak; `buildDynamicTopicData` analogicznie dla kart; `validateLessonExercise` gramatyki z `voiceTone` → błąd; szkoły → OK.
- [ ] **Step 2: Testy integracyjne:**
  - `lesson-generation`: generacja z fake (Task 3) → DTO szkicu ma `voiceTone: "curious"` w pierwszym ćwiczeniu i `"cheerful"` w pierwszej karcie.
  - `lesson-parent-api`: patch zmieniający tylko `stem` z zachowanym `voiceTone` → DTO po zapisie nadal ma ton; patch tematu z `voiceTone` karty → zapisany w `lesson_context`; zmiana samego tonu po publikacji i kopii szkicu → po publikacji brak nowej `skill_version` (porównaj liczbę wierszy `skill_versions` celu) i postęp dziecka bez zmian.
- [ ] **Step 3:** → FAIL; implementacja; → PASS.
- [ ] **Step 4: Commit** `Szkic lekcji: ton lektora przetrwa generację, edycję i publikację`.

### Task 5: Rekonsyliacja z tonem, stan nagrania w DTO, ponowne nagranie

**Files:**
- Modify: `packages/server/src/modules/materials/media-reconciliation.ts` (pytanie: `lessonPromptStyle("lesson_question", payload.voiceTone, question)`; karta: `lessonPromptStyle("lesson_card", card.voiceTone, text)`)
- Create: `packages/server/src/modules/materials/lessons/lesson-prompt-audio.ts`
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (DTO szkicu: `promptAudio` ćwiczeń i `cardAudio`), `packages/contracts/src/lessons.ts` (`LessonPromptAudioDtoSchema`, pola DTO szkicu), `modules/materials/index.ts`, `src/index.ts`
- Modify: `apps/web/src/parent/orpc-contract.ts` (`lessonDrafts.regeneratePromptAudio`, `lessonDrafts.regenerateCardAudio`), `apps/web/src/orpc/parent-router.ts`
- Test: `tests/integration/lesson-question-audio.test.ts`, `tests/integration/lesson-card-audio.test.ts`

**Interfaces:**
- Consumes: `lessonPromptStyle` (Task 2).
- Produces:
  - `LessonPromptAudioDtoSchema = z.object({ state: z.enum(["pending", "ready", "failed"]), assetId: UuidSchema.optional() }).strict()`;
  - `LessonExerciseDraftDtoSchema.promptAudio?: LessonPromptAudioDto`; `LessonDraftDtoSchema.cardAudio: Array<{ objectiveId: string; cardIndex: number; audio: LessonPromptAudioDto }>`;
  - `regenerateLessonPromptAudio(services, { lessonDraftId: string; itemRevisionId: string }): Promise<{ assetId: string }>`;
  - `regenerateLessonCardAudio(services, { lessonDraftId: string; objectiveId: string; cardIndex: number }): Promise<{ assetId: string }>`;
  - oRPC: `POST /lesson-drafts/{lessonDraftId}/prompt-audio/regenerate` (202), `POST /lesson-drafts/{lessonDraftId}/card-audio/regenerate` (202), `sameOriginMiddleware`.

- [ ] **Step 1: Testy integracyjne:**
  - ćwiczenie z `voiceTone: "cheerful"` → `instructions` `prompt_audio` kończy się zdaniem `cheerful`; karta jednozdaniowa z `mysterious` → zdaniem `curious`; zmiana tonu w szkicu → nowy fingerprint, stary gotowy zasób nietknięty.
  - DTO szkicu: `promptAudio.state` = stan najnowszej generacji o `expected_fingerprint` wiersza `revision_assets`/`lesson_card_assets`; `assetId` tylko dla `ready`; brak wiersza → brak pola / brak wpisu.
  - `regenerateLessonPromptAudio` na gotowym → nowa generacja pending (ten sam fingerprint, `generation_number` + 1); drugie wywołanie przy pending → zwraca istniejący `assetId` bez nowego wiersza; w wersji opublikowanej → `immutable`; nieznana rewizja → `not_found`. Analogicznie `regenerateLessonCardAudio`.
  - Po wykonaniu nowej generacji materializacja zadania i `loadLessonCardAudio` zwracają nowy `assetId`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementacja: przypadki użycia w transakcji z `select … for update` wersji (wzór `regenerateRevisionAsset`), fingerprint i metadane z oczekiwanego wiersza i najnowszego zasobu tego fingerprintu (bez przeliczania z env), `pg_advisory_xact_lock(hashtext(fingerprint))`, pending → zwróć istniejący. DTO: jedno zapytanie na szkic (join po `expected_fingerprint`, najnowsza generacja).
- [ ] **Step 4:** → PASS; `pnpm vitest run apps/web/src/orpc` (testy routera, jeśli są) → PASS.
- [ ] **Step 5: Commit** `Lekcje: ton w nagraniach, stan nagrania w szkicu i ponowne nagranie`.

### Task 6: Panel rodzica — „Ton lektora”, odsłuch, „Nagraj ponownie”

**Files:**
- Modify: `apps/web/src/parent/lessons/lesson-editor-state.ts` (`EditableDynamicObjective`, `editableFromExercise`, `exerciseToInput`, `lessonExerciseChanged`, `toLessonDraftPatch`)
- Modify: `apps/web/src/parent/lessons/LessonExerciseCard.tsx`, `apps/web/src/parent/lessons/LessonEditor.tsx` (edytor karty)
- Create: `apps/web/src/parent/lessons/PromptAudioControls.tsx` (odsłuch + „Nagraj ponownie”, wspólny dla ćwiczenia i karty)
- Modify: `packages/contracts/src/messages.ts` (sekcja lekcji rodzica)
- Test: `apps/web/src/parent/lessons/lesson-editor-state.test.ts`

**Interfaces:**
- Consumes: DTO i procedury z Task 5; `LessonVoiceToneSchema.options`.
- Produces: komunikaty `voiceToneLabel: "Ton lektora"`, `voiceToneDefault: "Domyślny"`, `voiceToneCheerful: "Radośnie"`, `voiceToneCurious: "Z ciekawością"`, `voiceToneGentle: "Łagodnie"`, `voiceToneMysterious: "Tajemniczo"`, `voiceToneHint: "Ton działa, gdy pytanie ma nagranie."`, `promptAudioListen: "Posłuchaj"`, `promptAudioRegenerate: "Nagraj ponownie"`, `promptAudioPending: "Nagrywanie…"`, `promptAudioFailed: "Nie udało się nagrać."`.

- [ ] **Step 1: Testy stanu edytora:** round-trip DTO → forma → `toLessonDraftPatch` zachowuje `voiceTone` ćwiczenia i karty; wybór „Domyślny” (wartość pusta) usuwa pole z patcha; zmiana tylko tonu → `lessonExerciseChanged` === true.
- [ ] **Step 2:** `pnpm vitest run apps/web/src/parent/lessons/lesson-editor-state.test.ts` → FAIL; implementacja stanu; → PASS.
- [ ] **Step 3:** UI: Mantine `Select` (`clearable` niepotrzebne — opcja „Domyślny” = `""`) z `description` = `voiceToneHint`; widoczny dla przedmiotów z nagraniami pytań i typów poza `lesson_calculation`, dla wszystkich kart. `PromptAudioControls`: `ready` → przycisk „Posłuchaj” (`new Audio(mediaUrl)`, zatrzymanie przy odmontowaniu) i „Nagraj ponownie”; `failed` → komunikat + „Nagraj ponownie”; `pending` → „Nagrywanie…”; mutacja przez `@orpc/tanstack-query`, po sukcesie `invalidateQueries` szkicu. Tylko w szkicu.
- [ ] **Step 4:** `pnpm vitest run tests/parent-mantine-scope.test.ts` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `Panel rodzica: ton lektora, odsłuch i ponowne nagranie pytań i kart`.

### Task 7: Próbki tonów, dokumentacja, weryfikacja, PR

**Files:**
- Modify: `scripts/sample-tts-styles.mts` (po jednej próbce tonu; `mysterious` z 1 i 2 zdaniami)
- Modify: `.kiro/specs/school-subjects/design.md` (§3 payload v3: pole `voiceTone`; §11–12: odsyłacz), `docs/architecture.md` jeśli opisuje DTO szkicu lekcji

- [ ] **Step 1:** Skrypt i dokumentacja; commit `TTS: próbki tonów i dokumentacja`.
- [ ] **Step 2:** `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e:shards` → PASS.
- [ ] **Step 3:** Odsłuch właściciela (próbki tonów) i ewentualne poprawki zdań + snapshot.
- [ ] **Step 4:** Push, PR do `main`: zakres B, API → MCP → skill: brak wpływu (nowe procedury tylko w panelu rodzica, spec §6), wdrożenie bez migracji, sprawdzenia, brak E2E panelu (jeśli nie dodano) i brak odbioru na urządzeniu. Nie scalaj.
