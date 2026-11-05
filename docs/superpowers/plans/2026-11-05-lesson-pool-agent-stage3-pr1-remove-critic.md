# Etap 3 PR 1: usunięcie krytyka lekcji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usunąć z kodu krytyka lekcji (`LessonReviewerProvider`, `UMIEM_REVIEWER_*`, `lesson_context.review`, UI rodzica), zostawiając potok, ocenę aktywności sesji i zgodność ze starymi danymi.

**Architecture:** Czyste usuwanie w kolejności od warstwy UI do konfiguracji, tak żeby każdy commit się kompilował (typecheck obejmuje `tests/**`). Jedyny nowy kod to przeniesione i nowe testy zgodności (§2.4 specu) oraz prosty test limitu runu workera.

**Tech Stack:** TypeScript strict, Vitest (unit, integracja na Postgresie w kontenerze), Playwright, React/Mantine (panel rodzica), Zod.

**Spec:** `docs/superpowers/specs/2026-11-05-lesson-pool-agent-stage3-design.md` (wersja 3), §1, §2 i §9. Mapy pomocnicze (stan sprzed zmian, numery linii przybliżone): `C:\Users\looka\AppData\Local\Temp\claude\C--Users-looka-IdeaProjects-knowli--claude-worktrees-lesson-new-exercise-type-4e7d8f\072948fd-dbf4-49ca-8897-ff5ee18c371d\scratchpad\map-critic.md` i `critic-a-v2.md` w tym samym katalogu.

## Global Constraints

- Gałąź: `feature/lesson-pool-agent-stage3-237` (zawiera już commity specu). Nie wypychać do `main`, nie scalać PR.
- Nigdy `npm install`; tylko `corepack pnpm install --prefer-offline --frozen-lockfile`, i tylko gdy brak `node_modules`.
- Żadnych płatnych wywołań modeli (`pnpm probe:*` z kluczem) w tym PR.
- Bez migracji bazy; bez zmian w MCP (`integrations/`, `apps/web/src/integrations`) i `SKILL.md`.
- **Nie usuwać** oceny aktywności sesji: `SessionActivityReviewer`, `FakeSessionActivityReviewer`, `session_activity_review`, `ParentWorkCardDto.reviewService`, `WorkCardPanel`, `review_failed`, `reviewSessionActivity`, `activityReview`.
- **Nie usuwać**: stanu wersji `review` (`deck_versions.state`, `DeckStateSchema`), `nextReviewAt`, `mockTestReview*`, `reviewObjectives`, `findExposureLeaks`, `lesson-pool-acceptance.ts`, `lesson-json-request.ts` (z `cache_control`), `lesson-payload.ts`, `exposure-key`, `exercise-identity`, `withLessonGenerationControl`, `stageTopUpRound` (bez parametrów krytyka), `leakNoticeFor`.
- `withoutRunReports` (`modules/materials/version-ops.ts`) nadal usuwa klucze `review` i `generationGaps`.
- Każdy commit: `pnpm typecheck` przechodzi. Commity po polsku, zakończone `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kod po angielsku, komentarze i dokumentacja po polsku (jak w otaczającym kodzie).

## Review Focus

1. Stary szkic z kluczem `review` w `lesson_context` (sprzed PR 1): run generacji kończy się `succeeded`, DTO szkicu nie ma `review` — test w Task 3 (Step 1).
2. „Utwórz nową wersję” z wersji opublikowanej, która ma `review` i `generationGaps`: kopia nie ma żadnego z nich — test przeniesiony w Task 3 (Step 1).
3. `.env` z pozostawionymi `UMIEM_REVIEWER_ENABLED=true` i `UMIEM_REVIEWER_MODEL=x`: kompozycje web i worker składają się bez błędu — test w Task 4 (Step 1).
4. Karta pracy dziecka nadal pokazuje usługę oceny aktywności (`reviewService` karty) — weryfikacja w Task 1 (Step 4) i Task 7.
5. Potok po usunięciu fazy przeglądu: termin fazy = termin runu, runda pod etap działa — `tests/integration/lesson-chapter.test.ts` przechodzi bez zmian asercji (Task 3, Step 5).

---

### Task 1: Panel rodzica bez krytyka

**Files:**
- Delete: `apps/web/src/parent/lessons/LessonReviewBanner.tsx`, `apps/web/src/parent/lessons/lesson-review-banner.test.tsx`
- Modify: `apps/web/src/parent/lessons/LessonEditor.tsx` (importy banera i notatek, `reviewChangedByExercise`, `reviewNotice`, prop `review=`, `reviewService` dla panelu nadzoru, `<LessonReviewBanner>`)
- Modify: `apps/web/src/parent/lessons/LessonExerciseCard.tsx` (`ExerciseReviewNotice`, `reviewNoticeFor`, prop `review`, porównanie w memo, plakietka i Alert notatki; `leakNoticeFor` zostaje)
- Modify: `apps/web/src/parent/lessons/LessonSupervisionPanel.tsx` (prop `reviewService`, `data-testid="review-service"`)
- Modify: `apps/web/src/parent/lessons/NewLessonForm.tsx` (`data-testid="lesson-review-service"` i jego warunek)
- Modify: `apps/web/src/parent/sources/SourcePage.tsx` (`showReviewService`, `source-review-service`; logika `checkService` zostaje)
- Modify: `apps/web/src/parent/lessons/lesson-panels.css` (`.pp-lesson-review-toggle`)
- Modify tests: `apps/web/src/parent/lessons/new-lesson-form.test.tsx` (przypadki `reviewService`), `apps/web/src/parent/sources/sources-panel.test.tsx` (przypadki usługi krytyka)
- Modify E2E: `tests/e2e/parent-lesson-editor-layout.spec.ts` (blok banera, plakietek, kontrastu i `review-service`; stałe `REVIEW_SERVICE`, `reviewed`, `withReview`), `tests/e2e/parent-lessons-layout.spec.ts` (asercje i fixture `lesson-review-service`)

**Interfaces:**
- Consumes: nic nowego. Pola kontraktów `review`/`reviewService` są opcjonalne, więc zostają w typach do Task 2.
- Produces: web nie czyta `LessonDraftDto.review`, `SubjectCatalogDto.reviewService`, `LessonDeckDto.reviewService` ani komunikatów `messages.lessons.review*`, `fillTemplate` z banera.

- [ ] **Step 1: Usuń komponenty i użycia wymienione w Files.** `fillTemplate` z `LessonReviewBanner.tsx` usuń razem z plikiem, jeśli `grep -rn "fillTemplate" apps/web/src` nie pokaże innych użyć; w przeciwnym razie przenieś go do jedynego pozostałego użytkownika.
- [ ] **Step 2: Usuń przypadki testów web i E2E dotyczące krytyka** (Files). Nie ruszaj `parent-work-card.spec.ts`, `parent-progress-layout.spec.ts`, `WorkCardPanel`, `parent-router.test.ts`.
- [ ] **Step 3: Sprawdź, że w web nie ma odwołań do krytyka**

Run: `grep -rnE "LessonReviewBanner|reviewNotice|reviewChanged|lesson-review-service|source-review-service|review-service\"|showReviewService|pp-lesson-review-toggle|lessons\.review[A-Z]" apps/web/src tests/e2e`
Expected: brak wyników.

- [ ] **Step 4: Testy i typecheck**

Run: `corepack pnpm typecheck` → PASS.
Run: `corepack pnpm vitest run --config vitest.unit.config.ts apps/web/src/parent` → PASS.
Run: `corepack pnpm exec playwright test --project=mocked tests/e2e/parent-lesson-editor-layout.spec.ts tests/e2e/parent-lessons-layout.spec.ts tests/e2e/parent-work-card.spec.ts` → PASS.

- [ ] **Step 5: Commit** — `Panel rodzica: bez raportu i usługi krytyka lekcji (#237)`.

---

### Task 2: Kontrakty, komunikaty i DTO bez krytyka

**Files:**
- Modify: `packages/contracts/src/lessons.ts` (`REVIEW_CATEGORY_VALUES`, `ReviewCategorySchema`, `ReviewReasonSchema`, `LessonReviewDtoSchema` i typy `ReviewCategoryDto`, `ReviewReasonDto`, `LessonReviewDto`; pola `SubjectCatalogDto.reviewService`, `LessonDraftDto.review`, `LessonDeckDto.reviewService`)
- Modify: `packages/contracts/src/messages.ts` (import typów `Review*`; wszystkie klucze `review*` w `messages.lessons` od `reviewBanner` do `reviewServiceInfo`; w `themesService` i `themesServiceUnknown` usuń fragment o automatycznej kontroli jakości)
- Modify: `packages/contracts/src/lessons.test.ts` (describe „raport automatycznej kontroli jakości”)
- Modify: `packages/server/src/modules/materials/lessons/lesson-api.ts` (`LessonContextView.review`, rozkład w `readLessonContext`, `reviewDto`, blok `review` w DTO szkicu, `reviewService` w katalogu i zestawie; import `exerciseFingerprint`, `LessonReviewReport`, `statusFromObjectives`)
- Modify: `packages/server/src/config.ts` (`Services.reviewService`, wejście i rozkład w `createServices` — sam `reviewerPublicServiceFromEnv` zostaje do Task 4)
- Modify: `apps/web/src/composition.ts` (przekazanie `reviewService` do `createServices`; komentarz o ocenie aktywności zostaje)
- Modify: `apps/web/src/parent/lessons/new-lesson-form.test.tsx` (asercja tekstu `themesService` — teraz tekst nie zawiera „kontrola jakości”)
- Modify: `tests/integration/lesson-review.test.ts` (usuń describe „raport w DTO panelu rodzica” — reszta pliku znika w Task 3)

**Interfaces:**
- Consumes: Task 1 (web nie czyta usuwanych pól).
- Produces: brak w kontraktach typów i pól krytyka; `Services` bez `reviewService`.

- [ ] **Step 1: Napisz test tekstu tematów zdań** w `new-lesson-form.test.tsx`: dla obu wariantów (`themesService` ze znaną usługą i `themesServiceUnknown`) `expect(text).not.toMatch(/kontrol[aią] jakości/i)`; asercje o usłudze generującej zostają.
- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts apps/web/src/parent/lessons/new-lesson-form.test.tsx`
Expected: FAIL (tekst nadal wspomina kontrolę jakości).

- [ ] **Step 3: Usuń z kontraktów, komunikatów, `lesson-api.ts`, `config.ts` i kompozycji web wszystko z Files; popraw teksty `themesService*`** (zdanie o modelu generującym zostaje, wzmianka o kontroli jakości znika).
- [ ] **Step 4: Testy i typecheck**

Run: `corepack pnpm typecheck` → PASS.
Run: `corepack pnpm vitest run --config vitest.unit.config.ts packages/contracts apps/web/src/parent packages/server/src/modules/materials/lessons/lesson-api` → PASS.
Run: `grep -rnE "LessonReviewDto|ReviewCategoryDto|ReviewReasonDto|REVIEW_CATEGORY_VALUES|reviewService" packages/contracts/src packages/server/src/modules/materials apps/web/src/composition.ts` → wyniki tylko dla `ParentWorkCardDto.reviewService` (`parent-work-card.ts`) i modułu `reporting`.

- [ ] **Step 5: Commit** — `Kontrakty i DTO lekcji bez raportu krytyka (#237)`.

---

### Task 3: Potok i domena bez krytyka, testy zgodności

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (importy krytyka; `LessonContext.review`; `REVIEW_DROP_REASON`, `REVIEW_FINALIZATION_RESERVE_MS`; w `StageTopUpContext` pola `review`, `reviewReserveMs`; w `stageTopUpRound` wynik `reviews`, `toppedUp`, wywołanie `ctx.review`, `droppedCount` — `trimmed.kept` idzie wprost do `resolveGenerationLeaks`, bramka czasu bez rezerwy; `stageCountsOf`; `LessonPoolReview`; parametr `review` w `failedValidationContext`, `failLessonPoolValidation`, `finalizeLessonPoolWrite` i ich użycia; w głównym potoku `phaseDeadlineAtMs = runDeadlineAtMs`, usunięcie `reviewPhase`, `mainReview`, `reviewPhases`, `mergedReview`, `objectiveContext`; `fresh.accepted` wprost do `resolveGenerationLeaks`)
- Delete: `packages/server/src/modules/materials/lessons/lesson-review.ts`, `lesson-review.test.ts`; `packages/server/src/domain/lessons/review-criteria.ts`, `review-report.ts`, `review-verdicts.ts` z testami; `lesson-fingerprint.ts` i `lesson-fingerprint.test.ts` (sprawdź `grep -rn "exerciseFingerprint"` — po Task 2 zostają tylko te pliki i `lesson-review*`)
- Delete: `tests/integration/lesson-review.test.ts`, `tests/probes/lesson-review.probe.test.ts`; skrypt `probe:review` w `package.json`
- Modify: `tests/integration-buckets.ts` (wpis `lesson-review.test.ts` i komentarz o najdłuższych plikach), `tests/integration-buckets.test.ts` jeśli wymienia plik
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.test.ts` (przypadki z `review`/`reviewRules` tylko w części dotyczącej fazy przeglądu; `reviewRules` usuwa Task 5)
- Modify: `tests/integration/lesson-agent-generation.test.ts` (import `LessonReviewReport` i `FakeLessonReviewer`, `PRESET_REVIEW`, ustawianie `deps.reviewer` w `agentWorld`, asercje `reviewer.inputs` i `context.review`; nowe testy ze Step 1)

**Interfaces:**
- Consumes: Task 2 (DTO bez `review`).
- Produces: `finalizeLessonPoolWrite(...)` i `failLessonPoolValidation(...)` bez parametru `review`; `LessonContext` bez `review`. `GenerationDeps.reviewer` i fake krytyka nadal istnieją (usuwa Task 4), ale nikt ich nie czyta.

- [ ] **Step 1: Napisz testy zgodności** w `tests/integration/lesson-agent-generation.test.ts` (w bloku z `agentWorld`, na gramatyce — `agentWorld(["english_grammar"])` i `createLesson` jak w istniejących testach gramatyki):
  - `it("stary klucz review w kontekście szkicu: run succeeded, DTO szkicu bez review")`: przed `executeLessonGeneration` `setContextField(before.id, "review", { status: "reviewed", objectives: [] })`; po runie `expect(row.state).toBe("succeeded")`, a DTO szkicu odczytane tak jak w innych testach tego pliku (funkcja odczytu szkicu z `@learning/server`) spełnia `expect(draftDto).not.toHaveProperty("review")`.
  - `it("„Utwórz nową wersję” → kopia bez review i bez generationGaps")`: po udanym runie zasiej oba klucze (`jsonb_set` na `lesson_context`, `review` = `{"status":"reviewed"}`, `generationGaps` = `[{"objectiveId": <pierwsze zagadnienie>, "reason":"incomplete"}]`), `publishLessonDraft`, `createLessonDraftFromPublished(services, deckId)`; asercje: `copy.id !== draft.id`, `select lesson_context->'review'` i `->'generationGaps'` dla kopii zwracają `null`, `copy.examples` równe przykładom szkicu, `copy` bez `generationGaps`.
  - W teście rozdziału („planer → szkic …”) usuń `setContextField(…, "review", PRESET_REVIEW)` i asercje `reviewer.inputs`/`context.review`; resztę asercji zostaw, tytuł testu bez „krytyk nie wołany i jego raport bez zmian”.
- [ ] **Step 2: Uruchom nowe testy — mają przejść już teraz** (zachowanie istnieje; testy pilnują go przed usunięciem kodu)

Run: `corepack pnpm test:integration tests/integration/lesson-agent-generation.test.ts`
Expected: PASS.

- [ ] **Step 3: Usuń kod i pliki z Files** w kolejności: `lesson-drafts.ts` (potok bez fazy przeglądu), potem pliki krytyka, `lesson-fingerprint`, testy, sonda, skrypt, kosze.
- [ ] **Step 4: Sprawdź brak odwołań**

Run: `grep -rnE "lesson-review|LessonReviewReport|mergeReviewReport|reviewFreshExercises|decideObjectiveReview|REVIEW_DROP_REASON|REVIEW_FINALIZATION_RESERVE_MS|LessonPoolReview|exerciseFingerprint|toppedUp|probe:review" packages apps tests package.json`
Expected: brak wyników (poza `docs/`, których nie przeszukujemy).

- [ ] **Step 5: Testy**

Run: `corepack pnpm typecheck` → PASS.
Run: `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/modules/materials packages/server/src/domain/lessons tests/integration-buckets.test.ts` → PASS.
Run: `corepack pnpm test:integration tests/integration/lesson-agent-generation.test.ts tests/integration/lesson-chapter.test.ts tests/integration/lesson-generation.test.ts` → PASS, a `git diff HEAD -- tests/integration/lesson-chapter.test.ts` jest pusty (asercje rundy bez zmian).

- [ ] **Step 6: Commit** — `Potok lekcji bez fazy krytyka; testy zgodności starych danych (#237)`.

---

### Task 4: Konfiguracja, port i adapter krytyka

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (`LessonReviewExerciseInput`, `LessonReviewInput`, `LessonReviewerProvider`)
- Delete: `packages/server/src/providers/openai/lesson-reviewer.ts`, `lesson-reviewer.test.ts`, `lesson-review-schema.ts`
- Modify: `packages/server/src/providers/fake.ts` (`FakeReviewBehavior`, `FakeLessonReviewer`, importy), `packages/server/src/providers/fake.test.ts` (describe fake krytyka)
- Modify: `packages/server/src/providers/generation-env.ts` (`fakeReviewerFromEnv`, pola `reviewer`, importy), `generation-env.test.ts` (describe krytyka)
- Modify: `packages/server/src/config.ts` (`GenerationDeps.reviewer`, `ReviewerPolicy`, `ReviewerState`, `ReviewerDeps`, `reviewerEnabled`, `defaultReviewerPolicy`, `reviewerPolicyFromEnv`, `reviewerConnectionFromEnv`, `validatedReviewerConfig`, `reviewerFromEnv`, `reviewerPublicServiceFromEnv`, importy), `config.test.ts` (describe `reviewerFromEnv`/`reviewerPublicServiceFromEnv`)
- Modify: `packages/server/src/config-defaults.ts` (7 wpisów `UMIEM_REVIEWER_*` i komentarze; komentarz przy `WORKER_HEALTH_STALE_MS` przepisz na limit runu)
- Modify: `packages/server/src/index.ts` (eksport `reviewerFromEnv`, `reviewerPublicServiceFromEnv`)
- Modify: `packages/server/src/providers/chat-request-options.ts`, `providers/openrouter-key.ts` (prefiks `"UMIEM_REVIEWER"` w uniach)
- Modify: `packages/server/src/providers/usage-recording.architecture.test.ts` (komentarz „generator i krytyk lekcji” → „generator lekcji”)
- Modify: `apps/worker/src/loop.ts` (`reviewerHealthBudgetWarning`), `apps/worker/src/main.ts` (wywołanie), `apps/worker/src/loop.test.ts`
- Modify: `apps/web/src/composition.ts` (import i wywołanie `reviewerPublicServiceFromEnv`, jeśli zostały po Task 2)
- Modify: `tests/ai-sdk-scope.test.ts` (przykładowy plik `providers/openai/lesson-reviewer.ts` → `providers/openai/lesson-json-request.ts`)
- Modify: `tests/probes/chapter-generation.probe.test.ts` (stan krytyka, `deps.reviewer`, koszt `lesson_review`, prefiks `[lesson-review]`, etykieta `+review`), `tests/probes/probe-costs.test.ts` (etykieta `UMIEM_REVIEWER_BASE_URL` → inna zmienna, np. `UMIEM_GRADER_BASE_URL`), `vitest.probe.config.ts` (komentarz o `probe:review`)

**Interfaces:**
- Consumes: Task 3 (nikt nie czyta `GenerationDeps.reviewer`).
- Produces: `GenerationDeps` bez `reviewer`; `CONFIG_DEFAULTS` bez `UMIEM_REVIEWER_*`.

- [ ] **Step 1: Napisz testy**
  - `apps/worker/src/loop.test.ts`: zastąp describe krytyka jednym testem `it("domyślny limit runu generacji lekcji mieści się w WORKER_HEALTH_STALE_MS")`: `const env = withConfigDefaults({}); expect(Number(env.UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS)).toBeLessThan(workerLoopSettingsFromEnv(env).staleMs);` (import bez `reviewerHealthBudgetWarning`).
  - `packages/server/src/config.test.ts`: `it("pozostawione UMIEM_REVIEWER_* są ignorowane")`: `createGenerationDepsFromEnv(withConfigDefaults({ UMIEM_FAKE_PROVIDERS: "1", UMIEM_REVIEWER_ENABLED: "true", UMIEM_REVIEWER_MODEL: "x" }))` nie rzuca, a `expect(withConfigDefaults({})).not.toHaveProperty("UMIEM_REVIEWER_ENABLED")`.
- [ ] **Step 2: Uruchom — drugi test ma nie przejść**

Run: `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/config.test.ts apps/worker/src/loop.test.ts`
Expected: FAIL na `not.toHaveProperty("UMIEM_REVIEWER_ENABLED")` (wpis domyślny jeszcze istnieje).

- [ ] **Step 3: Usuń kod z Files.**
- [ ] **Step 4: Sprawdź brak odwołań**

Run: `grep -rnE "UMIEM_REVIEWER|LessonReviewerProvider|FakeLessonReviewer|reviewerFromEnv|reviewerPublicServiceFromEnv|reviewerEnabled|ReviewerDeps|reviewerHealthBudgetWarning|lesson_review\b|\[lesson-review\]" packages apps tests vitest.probe.config.ts`
Expected: brak wyników.

- [ ] **Step 5: Testy**

Run: `corepack pnpm typecheck` → PASS.
Run: `corepack pnpm test:unit` → PASS.

- [ ] **Step 6: Commit** — `Konfiguracja i adapter: usunięty krytyk lekcji i UMIEM_REVIEWER_* (#237)`.

---

### Task 5: `reviewRules` przedmiotów

**Files:**
- Modify: `packages/server/src/domain/lessons/types.ts` (pole `reviewRules` w promptach `SubjectModule`)
- Modify: `packages/server/src/domain/lessons/catalog-validation.ts` (wymóg `reviewRules`), `catalog-validation.test.ts` (przypadki `reviewRules`)
- Modify: `packages/server/src/domain/lessons/subjects/english-chapter/prompts.ts`, `subjects/english-grammar/prompts.ts`, `subjects/school/prompts.ts`, `domain/lessons/testing/history-like-subject.ts` (teksty `reviewRules`)
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.test.ts` (przypadki `reviewRules`, jeśli zostały)

**Interfaces:**
- Consumes: Task 3–4 (nikt nie czyta `reviewRules`).
- Produces: `SubjectModule.prompts` bez `reviewRules`.

- [ ] **Step 1: Usuń pole, walidację, teksty i testy z Files.** Treść reguł przepada świadomie (spec §1, poza zakresem).
- [ ] **Step 2: Sprawdź i przetestuj**

Run: `grep -rn "reviewRules" packages apps tests` → brak wyników.
Run: `corepack pnpm typecheck` → PASS.
Run: `corepack pnpm vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons packages/server/src/modules/materials` → PASS.

- [ ] **Step 3: Commit** — `Przedmioty lekcji bez reguł krytyka (#237)`.

---

### Task 6: Dokumentacja

**Files:**
- Modify: `docs/architecture.md` (§19.16 → jednozdaniowa notka „Krytyk lekcji usunięty w etapie 3 #237, 2026-11-05; historia: `docs/superpowers/specs/2026-11-02-lesson-review-stage-design.md`.”; odwołania do krytyka w §19.15 i §19.17; numeracja zostaje)
- Modify: `docs/SPEC.md` (§29a.9 → ta sama notka; wskazania „PR 2” krytyka; numeracja zostaje)
- Modify: `AGENTS.md` (punkt „Krytyk lekcji …”; wzmianki o krytyku w punktach o agencie puli, kluczu OpenRouter, tematach zdań; zdanie o pomiarze integracji z `lesson-review.test.ts` — zastąp „dolną granicę dają najdłuższe pliki (m.in. `learning-algorithm.test.ts`)”)
- Modify: `.env.example` (blok `UMIEM_REVIEWER_*`), `docs/folder-structure.md` (zdanie o `pnpm probe:review`)
- Modify: `docs/superpowers/specs/2026-11-02-lesson-review-stage-design.md` (dopisek na początku: „Krytyk (PR 2 tego etapu) usunięty w etapie 3 #237 PR 1 (2026-11-05); reguła twarda ujawnień zostaje; runda pod etap usunięta w etapie 3 PR 2.”), `docs/superpowers/plans/2026-11-02-lesson-review-stage-pr2-critic.md` (ten sam dopisek), `docs/superpowers/specs/2026-11-02-llm-cost-tracking-design.md` (przy wierszu `lesson_review`: „usunięty w etapie 3 #237”)

**Interfaces:** brak.

- [ ] **Step 1: Wprowadź zmiany z Files.**
- [ ] **Step 2: Sprawdź**

Run: `grep -rnE "UMIEM_REVIEWER|krytyk|probe:review|lesson-review" AGENTS.md .env.example docs/architecture.md docs/SPEC.md docs/folder-structure.md docs/provider-config.md`
Expected: wyłącznie notki „usunięty w etapie 3” i historyczne odwołania w §19.17 typu „zastępuje krytyka” (każdy wynik przejrzany).

- [ ] **Step 3: Commit** — `Dokumentacja: krytyk lekcji usunięty (#237)`.

---

### Task 7: Weryfikacja końcowa

- [ ] **Step 1:** `corepack pnpm check` → PASS (typecheck, unit, build).
- [ ] **Step 2:** `corepack pnpm test:integration` → PASS; zanotuj liczbę testów i pominiętych.
- [ ] **Step 3:** `corepack pnpm test:e2e:shards` → PASS (przy `net::ERR_NO_BUFFER_SPACE` powtórz spec osobno i odnotuj; zasady w AGENTS.md).
- [ ] **Step 4:** `grep -rnE "reviewService" apps/web/src packages/contracts/src packages/server/src` → wyłącznie karta pracy / ocena aktywności.
- [ ] **Step 5:** `git status` czysty; `apps/web/next-env.d.ts` bez zmian (przywróć, jeśli zmienił go przebieg dev).
