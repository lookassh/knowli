# MCP: lekcja z materiału rodzica (`lesson_material_create`) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent MCP z tokenem `lessons:write`/`materials:write` zakłada szkic lekcji przedmiotu z materiału (`school`, `english_chapter`) z własnymi zagadnieniami i kartami; pytania dopisuje istniejące `lesson_draft_append`.

**Architecture:** Nowy przypadek użycia w `packages/server/src/modules/materials/lessons/lesson-authoring.ts` (obszar `materials`, bez nowych zależności między obszarami) buduje temat tymi samymi `buildDynamicTopicData`/`validateDynamicTopicData`/`withSubjectObjectiveKinds` co generowanie, w jednej transakcji z ponownym sprawdzeniem tokenu. Dwa nowe narzędzia w adapterze `apps/web/src/integrations/lesson-authoring-mcp-tools.ts`. Zasady zagadnień i kart przeniesione z `providers/openai/llm.ts` do stałych domeny bez zmiany bajtów promptu. Płatna ścieżka generowania (`generateDynamicObjectives`) nie zmienia się.

**Tech Stack:** TypeScript strict, Zod, Drizzle/PostgreSQL, `@modelcontextprotocol/sdk`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-mcp-lesson-from-material-design.md` (plan po przeglądzie trzech krytyków: zgodność z kodem, pokrycie specu, prostota i ryzyko).

## Global Constraints

- Zero wywołań LLM w nowych ścieżkach; jedyny koszt to nagrania TTS zlecane przez `reconcileDraftAssetsTx`.
- Wyjścia bez danych dzieci, tematów zdań (`interests`), przypisań, kosztów, runów.
- Rdzeń `buildDynamicTopicData` nigdy nie obcina ani nie zmienia danych z MCP: schemat wejścia ma limity równe progom obcinania albo ostrzejsze; jawny `slug` przechodzi bez zmian.
- Prompt zagadnień generatora identyczny bajt w bajt (pełne porównanie `toBe` przed i po), `generateDynamicObjectives` i `droppedObjectiveCount` bez zmian.
- Komunikaty błędów w `details` po polsku (jak rdzeń); opisy narzędzi po angielsku; dokumentacja po polsku.
- Nowa funkcja tworzenia nazywa się `createAuthoredMaterialLesson` — `createMaterialLesson` już istnieje (`lesson-drafts.ts:333`, panel).
- Testy architektury: `corepack pnpm vitest run architecture.test`.
- Wersja serwera MCP `0.6.0`.

## Review Focus

1. Powtórka `clientRequestId` po timeoucie — ten sam zestaw i te same `objectives` (Task 3).
2. Agent kopiuje `kind` do szkoły albo `voiceTone` do rozdziału — `validation`, nie ciche usunięcie (Task 3).
3. Jawny `slug` zderzony ze slugiem wyprowadzonym z tytułu innego zagadnienia albo z `__` — `validation` (Task 3).
4. Token odwołany przed wywołaniem — błąd bez zapisu. Odwołanie zatwierdzone w trakcie trwającej transakcji nie jest blokowane (jak wszystkie narzędzia: `authenticateIntegrationToken` bez `FOR SHARE`) — nie testujemy, odnotować w PR (Task 4).
5. Agent podaje jako `clientRequestId` `deckId` istniejącej lekcji szkolnej — dostaje „sukces” z cudzymi zagadnieniami bez zapisu; opis narzędzia i skill: zawsze nowy UUID (Task 4, Task 6).

---

### Task 1: Zasady zagadnień i kart w domenie, indeks w walidatorze

**Files:**
- Modify: `packages/server/src/domain/lessons/material-creation.ts`
- Modify: `packages/server/src/providers/openai/llm.ts:281-312`
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts:709` (sygnatura walidatora)
- Test: `packages/server/src/providers/openai/llm.test.ts`, `packages/server/src/domain/lessons/material-creation.test.ts` (utwórz, jeśli brak)

**Interfaces:**
- Produces (domena, `material-creation.ts`): stałe tekstów promptu tak, by `llm.ts` składał z nich identyczny tekst — `OBJECTIVES_SPLIT_GENERAL` (zdanie „Split the parent material into 2-8 … in teaching order. ”), `OBJECTIVES_CARDS_GENERAL` („cards (2-4 Polish explanation cards … not in the material). ”), `OBJECTIVES_SPLIT_SUBJECT` („Split the parent material into learnable objectives, in teaching order. ”), `OBJECTIVES_CARDS_SUBJECT` („kind and cards as the subject rules below say; card body at most 600 characters; NEVER add facts, words or definitions that are not in the material. ”). `OBJECTIVE_FIELDS` zostaje w adapterze.
- Produces: `export function materialObjectiveRules(subject: Pick<SubjectModule, "prompts">): string` — tekst dla agenta: przy `prompts.objectivesRules` → `OBJECTIVES_SPLIT_SUBJECT + "Each objective has titlePl, descriptionEn, kind and cards: " + OBJECTIVES_CARDS_SUBJECT + "Subject rules: " + objectivesRules`; bez → `OBJECTIVES_SPLIT_GENERAL + "Each objective has titlePl, descriptionEn and " + OBJECTIVES_CARDS_GENERAL` (dokładne łączniki do decyzji implementatora; zdania muszą być pełne).
- Produces: `buildDynamicTopicData(..., validateObjective: (objective, index: number) => string[] = () => [], allowVoiceTone = true)` — indeks w tablicy wejścia; dotychczasowe wywołanie bez zmian.

- [ ] **Step 1:** W `llm.test.ts` dodaj test `"prompt zagadnień identyczny bajt w bajt"`: dla stałego wejścia `OBJECTIVES_REQUEST` w czterech wariantach (bez/z `objectivesRules` × bez/z `voiceTones`) `expect(body.messages[0].content).toBe(<literał skopiowany z obecnego wyniku>)`. Uruchom `corepack pnpm vitest run packages/server/src/providers/openai/llm.test.ts` — PASS na kodzie sprzed zmiany (to migawka).
- [ ] **Step 2:** Test `"materialObjectiveRules"` w `material-creation.test.ts`: dla szkoły (`schoolSubject`) zawiera `"2-8"`, `"at most 600 characters"`, `"NEVER add facts"`; dla rozdziału zawiera `objectivesRules` modułu, `"at most 600 characters"`, `"NEVER add facts, words or definitions"`; żaden nie zawiera `"Return strict JSON"`. Uruchom — FAIL.
- [ ] **Step 3:** Przenieś literały do stałych, `llm.ts` je importuje; dodaj `materialObjectiveRules`; dodaj parametr `index` do walidatora (`forEach((raw, index) => … validateObjective(objective, index))`).
- [ ] **Step 4:** Uruchom `corepack pnpm vitest run packages/server/src/providers packages/server/src/domain/lessons packages/server/src/modules/materials/lessons/lesson-dynamic-objectives.test.ts` — PASS, migawka ze Step 1 bez zmian.
- [ ] **Step 5:** Commit `Lekcje: zasady zagadnień z materiału w domenie (prompt bez zmian), indeks w walidatorze zagadnienia`.

### Task 2: Kontrakt obu narzędzi

**Files:**
- Modify: `packages/contracts/src/lesson-authoring.ts`
- Test: `packages/contracts/src/lesson-authoring.test.ts` (utwórz, jeśli nie istnieje)

**Interfaces:**
- Produces (eksporty z `@learning/contracts`):
  - `LessonMaterialRulesInputSchema = z.object({ subjectId: z.string().min(1).optional() }).strict()`
  - `LessonMaterialRulesResultSchema = z.object({ subjects: z.array(MaterialSubjectRulesSchema) }).strict()`; `MaterialSubjectRulesSchema` (`.strict()`): `subjectId`, `subjectTitlePl`, `generationRole`, `objectiveRules` (string), `subjectTitleRequired`, `kindRequired`, `voiceTonesAllowed` (boolean; opis pola: także nagrania kart), `exerciseTypes: LessonExerciseTypeSchema[]`, `poolMinimums: { guided, productive, independent }` (int ≥ 0).
  - `LessonMaterialCreateInputSchema` (każdy poziom `.strict()`): `clientRequestId: UuidSchema`, `subjectId: string(1..64)`, `subjectTitlePl?: trim 1..MAX_SCHOOL_SUBJECT_TITLE_LENGTH`, `topicTitlePl: trim 1..MAX_SCHOOL_TOPIC_TITLE_LENGTH`, `material: trim 1..MAX_SCHOOL_MATERIAL_LENGTH`, `title?: TitleSchema` (lokalny w pliku), `objectives: 1..8 × { slug?: /^[a-z0-9]+(?:_[a-z0-9]+)*$/ max 40, titlePl: trim 1..120, descriptionEn: trim 1..400, kind?: DynamicObjectiveKindSchema, cards: 2..4 × { title: trim 1..120, body: trim 1..600 z refine „bez {{examples}}”, voiceTone?: LessonVoiceToneSchema } }`.
  - `LessonMaterialCreateResultSchema = LessonDraftWriteResultSchema.extend({ objectives: z.array(z.object({ id: z.string(), titlePl: z.string(), kind: DynamicObjectiveKindSchema.optional() }).strict()) })`.
  - Typy `LessonMaterialRulesInput`, `LessonMaterialRulesResult`, `LessonMaterialCreateInput`, `LessonMaterialCreateResult`; komentarz przy `LESSON_AUTHORING_WRITES_PER_HOUR` i nagłówek pliku wymieniają nowe narzędzia.

- [ ] **Step 1:** Test `"lesson_material_create: limity równe progom rdzenia"` — `safeParse` odrzuca: 1 kartę, 5 kart, `descriptionEn` 401 znaków, `body` 601 znaków, 9 zagadnień, `kind: "other"`, `slug` `"Ź"`, `"a__b"`, `"_a"`, `"a_"`, kartę z `{{examples}}`, nieznane pole na każdym poziomie; przyjmuje minimalne poprawne wejście i `slug: "nogi_pajaka"`. Uruchom `corepack pnpm vitest run packages/contracts` — FAIL.
- [ ] **Step 2:** Zaimplementuj schematy.
- [ ] **Step 3:** Uruchom — PASS.
- [ ] **Step 4:** Commit `Kontrakt: lesson_material_rules i lesson_material_create`.

### Task 3: Przypadki użycia `lessonMaterialRules` i `createAuthoredMaterialLesson`

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-authoring.ts`
- Modify: `packages/server/src/modules/materials/index.ts:17`, `packages/server/src/index.ts` (eksporty)
- Test: `tests/integration/lesson-authoring-mcp.test.ts` — nowy `describe("lekcja z materiału — przypadek użycia")` wołający funkcje wprost

**Interfaces:**
- Consumes: Task 1 (`materialObjectiveRules`, walidator z indeksem), Task 2 (schematy); istniejące `buildDynamicTopicData`, `validateDynamicTopicData`, `withSubjectObjectiveKinds`, `materialCreationMode`, `requiresParentSubjectTitle`, `requireSubject`, `requireIntegrationScope`/`AUTHORING_SCOPES`, `currentVersionId`, `readLessonContext`, `reconcileDraftAssetsTx`, `readLessonDraftDto`, `writeResult`, `lessonPoolMinimums`.
- Produces:
  - `export async function lessonMaterialRules(services: Services, rawToken: string, input: unknown): Promise<LessonMaterialRulesResult>` — transakcja tylko do odczytu z `requireIntegrationScope`; bez `subjectId` wszystkie przedmioty rejestru z `materialCreationMode !== undefined`; przedmiot katalogowy/nieznany → `validation`. `kindRequired = prompts.objectivesRules !== undefined`, `voiceTonesAllowed = ttsForPrompts === true`, `exerciseTypes` bez `lesson_card`, `poolMinimums = lessonPoolMinimums(subject)`.
  - `export async function createAuthoredMaterialLesson(services: Services, rawToken: string, input: unknown): Promise<LessonMaterialCreateResult>`.

Zachowanie `createAuthoredMaterialLesson` (kolejność ma znaczenie, komunikaty po polsku):
1. `LessonMaterialCreateInputSchema.parse`; `requireSubject`; `materialCreationMode(subject) === undefined` → `validation`.
2. Reguły przedmiotu przed budową, zbierane w `details.objectives: [{ index, errors }]` i `details.topic: string[]`: `subjectTitlePl` brak przy `requiresParentSubjectTitle` / obecny bez (→ `topic`); `kind` brak przy `kindRequired` / obecny bez; `voiceTone` przy `ttsForPrompts !== true`. Niepuste → `validation`.
3. `buildDynamicTopicData(objectives.map((o) => ({ ...o, slug: o.slug ?? o.titlePl })), subject.id, deckId, topicTitlePl, (objective, index) => zbierz(index, validateDynamicTopicData(subject, { titlePl: topicTitlePl, objectives: [objective] })), subject.ttsForPrompts === true)`; potem każdy obiekt z jawnym `slug` musi mieć `id.endsWith("." + slug)`, inaczej błąd przy jego indeksie; `errors`/zebrane niepuste → `validation`; `validateDynamicTopicData(subject, data)` niepuste → `validation` z `details.topic`; `data = withSubjectObjectiveKinds(subject, data)`.
4. Transakcja jak `createAuthoredLesson`: `requireIntegrationScope`; `INSERT decks { id: deckId, title, kind: "lesson" } ON CONFLICT DO NOTHING`. Powtórka: istniejący zestaw → `currentVersionId` → `readLessonContext`; wynik tylko gdy `kind === "lesson"`, `context.subjectId === subject.id` i `context.dynamicTopic !== undefined`, inaczej `conflict`.
5. Wersja: `versionNumber: 1`, `editNumber: 1`, `state: "review"`, `title`, `sourceLocale: subject.promptLocale`, `targetLocale: subject.answerLocale`, `lessonContext: { subjectId, topicId: "dynamic", topicVersion: 1, objectiveIds: data.objectives.map((o) => o.id), poolSize: 60, material, examples: {}, rejectedCount: 0, dynamicTopic: data, ...(subjectTitlePl === undefined ? {} : { subjectTitlePl }) }`. `title = input.title ?? [...\`${subjectTitlePl ?? subject.titlePl}: ${topicTitlePl}\`].slice(0, 120).join("")`.
6. `reconcileDraftAssetsTx(tx, services, { id: versionId, state: "review", deckId })`.
7. Wynik: `{ ...writeResult(services, dto), objectives: context.dynamicTopic.objectives.map(({ id, titlePl, kind }) => ({ id, titlePl, ...(kind === undefined ? {} : { kind }) })) }` — ta sama funkcja dla powtórki.

- [ ] **Step 1: testy (FAIL)** — fikcyjne dane: szkoła „Przyroda”/„Pająki”, materiał i cytat jak blok szkoły w tym pliku (~l. 416-446, `QUOTE`); rozdział: materiał i zagadnienia jak `tests/integration/chapter-lesson-helpers.ts`/`lesson-chapter.test.ts`.
  - `"szkoła: wersja review, kontekst, locale, tytuł i nagrania kart"` — `state = 'review'`, `source_locale = target_locale = 'pl-PL'`, tytuł `"Przyroda: Pająki"`, `lessonContext` dokładnie pola z punktu 5, `objectiveIds` z prefiksem `` `school.d${deckId}.` ``, liczba nagrań kart (`media_assets`) = liczba kart, zero `generation_runs`.
  - `"rozdział: kind w kontekście, brak nagrań kart, locale pl-PL→en-GB, tytuł z przedmiotu"` — tytuł `` `${englishChapter.titlePl}: ${topicTitlePl}` ``, zero `media_assets`.
  - `"powtórka clientRequestId zwraca ten sam zestaw i te same objectives; lekcja katalogowa albo zestaw słówek o tym id → conflict"`.
  - `"błędy reguł przedmiotu bez zapisu"` — tabela: przedmiot katalogowy; rozdział bez `kind`; szkoła z `kind`; szkoła bez `subjectTitlePl`; rozdział z `subjectTitlePl`; `voiceTone` w rozdziale; jawny `slug` `"pajaki"` przy drugim zagadnieniu o tytule „Pająki” bez `slug` (kolizja z wyprowadzonym); każdy `validation` z poprawnym `details.objectives[].index` albo `details.topic`, niezmienione liczby `decks`, `deck_versions`, `media_assets`.
  - `"dwa zagadnienia o tym samym tytule bez slug dostają różne id"`.
  - `"lessonMaterialRules: szkoła i rozdział"` — szkoła: `subjectTitleRequired: true`, `kindRequired: false`, `voiceTonesAllowed: true`, `poolMinimums: { guided: 3, productive: 2, independent: 2 }`, `objectiveRules` zawiera `"2-8"`; rozdział: `kindRequired: true`, `voiceTonesAllowed: false`, `poolMinimums: { guided: 3, productive: 3, independent: 2 }`; `exerciseTypes` bez `lesson_card`; przedmiot katalogowy → `validation`.
- [ ] **Step 2:** Uruchom `corepack pnpm test:integration tests/integration/lesson-authoring-mcp.test.ts` — FAIL.
- [ ] **Step 3:** Zaimplementuj obie funkcje i eksporty.
- [ ] **Step 4:** `corepack pnpm vitest run architecture.test` i test integracyjny — PASS.
- [ ] **Step 5:** Commit `Lekcje: lekcja z materiału rodzica tworzona przez agenta (przypadek użycia)`.

### Task 4: Narzędzia MCP i pełne ścieżki przez klienta Streamable HTTP

**Files:**
- Modify: `apps/web/src/integrations/lesson-authoring-mcp-tools.ts` (`materialRules: "lesson_material_rules"`, `materialCreate: "lesson_material_create"`)
- Modify: `apps/web/src/integrations/learning-mcp-route.ts:223` (okablowanie), `apps/web/src/integrations/learning-mcp-server.ts:10` (`"0.6.0"`)
- Modify: `apps/web/src/integrations/learning-mcp-route.test.ts:18,141,155,173` (atrapy, listy, `toHaveLength(19)` → 21)
- Modify: `tests/integration/lesson-authoring-mcp.test.ts:151,352,364,644` (listy, liczby narzędzi)

**Interfaces:**
- Consumes: Task 2 schematy, Task 3 funkcje.
- Definicje: `materialRules: { scopes: LESSONS, readOnly: true, idempotent: true }`; `materialCreate: { scopes: LESSONS, write: true, readOnly: false, idempotent: true }`. Opisy:
  - rules: „Rules for splitting the parent's material (for example a textbook page) into objectives with cards for a new lesson of a subject built from material: the subjects, whether a subject title or an objective kind is required, whether cards take voice tones (and get recordings), the objective rules the panel generator uses, exercise types and pool minimums. Call it before lesson_material_create.”
  - create: „Create a lesson draft from the parent's material with objectives and cards you wrote, without exercises (state review; the parent reviews and publishes it in the panel). Use a new UUID as clientRequestId for every new lesson, never an existing deckId; a retry with the same clientRequestId returns the same lesson. Returns the objective ids: then call lesson_catalog with deckId and add exercises with lesson_draft_append. Nothing is saved on any error. Orders paid TTS card recordings for subjects whose cards take voice tones. Never publishes or assigns.”

- [ ] **Step 1: testy (FAIL)**:
  - `"szkoła przez MCP: zasady → utworzenie → katalog → walidacja → dopisanie → publikacja rodzica"` — token `lessons:write`; `lesson_material_rules` → `lesson_material_create` (`LessonMaterialCreateResultSchema`, `coverage` niepuste) → `lesson_draft_get` (zagadnienia, materiał, `subjectTitlePl`) → `lesson_catalog({ deckId })` z `school.quote_in_material` w regułach → `lesson_validate({ deckId, append: true, exercises })` `ok: true` → `lesson_draft_append` pulą `schoolChoice×3`, `schoolGap×2`, `schoolOpen×2` na zagadnienie (cytat z wysłanego materiału) → wynik `coverage: []` → `publishLessonDraft` rodzica przechodzi.
  - `"rozdział przez MCP: ta sama ścieżka z kind"` — token `materials:write`; pula 3/3/2 na zagadnienie z wzorów `lesson-chapter.test.ts`; publikacja przechodzi.
  - `"publikacja lekcji z materiału bez zadań daje validation"` — `publishLessonDraft` zaraz po utworzeniu rzuca `AppError` `validation`.
  - `"outputSchema obu narzędzi w tools/list; learning:read → 403; token odwołany przed wywołaniem → błąd bez zapisu"` (wzorzec odwołania z testu `:317`).
  - `"błędne wejście przed SDK daje validation w formacie narzędzi bez zapisu"` — 1 karta, 5 kart, `descriptionEn` 401, 9 zagadnień, `{{examples}}`: `details.issues`, niezmienione liczby `decks`, `deck_versions`, `media_assets`.
- [ ] **Step 2:** Uruchom — FAIL.
- [ ] **Step 3:** Definicje, okablowanie, wersja; listy i atrapy.
- [ ] **Step 4:** `corepack pnpm vitest run apps/web/src/integrations` i `corepack pnpm test:integration tests/integration/lesson-authoring-mcp.test.ts` — PASS.
- [ ] **Step 5:** Commit `MCP 0.6.0: lesson_material_rules i lesson_material_create`.

### Task 5: Panel dla lekcji bez zadań

**Files:**
- Test: `tests/integration/lesson-authoring-mcp.test.ts` (`describe` z Task 4)
- Modify (tylko jeśli test padnie): `packages/server/src/modules/materials/decks.ts:753` albo widok w `apps/web/src/parent`

- [ ] **Step 1:** Test `"panel: lekcja z materiału bez zadań na liście zestawów i w odczycie"` — po `lesson_material_create`: `listDecks(services)` zawiera zestaw (kind lekcja, stan szkicu `review`); `readLessonDeck(services, deckId)`: `generation` jest `null`, `draft.exercises` ma długość 0, `draft.dynamicTopic.objectives` odpowiada utworzeniu.
- [ ] **Step 2:** Uruchom. PASS → bez zmian kodu. FAIL → minimalna poprawka tam, gdzie wskazuje błąd; test PASS.
- [ ] **Step 3:** Przejrzyj `apps/web/src/parent/lessons` (np. `LessonEditor.tsx:85,552`) pod założenie `exercises.length > 0` poza blokadą publikacji; wynik do opisu PR. Bez uruchomienia panelu nie deklaruj wyglądu.
- [ ] **Step 4:** Commit (jeśli były zmiany) `Panel: lekcja z materiału bez zadań`.

### Task 6: Skill i dokumentacja

**Files:**
- Modify: `integrations/umiem-mcp/skills/umiem-lesson-authoring/SKILL.md` (frontmatter l. 3, „six tools” l. 8, l. 10, l. 42 + nowa sekcja)
- Modify: `docs/integrations/lesson-authoring.md` (wstęp, tabela narzędzi, tabela zakresów, zdanie „Lekcji z materiału rodzica nie da się utworzyć od zera”, limity, historia wersji 0.6.0)
- Modify: `docs/architecture.md:330,351` i §19.18

- [ ] **Step 1:** Sekcja skilla „New lesson from a textbook page”: odczytaj tekst ze zdjęcia, scal wyrazy dzielone na końcu linii; pomiń dane osobowe (imię dziecka, nauczyciel, szkoła) w materiale, `title` i `topicTitlePl`; pokaż rodzicowi odczyt i poczekaj na potwierdzenie; `lesson_material_rules` → `lesson_material_create` z nowym UUID (karty prostym polskim, bez `{{examples}}`, `kind` tylko przy `kindRequired`, `voiceTone` tylko przy `voiceTonesAllowed`) → `lesson_catalog({ deckId })` → iteracje `lesson_validate({ deckId, append: true })` → jedno `lesson_draft_append` z pulą spełniającą `poolMinimums` na każde zagadnienie (szkoła: także dwie różne odpowiedzi otwarte); cytaty `sourceRefs` kopiuj z wysłanego `material`, nie ze zdjęcia; limit 10 zapisów/h obejmuje poprawki i powtórki, odrzucone zapisy się nie liczą; zagadnień, kart i materiału MCP nie poprawi — rodzic w panelu albo nowa lekcja. Usuń zdania o braku tworzenia od zera, zaktualizuj liczbę narzędzi.
- [ ] **Step 2:** Dokumentacja integracji i architektury (l. 351: token może mieć kilka zakresów, `tools/list` pokazuje sumę narzędzi).
- [ ] **Step 3:** `corepack pnpm vitest run tests/docs-architecture-drift.test.ts` oraz testy w `integrations/umiem-mcp/tests`, jeśli obejmują skill — PASS.
- [ ] **Step 4:** Commit `Skill i dokumentacja: lekcja z materiału przez MCP`.

### Task 7: Weryfikacja gałęzi

- [ ] **Step 1:** `corepack pnpm check` — PASS.
- [ ] **Step 2:** `corepack pnpm test:integration` — PASS.
- [ ] **Step 3:** `corepack pnpm test:e2e:shards` na buildzie produkcyjnym — PASS (powtórka pojedynczego specu tylko przy `net::ERR_NO_BUFFER_SPACE`, odnotowana w PR).
- [ ] **Step 4:** Trzej niezależni krytycy na gałęzi, potem `/ponytail:ponytail-review`; uwagi osobnym commitem.
- [ ] **Step 5:** PR do `main`: moduł, zależności, transakcja; API → MCP → skill; wdrożenie u konsumentów (ponowne wgranie `SKILL.md` w claude.ai); sprawdzenia; niezweryfikowane (brak próby z prawdziwym connectorem claude.ai i zdjęciem; odwołanie tokenu w trakcie transakcji jak w innych narzędziach).
