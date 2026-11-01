# Zdania o zainteresowaniach dziecka — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rodzic zapisuje zainteresowania w profilu dziecka i może je wstawić jako tematy zdań przy tworzeniu lekcji gramatyki; generator układa część zdań wokół tych tematów.

**Architecture:** Lista w `child_profiles.interests` (obszar `family/`). Polecenie `lessons.create` niesie migawkę tematów (bez `childId`), zapisywaną w `lesson_context` i `generation_runs.input`. Przedmiot włącza funkcję regułą `interestsRule` w profilu promptów; adapter LLM wstawia regułę do promptu systemowego, a tematy jako ogrodzony blok danych do wiadomości użytkownika.

**Tech Stack:** TypeScript strict, Zod 4 (`packages/contracts`), Drizzle + ręczna migracja SQL, Next.js + Mantine 9 (panel rodzica), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-child-interests-sentence-themes-design.md` (zaakceptowany przez właściciela 2026-11-01, łącznie z retencją tematów po usunięciu profilu).

## Global Constraints

- `MAX_CHILD_INTERESTS = 5`, `MAX_CHILD_INTEREST_LENGTH = 40` (w `packages/contracts/src/limits.ts`).
- Element: NFC, `trim`, zwinięcie białych znaków do jednej spacji; regex `/^[\p{L}\p{N}][\p{L}\p{N} '’&.-]*$/u`; duplikaty bez względu na wielkość liter = błąd.
- Tylko przedmiot `english_grammar` ma `interestsRule`; `school`, `english_chapter`, słówki — bez tematów.
- Do modelu nigdy: imię, rok urodzenia, identyfikatory dziecka. Tematy tylko w wiadomości `user` w bloku `--- SENTENCE THEMES (begin) ---` / `--- SENTENCE THEMES (end) ---`, po `PARENT NOTE`, jeden temat na wiersz.
- Bez tematów system i user prompt są bajt w bajt jak dziś.
- Kod, identyfikatory, prompty modelu — po angielsku; teksty UI, komentarze dokumentacyjne, commity — po polsku, jak w repo. Teksty UI wyłącznie w `packages/contracts/src/messages.ts`.
- `learning-overview`, MCP, `SKILL.md`, Kid DTO — bez zmian.
- Commity kończą się linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Po zmianie w `packages/server/src/modules/` uruchom `pnpm vitest run packages/server/src/modules/module-boundaries.architecture.test.ts`.

## Review Focus

1. Ponowne zapisanie profilu bez zmiany listy (inna kolejność, te same elementy) — `childPatch` nie może wysyłać `interests`, gdy lista jest identyczna element po elemencie; zmiana kolejności to zmiana (test w Task 6).
2. Rodzic wkleja „piłka  nożna, Piłka nożna” w `TagsInput` — formularz normalizuje i odrzuca duplikat przed wysłaniem, zamiast dostać `validation` z serwera (test w Task 6 i Task 7).
3. Rodzic zmienia przedmiot w formularzu lekcji z gramatyki na rozdział po wstawieniu tematów — polecenie nie może nieść `interests` (test w Task 7).
4. Patch szkicu `interests: []` dla lekcji szkolnej lub rozdziału — `validation`, kontekst bez zmian (test w Task 5).
5. Profil usunięty po utworzeniu lekcji — dogenerowanie dalej wysyła migawkę, a patch `[]` ją usuwa (test w Task 4/5).

---

### Task 1: Kontrakty — lista zainteresowań, profil, polecenie i DTO lekcji

**Files:**
- Modify: `packages/contracts/src/limits.ts`
- Create: `packages/contracts/src/child-interests.ts`
- Create: `packages/contracts/src/child-interests.test.ts`
- Modify: `packages/contracts/src/index.ts` (eksport)
- Modify: `packages/contracts/src/decks.ts:14-77` (`ChildPatchSchema`, `ChildDtoSchema`, `toChildDto`)
- Modify: `packages/contracts/src/lessons.ts` (`LessonCommandSchema`, `SubjectCatalogDtoSchema`, `LessonDraftDtoSchema`)
- Test: `packages/contracts/src/child-profile.test.ts`, `packages/contracts/src/lessons.test.ts`

**Interfaces:**
- Produces:
  - `MAX_CHILD_INTERESTS: 5`, `MAX_CHILD_INTEREST_LENGTH: 40`
  - `normalizeChildInterest(value: string): string`
  - `ChildInterestSchema` (ZodString z `.overwrite(normalizeChildInterest)`), `ChildInterestsSchema` (tablica 0–5, bez duplikatów)
  - `mergeChildInterests(current: readonly string[], added: readonly string[]): string[]` — normalizuje dodawane, pomija puste/niepoprawne i duplikaty (case-insensitive), ucina do 5, zachowuje kolejność
  - `isValidChildInterest(value: string): boolean` (dla formularzy)
  - `ChildPatch.interests?: string[]`; `ChildDto.interests: string[]`; `toChildDto(row & { interests: string[] })`
  - `LessonCommand.interests?: string[]` (min 1)
  - `SubjectCatalogDto.subjects[].acceptsInterests?: boolean`, `SubjectCatalogDto.generationService?: string`
  - `LessonDraftDto.interests?: string[]`

- [ ] **Step 1: Testy** w `child-interests.test.ts`:
  - `normalizeChildInterest("  piłka   nożna ")` → `"piłka nożna"`; `"Pokémon"` → `"Pokémon"` (NFC).
  - `ChildInterestSchema.parse("Minecraft")` OK; odrzuca `""`, `"a".repeat(41)`, `"<script>"`, `"-dino"`; przyjmuje `"rock'n'roll"`, `"Tom & Jerry"`, `"F1"`.
  - `ChildInterestsSchema` odrzuca 6 elementów i `["Dinozaury", "dinozaury"]`; przyjmuje `[]`.
  - `mergeChildInterests(["piłka nożna"], ["Piłka  nożna", "dinozaury", "x".repeat(41)])` → `["piłka nożna", "dinozaury"]`; wynik nigdy > 5.
  - w `child-profile.test.ts`: `ChildPatchSchema.parse({ interests: [] })` OK (zalicza się do „co najmniej jednego pola”); `ChildDtoSchema.parse({...dto, interests: ["  a  "]})` nie normalizuje (zwraca `"  a  "`); `toChildDto` przenosi `interests`.
  - w `lessons.test.ts`: `LessonCommandSchema` przyjmuje `interests: ["dinozaury"]`, odrzuca `interests: []`; `SchoolLessonCommandSchema`/`MaterialLessonCommandSchema` odrzucają `interests` (strict); `SubjectCatalogDtoSchema` przyjmuje katalog bez nowych pól i z nimi; `LessonDraftDtoSchema` przyjmuje `interests`.
- [ ] **Step 2:** `pnpm vitest run packages/contracts` → FAIL (brak modułu/pól).
- [ ] **Step 3: Implementacja.** `ChildInterestSchema` = `z.string().overwrite(normalizeChildInterest).min(1).max(40).regex(...)` (bez `.transform` — w pakiecie nie ma transformów). `ChildDtoSchema` nadpisuje `interests: z.array(z.string())`. Komunikaty Zod po angielsku jak w pakiecie.
- [ ] **Step 4:** `pnpm vitest run packages/contracts` → PASS; `pnpm typecheck` — błędy tylko w miejscach budujących `ChildDto`/`toChildDto` (naprawiane w Task 2 i 6); jeśli typecheck zgłasza fixture'y testów w `apps/web` budujące `ChildDto`, dopisz im `interests: []` w tym zadaniu.
- [ ] **Step 5: Commit** „Kontrakty: lista zainteresowań dziecka i tematy lekcji (#197)”.

### Task 2: Baza i profil (`family/`)

**Files:**
- Create: `packages/server/drizzle/0032_child_interests.sql`
- Modify: `packages/server/drizzle/meta/_journal.json` (wpis idx 32)
- Modify: `packages/server/src/db/schema.ts:86-111`
- Modify: `packages/server/src/modules/family/profiles.ts:39-51`
- Modify: `docs/schema.sql` (tabela `child_profiles` do stanu bieżącego, łącznie z `interests`)
- Create: `tests/integration/child-interests.test.ts`
- Modify: `tests/integration-buckets.ts` (najlżejszy kosz)

**Interfaces:**
- Consumes: `ChildPatch.interests`, `toChildDto` z Task 1.
- Produces: kolumna `childProfiles.interests: string[]`; `updateChild` zapisuje `interests`.

- [ ] **Step 1: Testy integracyjne** (`describe("profil — zainteresowania")`): nowy profil ma `interests: []`; `updateChild(id, { interests: ["piłka nożna", "Minecraft"] })` → `listChildren` zwraca je w tej kolejności; `updateChild(id, { interests: [] })` czyści; surowy `INSERT`/`UPDATE` z 6 elementami i z `ARRAY['a', NULL]` łamie CHECK `child_profiles_interests_valid`; `deleteChild` usuwa wiersz.
- [ ] **Step 2:** `UMIEM_INTEGRATION_BUCKET=<n> pnpm test:integration` (lub `pnpm exec vitest run --config vitest.integration.config.ts tests/integration/child-interests.test.ts`) → FAIL.
- [ ] **Step 3: Migracja** SQL: `ALTER TABLE learning_app.child_profiles ADD COLUMN interests text[] NOT NULL DEFAULT ARRAY[]::text[];` + `ADD CONSTRAINT child_profiles_interests_valid CHECK (cardinality(interests) <= 5 AND array_position(interests, NULL) IS NULL);` z nagłówkiem-komentarzem wzorem `0031` (ręczna, bo snapshoty kończą się na 0017). Wpis w `_journal.json`: `idx: 32`, `tag: "0032_child_interests"`, `when` = poprzedni + 100000000, pozostałe pola jak w poprzednim wpisie. `schema.ts`: `interests: text("interests").array().notNull().default(sql\`ARRAY[]::text[]\`)` + check (wzór `scopes`, `test_goals`). `updateChild`: warunkowe `interests`.
- [ ] **Step 4:** test integracyjny → PASS; `pnpm vitest run tests/integration-buckets.test.ts` → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** „Profil dziecka: kolumna zainteresowań i migracja 0032 (#197)”.

### Task 3: Reguła przedmiotu i adapter LLM

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts:~126` (`SubjectPromptProfile.interestsRule?: string`)
- Modify: `packages/server/src/domain/lessons/subjects/english-grammar/prompts.ts`
- Modify: `packages/server/src/ports/ai.ts` (`LlmPromptProfileInput.interestsRule?`, `LessonPoolInput.interests?`)
- Modify: `packages/server/src/providers/openai/llm.ts:151` (`lessonSystemPrompt`), `:351` (`lessonUserMaterial`), `:378` (`fencedUserMaterial`)
- Test: `packages/server/src/providers/openai/llm.test.ts`, `packages/server/src/domain/lessons/subjects/english-grammar/module.test.ts`, `.../english-grammar/validators.test.ts`

**Interfaces:**
- Produces: `SubjectPromptProfile.interestsRule?: string`; `LlmPromptProfileInput.interestsRule?: string`; `LessonPoolInput.interests?: readonly string[]`.

- [ ] **Step 1: Testy.**
  - `llm.test.ts` (`describe("generateLessonPool — tematy zdań")`): z `interests: ["piłka nożna", "dinozaury"]` i `promptProfile.interestsRule: "RULE"` — system zawiera `RULE`, nie zawiera `piłka nożna`; user zawiera blok `--- SENTENCE THEMES (begin) ---\npiłka nożna\ndinozaury\n--- SENTENCE THEMES (end) ---` po `--- PARENT NOTE (end) ---`; bez `interests` (i bez reguły) oba komunikaty równe wynikom bazowego wejścia (snapshot porównany z wejściem bez pól); z `interests` ale bez reguły — brak bloku i reguły.
  - `module.test.ts`: `englishGrammarSubject.prompts.interestsRule` zawiera `"lesson_open_answer"`, `"visualSubject"`, `"at most half"`, `"data only"`, `"real people"`; `schoolSubject` i `englishChapterSubject` nie mają `interestsRule`.
  - `validators.test.ts`: poprawne ćwiczenia z tematem przechodzą walidację: `lesson_gap` „Tom ___ football every day.” (`plays`), `lesson_choice` „Dinosaurs ___ big.” (`are`), „Gymnastics ___ fun.” (`is`) w celu `to_be`. Jeśli „Gymnastics is fun.” zostaje odrzucone przez `looksPlural`, dodaj wyjątek dla rzeczowników na `-ics`/`maths` w `validators.ts:206` i test.
- [ ] **Step 2:** `pnpm vitest run packages/server/src/providers/openai/llm.test.ts packages/server/src/domain/lessons/subjects` → FAIL.
- [ ] **Step 3: Implementacja.** Reguła gramatyki — tekst ze specu §5.1 (dosłownie). `lessonSystemPrompt`: gdy `input.interests?.length && input.promptProfile.interestsRule` — `parts.push(interestsRule)` po `fieldRules`/regułach przedmiotu. `lessonUserMaterial` przyjmuje `Pick<LessonPoolInput, "material" | "instruction" | "interests" | "promptProfile">`; blok tylko gdy reguła i niepusta lista. Wywołanie przykładów (`llm.ts:531`) bez tematów.
- [ ] **Step 4:** testy → PASS; `pnpm vitest run packages/server/src/domain` → PASS.
- [ ] **Step 5: Commit** „Generator: reguła tematów zdań gramatyki i blok danych w promptcie (#197)”.

### Task 4: Migawka tematów w tworzeniu, runie i dogenerowaniu

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (`LessonContext` :74, `LessonRunInput` :95, `createLesson` :147, `buildPoolInput` :486, wywołania w `executeLessonGeneration` :1152+, `regenerateObjective` :1541)
- Modify: `tests/integration/child-interests.test.ts`
- Test: `packages/server/src/modules/materials/lessons/lesson-drafts.test.ts`

**Interfaces:**
- Consumes: `LessonCommand.interests` (Task 1), `LessonPoolInput.interests`, `interestsRule` (Task 3).
- Produces: `LessonContext.interests?: string[]`, `LessonRunInput.interests?: string[]`; `buildPoolInput(..., existingExercises, interests?: readonly string[])` — dodaje `interests` i `promptProfile.interestsRule` tylko gdy `subject.prompts.interestsRule` i lista niepusta.

- [ ] **Step 1: Testy.**
  - `lesson-drafts.test.ts`: `buildPoolInput(englishGrammarSubject, …, ["dinozaury"])` ma `interests` i `promptProfile.interestsRule`; bez listy — brak obu pól; przedmiot bez reguły z listą — brak obu.
  - integracja (`describe("lekcja — migawka tematów")`, przedmioty produkcyjne, `FakeLlmProvider` z `tests/integration/fakes.ts`):
    - `createLesson({...grammar, interests: ["piłka nożna"]})` → `deck_versions.lesson_context->interests` i `generation_runs.input->interests` = `["piłka nożna"]`; bez pola — klucza brak.
    - `createLesson` z `interests` dla przedmiotu bez reguły (`historyLikeSubject` z rejestru testowego) → `validation`, brak wierszy `decks`.
    - po `executeLessonGeneration` każdy `fake.lessonRequests[i].interests` = migawka; **prywatność:** `JSON.stringify(fake.lessonRequests)` nie zawiera `displayName` („Zuzanna Testowa-Fikcyjna”), `birthYear` (2017) ani `childId` dziecka, którego zainteresowania wstawiono.
    - `regenerateObjective` po `deleteChild` → nowy run ma `input.interests` = migawka, a żądanie fake LLM ją niesie.
- [ ] **Step 2:** testy → FAIL.
- [ ] **Step 3: Implementacja** wzorem `instruction`: warunkowe spready w obu obiektach `createLesson`, odczyt z `run.input` w wykonaniu, przekazanie do `buildPoolInput`, kopia z kontekstu w `regenerateObjective`. Walidacja w `createLesson` przed `enqueueGenerationRun`.
- [ ] **Step 4:** testy → PASS; `pnpm vitest run packages/server/src/modules` (w tym `module-boundaries.architecture.test.ts`) → PASS.
- [ ] **Step 5: Commit** „Lekcje: migawka tematów zdań w kontekście, runie i dogenerowaniu (#197)”.

### Task 5: API rodzica — szkic, patch, katalog i nazwa usługi

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (`LessonContextView`/`readLessonContext` :62-90, DTO szkicu :276+, `LessonDraftPatchSchema` :448, `editLessonDraft` :639-745, `lessonCatalog` :116)
- Modify: `packages/server/src/config.ts` (`Services.generationService?: string`, `createServices`)
- Modify: `packages/server/src/providers/generation-env.ts` (`generationPublicServiceFromEnv`)
- Modify: `packages/server/src/index.ts` (eksport `generationPublicServiceFromEnv`)
- Modify: `apps/web/src/composition.ts:59-73`
- Modify: `apps/web/src/parent/orpc-contract.ts:187-197` (`interests` w `LessonDraftPatchContractSchema` + refine)
- Test: `packages/server/src/providers/generation-env.test.ts` (utwórz, jeśli brak), `packages/server/src/modules/materials/lessons/lesson-api.test.ts`, `tests/integration/child-interests.test.ts`

**Interfaces:**
- Produces: `generationPublicServiceFromEnv(env: Record<string, string | undefined>): string` — fake → `"fake-llm-1"`, inaczej `` `${new URL(baseUrl).host} · ${model}` `` z `UMIEM_LLM_BASE_URL`/`UMIEM_LLM_MODEL` (puste = domyślne adaptera `https://api.openai.com/v1`, `gpt-4o-mini` — wyeksportuj stałe z `llm.ts`); `Services.generationService?: string`; `LessonDraftPatch.interests?: string[]`.

- [ ] **Step 1: Testy.**
  - `generationPublicServiceFromEnv(withConfigDefaults({}))` → `"openrouter.ai · google/gemini-3.8-flash"`; `{ UMIEM_FAKE_PROVIDERS: "1" }` → `"fake-llm-1"`; własny URL/model → `host · model`.
  - `lessonCatalog`: gramatyka `acceptsInterests: true`, szkoła i rozdział `false`; `generationService` obecne tylko gdy `services.generationService`.
  - integracja: szkic gramatyki z migawką → `readLessonDeck(...).draft.interests` = migawka; `editLessonDraft(v, { expectedEditNumber, interests: [] })` → kontekst bez tematów (pusta lista usuwa klucz), kolejne `regenerateObjective` → żądanie bez `interests`; patch `interests` dla lekcji szkolnej → `validation`; nowy szkic z opublikowanej (`createLessonDraftFromPublished`) zachowuje `interests`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementacja.** Patch: `interests: ChildInterestsSchema.optional()`, refine o `interests`; w `editLessonDraft` warunek zapisu kontekstu rozszerzony o `patch.interests`, przedmiot bez `interestsRule` → `validation`; `[]` → usunięcie klucza z kontekstu. DTO: `...(context.interests?.length ? { interests } : {})`. Web composition: `generationService: generationPublicServiceFromEnv(env)` (komentarz: web opisuje konfigurację wspólną z workerem).
- [ ] **Step 4:** testy → PASS; `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** „API rodzica: tematy w szkicu lekcji, katalog i nazwa usługi generującej (#197)”.

### Task 6: Panel rodzica — zainteresowania w profilu dziecka

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`children.interests`, `children.interestsHint`, `children.interestsPrivacy`, `children.interestsInvalid`, `children.interestsDuplicate`, `children.interestsLimit`, `children.removeKeepsLessonThemes`)
- Modify: `apps/web/src/parent/children-forms.ts` (`EditValues.interests: string[]`, `childPatch`)
- Modify: `apps/web/src/parent/ChildEditor.tsx` (`ChildEditForm` — `TagsInput`; `confirmRemove` — dodatkowe zdanie)
- Test: `apps/web/src/parent/children-forms.test.ts`, `tests/e2e/parent-children.spec.ts`

**Interfaces:**
- Consumes: `ChildDto.interests`, `ChildPatch.interests`, `mergeChildInterests`, `isValidChildInterest`, `MAX_CHILD_INTERESTS`, `MAX_CHILD_INTEREST_LENGTH` (Task 1).
- Produces: `childPatch(child, values)` z `interests` tylko przy zmianie (porównanie element po elemencie, kolejność ma znaczenie).

- [ ] **Step 1: Testy.** `children-forms.test.ts`: brak zmian → `{}`; ta sama lista → bez `interests`; inna kolejność → `interests`; usunięcie → `interests: []`. E2E `parent-children.spec.ts` (mocked; fixture dzieci dostaje `interests`): wpisanie „piłka nożna” + Enter, „Minecraft” + Enter, zapis → PATCH body ma `interests: ["piłka nożna", "Minecraft"]`; widoczne obie notki; dialog usuwania zawiera zdanie o tematach lekcji; szósty temat nie daje się dodać.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementacja.** `TagsInput` (Mantine) `data-testid="child-edit-interests"`, `maxTags={MAX_CHILD_INTERESTS}`, `splitChars={[","]}`, `onChange` przez `mergeChildInterests([], next)`; błąd pola z `messages` gdy element niepoprawny (`isValidChildInterest`), wtedy zapis nieaktywny. Notki pod polem (`Text size="sm" className="pp-editor-muted"`). Teksty dokładnie ze specu §6.1.
- [ ] **Step 4:** `pnpm vitest run apps/web/src/parent/children-forms.test.ts` → PASS; `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test tests/e2e/parent-children.spec.ts --project=mocked` → PASS.
- [ ] **Step 5: Commit** „Panel rodzica: zainteresowania w profilu dziecka (#197)”.

### Task 7: Panel rodzica — tematy zdań w formularzu nowej lekcji

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`lessons.themesTitle`, `lessons.themesInsert` „Wstaw zainteresowania: {name}”, `lessons.themesEmpty`, `lessons.themesService`, `lessons.themesServiceUnknown`)
- Modify: `apps/web/src/parent/lessons/NewLessonForm.tsx` (`NewLessonValues.interests: string[]`, `initialLessonValues`, budowanie `PendingLesson`, sekcja UI)
- Test: `apps/web/src/parent/lessons/new-lesson-form.test.tsx`, `tests/e2e/parent-lessons-layout.spec.ts`; fixture'y katalogów/dzieci w `tests/e2e/parent-lesson-editor-layout.spec.ts`, `parent-sources-layout.spec.ts`, `parent-source-vocabulary-layout.spec.ts`, `parent-deck-editor-layout.spec.ts`, `parent-lesson-voice-tone.spec.ts` (tylko gdy spec dotyka dzieci lub formularza lekcji)

**Interfaces:**
- Consumes: `SubjectCatalogDto.acceptsInterests`, `generationService`, `ChildDto.interests`, `mergeChildInterests` (Task 1).
- Produces: eksportowane z `NewLessonForm.tsx` `lessonInterestsOf(values, catalog): string[] | undefined` — lista do polecenia tylko dla przedmiotu z `acceptsInterests` i niepustej listy.

- [ ] **Step 1: Testy.** `new-lesson-form.test.tsx`: `lessonInterestsOf` → `undefined` dla pustej listy, dla przedmiotu bez flagi i po zmianie przedmiotu na rozdział; lista dla gramatyki. Render: przyciski „Wstaw zainteresowania: Ola” tylko dla dzieci z listą; kliknięcie dołącza bez duplikatów; przycisk nieaktywny, gdy wszystko już wstawione; brak dzieci z listą → `themesEmpty`; notka z `{service}` i wariant bez; przy `hasPending` pole i przyciski zablokowane. E2E `parent-lessons-layout.spec.ts` (mocked): POST `lessons.create` niesie `interests` po wstawieniu; sekcja ukryta dla rozdziału i szkoły.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementacja.** Dzieci: `useQuery(orpc.children.list.queryOptions())`. Sekcja pod polem instrukcji, `data-testid="lesson-themes"`, `TagsInput` `data-testid="lesson-themes-input"`, przyciski `data-testid="lesson-themes-insert-<childId>"`. Formularz nigdy nie wypełnia tematów sam. Pole wlicza się do stanu „dirty” formularza tak jak pozostałe pola.
- [ ] **Step 4:** unit + `--project=mocked` dla zmienionych speców → PASS.
- [ ] **Step 5: Commit** „Panel rodzica: tematy zdań przy tworzeniu lekcji gramatyki (#197)”.

### Task 8: Edytor lekcji — „Tematy zdań”, E2E real i dokumentacja

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`lessons.themesLine` „Tematy zdań: {themes}”, `lessons.themesRemove`)
- Modify: `apps/web/src/parent/lessons/LessonEditor.tsx` (stan `interestsForm` wzorem `examplesForm`: :125, :323, :410, :417, :458; wiersz pod `LessonSourceNote` :1111)
- Modify: `tests/e2e/lesson-parent.spec.ts`
- Modify: `docs/architecture.md` (sekcja 19 — tematy zdań, warstwy promptu, retencja), `AGENTS.md` (akapit w „Generowanie, media i prywatność”)
- Test: `apps/web/src/parent/lessons/lesson-editor-state.test.ts` (jeśli logika patcha trafi do `lesson-editor-state.ts`)

**Interfaces:**
- Consumes: `LessonDraftDto.interests`, `LessonDraftPatch.interests` (Task 5).

- [ ] **Step 1: Testy.** E2E real `lesson-parent.spec.ts`: rodzic dodaje zainteresowania w profilu, tworzy lekcję gramatyki z wstawionymi tematami, po wygenerowaniu edytor pokazuje `data-testid="lesson-themes-line"` z tematami; „Usuń tematy” + zapis → wiersz znika po przeładowaniu. Unit: patch zawiera `interests: []` tylko po usunięciu, a nie przy zwykłym zapisie ćwiczeń.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementacja.** Wiersz tylko gdy `interests` niepuste; w szkicu przycisk „Usuń tematy” ustawia `interestsForm = []` i oznacza edytor jako zmieniony; zapis dokłada `patch.interests` gdy `interestsForm` różni się od `draft.interests`. Wersja opublikowana — tylko odczyt. Dokumentacja wg specu §10.
- [ ] **Step 4:** `pnpm exec playwright test tests/e2e/lesson-parent.spec.ts --project=real` (z buildem) → PASS.
- [ ] **Step 5: Commit** „Edytor lekcji: tematy zdań, E2E i dokumentacja (#197)”.

### Task 9: Weryfikacja całości

- [ ] `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm build` → PASS.
- [ ] `pnpm test:e2e:shards` → wszystkie testy przechodzą (pomijane tylko zrzuty `screenshot:`).
- [ ] Wpis do opisu PR: API → MCP → `SKILL.md` (bez zmian, uzasadnienie ze specu §7), wykonane sprawdzenia, brak wymaganych wdrożeń u konsumentów MCP.
