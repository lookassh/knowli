# Etap 3 PR 2: agent jedynym generatorem lekcji — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Wersja 1 (przed przeglądem trzech krytyków).

**Goal:** Pulę ćwiczeń lekcji generuje i dogenerowuje („Dogeneruj +N”) wyłącznie agent puli; potok, lista `UMIEM_LESSON_AGENT_SUBJECTS` i opcjonalność `agentPolicy` znikają, a bez klucza OpenRouter worker startuje, lekcje kończą się `lesson_agent_unavailable`, a panel to mówi.

**Architecture:** Kolejność zadań trzyma każdy commit w stanie kompilującym się i zielonym: najpierw obowiązkowa polityka i generator fake-agenta (nowe rzeczy obok starych), potem konfiguracja (agent zawsze złożony, potok tylko jako tymczasowa ścieżka bez klucza), potem przeniesienie testów integracyjnych na agenta, dopiero potem usunięcie potoku i portu `generateLessonPool`. Panel, E2E, sonda i dokumentacja na końcu. Reguły zostają tam, gdzie są: wybór i porażka runu w `materials/lessons/lesson-drafts.ts` (`executeLessonGeneration`), składanie w `providers/lesson-agent-env.ts` i kompozycjach, dostępność dla panelu w `lesson-api.ts`. Bez migracji, bez nowych zależności, bez zmian granic modułów i transakcji (`finalizeLessonPoolWrite`).

**Tech Stack:** TypeScript strict, Vitest (unit; integracja na Postgresie w kontenerze), Playwright, React/Mantine (panel rodzica), Zod, oRPC.

**Spec:** `docs/superpowers/specs/2026-11-05-lesson-pool-agent-stage3-design.md` (wersja 3), §1, §3–§8. Mapy kodu (stan 3b4c1ec0, numery linii przybliżone) w `C:\Users\looka\AppData\Local\Temp\claude\C--Users-looka-IdeaProjects-knowli--claude-worktrees-lesson-new-exercise-type-4e7d8f\072948fd-dbf4-49ca-8897-ff5ee18c371d\scratchpad\`: `pr2-map-code.md` (potok i symbole), `pr2-map-tests.md` (klasyfikacja każdego testu integracyjnego), `pr2-map-fake-config.md` (fake, konfiguracja, panel, E2E, sonda). Implementer czyta odpowiednią mapę przed zadaniem.

## Global Constraints

- Gałąź `feature/lesson-pool-agent-stage3-pr2-237` od `main` 3b4c1ec0. Nie wypychać do `main`, nie scalać PR. Push i PR tylko po zgodzie właściciela (Task 13).
- Nigdy `npm install`; tylko `corepack pnpm install --prefer-offline --frozen-lockfile`, i tylko gdy brak `node_modules`.
- Żadnych płatnych wywołań modeli poza Task 12, i tam wyłącznie po wyraźnym „tak” właściciela na konkretną wiadomość z bramki zgody (§6.4). Każde ponowienie wymaga nowej zgody.
- Bez migracji bazy. MCP (`integrations/`, `apps/web/src/integrations`) i `SKILL.md` bez zmian — lekcje nie są w MCP ani `learning-overview`; opis PR to uzasadnia.
- Prywatność (spec §5.5, AGENTS.md): do generatora i checkera nigdy imię, rok urodzenia, identyfikatory ani odpowiedzi dziecka; dzienniki `[lesson-agent]` i `[config]` bez treści ćwiczeń i materiału; klucz tylko w adapterze.
- **Nie usuwać** (spec §4.1): `buildPoolInput` (bez parametrów potoku), `poolStageCounts`, `objectiveBatchCounts`, `minimumCountPerObjective`, `meetsStageMinimums`, `splitStages`, `listenChoiceAllowance`, `LISTEN_CHOICE_PER_OBJECTIVE`, `lessonSystemPrompt`, `lessonUserMaterial`, `lessonPoolJsonSchema`, `finalizeLessonPoolWrite`, `failLessonPoolValidation`, `generateDynamicObjectives`, `markLessonRun`, `lessonRunIsCurrent`, `orderedDraftExercises`, `mergeExamples`, `buildDynamicTopicData`, `withSubjectObjectiveKinds`, `sanitizeFreshLessonDraft`, `scopeFamiliesToRun`, `validatePool*`, `refineGeneratedPool` (hak przedmiotu), `findExposureLeaks`, `isWellShapedRawExercise`, `toExerciseDraft`, `stripParentAddedFlags`, `sumRejectedReasons`, `splitByPoolExtra`, `ORPHAN_KEYWORDS_REASON`, `reasonCount`, `classifyLessonGenerationFailure`, `generationGaps`, `agent_checkpoint`, `withLessonGenerationControl` (`call`, `run`), `UMIEM_LESSON_GENERATION_*`, `UMIEM_LLM_*`, `FakeLlmProvider.generateLessonObjectives`/`generateLessonStory`/`objectiveRequests`/`storyRequests`, `fakeLessonObjectives` (bez `kind`), `prompts.objectivesRules` rozdziału, `LessonAgentPlanInput.objectivesRules`, `DynamicTopicData.objectives[].kind`.
- `withoutRunReports` (`version-ops.ts`) nadal usuwa `review` i `generationGaps`.
- Stałe teksty i identyfikatory (dokładnie):
  - kod błędu runu: `lesson_agent_unavailable`;
  - typ: `export type LessonAgentUnavailable = { readonly unavailable: "no_openrouter_key" };`
  - log startu workera bez klucza (dokładnie jedna linia, `console.log`): `[config] lesson-agent=unavailable reason=no_openrouter_key`;
  - komunikat panelu (`messages.lessons.generationErrors.lesson_agent_unavailable`): „Generowanie lekcji wymaga klucza OpenRouter w konfiguracji serwera. Po dodaniu klucza ponów generowanie.”;
  - pole katalogu: `lessonGenerationAvailable: boolean` (wymagane, w korzeniu `SubjectCatalogDto`).
- Wyszukiwanie: `git grep -nE "<wzorzec>" -- <ścieżki>` (pomija `apps/web/.next` i `*.tsbuildinfo`).
- Po każdym zadaniu `pnpm typecheck` przechodzi (sześć projektów, w tym `tests/**` i `tests/probes`). Testy: unit `pnpm exec vitest run --config vitest.unit.config.ts <ścieżki>`, integracja `pnpm test:integration <plik>`, E2E `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test <spec>` do iteracji.
- Commity po polsku z `(#237)` w tytule, zakończone `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Kod po angielsku, komentarze i dokumentacja po polsku; gęstość komentarzy jak w otaczającym kodzie.

## Rozstrzygnięcia planu (luki i niezgodności specu z kodem)

1. **Indeks i liczba ćwiczeń zagadnienia w wejściu podagenta.** Wejście `LessonObjectiveAgentInput` nie ma pozycji zagadnienia ani liczby jego istniejących ćwiczeń (puste `existingAnswers`/`existingExercises`), a spec §5.2 pkt 1–2 wymaga ziarna z indeksu i przesunięcia „+N” bez stanu. Dodajemy do `objective` dwa pola: `index: number` (pozycja w kolejności lekcji, od 0) i `existingCount: number` (ćwiczenia zagadnienia już w stanie runu: szkic przy „+N” i przyjęte z punktu kontrolnego). Adapter modelu ich nie używa (test w Task 2 pilnuje, że prompt się nie zmienia). Koszt pomyłki: dwa pola w porcie, które czyta tylko fake.
2. **Gdzie żyje generator fake.** Spec mówi „przenosimy do `fake-lesson-agent.ts`”. Między Task 2 a Task 7 generator jest potrzebny jednocześnie `FakeLlmProvider.generateLessonPool` i fake-agentowi, więc trafia do nowego `providers/fake-lesson-pool.ts` (czyste funkcje), a `fake-lesson-agent.ts` z niego korzysta. Po Task 7 importuje go tylko fake-agent.
3. **`GenerationDeps.lessonAgent` w typie zostaje opcjonalne** (`LessonAgentDeps | LessonAgentUnavailable | undefined`), bo `GenerationDeps` składa też web i fabryki testowe. Kontrakt §5.1 („wymagane w workerze”) pilnuje test kompozycji workera, a `executeLessonGeneration` traktuje `undefined` jak `LessonAgentUnavailable` (run `failed`/`lesson_agent_unavailable`, nigdy wyjątek po claimie — dziś `executeLessonAgentGeneration` rzuca `internal` i zostawia run w `running`).
4. **Powody odrzuceń na ścieżce agenta.** Agent od 2a nie zapisuje `rejectedReasons` w szkicu (`{}`); powody żyją w podsumowaniu punktu kontrolnego (`rejectionCodes`). Testy z §6.1 „z powodami” sprawdzają `rejectionCodes` w `generation_runs.agent_checkpoint` (podsumowanie po zapisie albo stan po porażce), a nie `rejectedReasons`. Zmiana domeny (zapis powodów do szkicu) — poza zakresem. Koszt pomyłki: rodzic nadal nie widzi powodów odrzuceń w szkicu, jak dziś na agencie.
5. **`fixtureSubject` w `lesson-agent-outcome.test.ts` już ma politykę** (z `agent-admission-fixtures.ts`) — spec §4.3 się myli; wspólną politykę testową dostają `historyLikeSubject` i fixture'y z niego budowane.
6. **`asAgentCapable` i `AgentCapableSubject` znikają**; ich 12 plików przechodzi na `SubjectModule` (polityka obowiązkowa w typie).
7. **`record` fake-agenta domyślnie `true`** (testy czytają `calls`/`planCalls`); `lessonAgentDepsFromEnv` w trybie fake przekazuje `record: false` (spec §5.2 pkt 5).
8. **Test `lesson-chapter.test.ts:453`** („jedyny nowy przykład = tłumaczeniu ze szkicu”) — DELETE: na agencie przykłady rozdziału pochodzą z planu, nowy przykład w „+N” nie powstaje.
9. **Kolejność sprawdzeń po claimie:** nieznany przedmiot → `failed`/`validation`; potem brak agenta → `failed`/`lesson_agent_unavailable`. Run historyjki rozpoznawany przed claimem (bez zmian) — nie zależy od agenta.
10. **Jeden tekst komunikatu** dla błędu runu i wyłączonych przycisków: `messages.lessons.generationErrors.lesson_agent_unavailable` (bez drugiego klucza).
11. **`deploy/compose.smoke.yaml`**: `smoke.sh` nie tworzy lekcji; mimo to dopisujemy `UMIEM_FAKE_PROVIDERS: "1"` w `web` (spec §5.2), żeby katalog smoke mówił `lessonGenerationAvailable: true`.
12. Martwe drobiazgi z PR 1 (nieużywane identyfikatory zwracane z `applyLessonExercises`, eksport `CHAPTER_FUNCTION_WORDS`) usuwamy w Task 7 razem z potokiem; nawias spec §5.3 o „krytyku” poprawiamy w Task 11.

## Review Focus

1. **Run w kolejce sprzed wdrożenia z polami potoku** (`regenerate.existingAnswers`, `existingExercises`, `purpose` w `input`) przy dostępnym agencie: agent go wykonuje (`succeeded`), dodatkowe klucze ignorowane — test w Task 7, Step 1.
2. **Worker bez klucza i stare runy w kolejce:** każdy run lekcji (pełny i „+N”) kończy się `failed`/`lesson_agent_unavailable` po claimie, nigdy nie zostaje w `running`; run historyjki z kolejki nadal się wykonuje — testy w Task 7, Step 1.
3. **Klucz dodany po porażce:** ręczne „Ponów” runu `lesson_agent_unavailable` (z agentem już dostępnym) daje `succeeded` — test w Task 7, Step 1.
4. **Web z kluczem w złym kształcie** (`OPENROUTER_API_KEY=sk-proj-…`): katalog odpowiada 200 z `lessonGenerationAvailable: false`, web nie rzuca — test w Task 3, Step 1.
5. **„+N” na szkicu rozdziału wygenerowanym kiedyś potokiem** (tytuły „Zagadnienie N: …”, `kind` w `dynamicTopic`, pusty punkt kontrolny): agent w trybie add bierze temat i `kind` ze szkicu i dopisuje ćwiczenia — test w Task 6, Step 3.

---

### Task 1: `agentPolicy` obowiązkowe i wspólna polityka testowa

**Files:**
- Create: `packages/server/src/domain/lessons/testing/test-agent-policy.ts`
- Modify: `packages/server/src/domain/lessons/types.ts` (`agentPolicy` wymagane, doc „brak = nie jest generowany agentem” do usunięcia), `packages/server/src/domain/lessons/registry.ts` (walidacja), `packages/server/src/domain/lessons/testing/history-like-subject.ts`, `packages/server/src/domain/lessons/testing/agent-test-subject.ts` (`defaultPolicy` → import z `test-agent-policy.ts`), `packages/server/src/domain/lessons/agent/capable.ts` (usunąć `asAgentCapable`, `AgentCapableSubject`; `agentObjectivesOf` zostaje), 12 plików z `AgentCapableSubject`/`asAgentCapable` (`git grep -nE "AgentCapableSubject|asAgentCapable"`), miejsca `agentPolicy?.`/`agentPolicy === undefined` z `pr2-map-code.md` §3.4 poza `config.ts` i `lessonGeneratorFor` (te w Task 3/7)
- Test: `packages/server/src/domain/lessons/registry.test.ts`, `packages/server/src/domain/lessons/agent/capable.test.ts` (test „bez polityki → throw” usunąć), `pool-validation.test.ts`, `catalog-validation.test.ts` (typ `Omit<…"agentPolicy">` do uproszczenia), `lesson-pool-agent.test.ts:301` (przypadek „bez polityki” usunąć)

**Interfaces:**
- Produces: `export const testAgentPolicy: SubjectAgentPolicy` w `domain/lessons/testing/test-agent-policy.ts` — ślepe rozwiązanie i warianty dla typów `historyLikeSubject` (`lesson_choice`, `lesson_order`, `lesson_gap`, `lesson_open_answer`), `hintJudgeTypes: []`, `openAnswerCheckTypes: []`, `checkerNeedsMaterial: false`, `independentReserve: 1`, `slack: 2`, `rejectionTexts` jak dzisiejszy `defaultPolicy` w `agent-test-subject.ts`. `historyLikeSubject.agentPolicy === testAgentPolicy`. `SubjectModule.agentPolicy: SubjectAgentPolicy` (wymagane).

- [ ] **Step 1: Test rejestru (czerwony)** w `registry.test.ts`:
  ```ts
  it("każdy przedmiot produkcyjny ma politykę agenta", () => {
    for (const subject of createProductionSubjectRegistry().listSubjects()) expect(subject.agentPolicy).toBeDefined();
  });
  it("przedmiot bez polityki agenta jest odrzucany", () => {
    const broken = { ...historyLikeSubject, agentPolicy: undefined } as unknown as SubjectModule;
    expect(() => createSubjectRegistry([broken])).toThrow(/agentPolicy/);
  });
  it("historyLikeSubject ma wspólną politykę testową", () => {
    expect(historyLikeSubject.agentPolicy).toBe(testAgentPolicy);
  });
  ```
- [ ] **Step 2: Uruchom** `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons/registry.test.ts` — FAIL (brak `testAgentPolicy`, brak walidacji).
- [ ] **Step 3: Zaimplementuj** `test-agent-policy.ts`, pole w `historyLikeSubject`, `agent-test-subject.ts` na nowej stałej, walidację w `createSubjectRegistry` (komunikat zawiera `agentPolicy` i id przedmiotu), typ wymagany, usunięcie `asAgentCapable`/`AgentCapableSubject` i opcjonalnego łańcucha (`policy?.x` → `policy.x`; pola wewnątrz polityki, np. `hintJudgeTypes?`, zostają opcjonalne).
- [ ] **Step 4: Uruchom** `pnpm typecheck` i `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/domain/lessons packages/server/src/modules/materials/lessons` — PASS. Integracja z `historyLikeSubject` w rejestrze: `pnpm test:integration tests/integration/child-interests.test.ts` — PASS (przedmiot ma teraz politykę, nadal idzie potokiem, bo nie ma go na liście).
- [ ] **Step 5: Commit** „Przedmioty lekcji: polityka agenta obowiązkowa (#237)”.

### Task 2: Generator fake-agenta

**Files:**
- Create: `packages/server/src/providers/fake-lesson-pool.ts`, `packages/server/src/providers/fake-lesson-pool.test.ts`
- Modify: `packages/server/src/providers/fake.ts` (funkcje generatora z `pr2-map-fake-config.md` §1.5 przenoszone do `fake-lesson-pool.ts`; `generateLessonPool` woła je stamtąd), `packages/server/src/providers/fake-lesson-agent.ts`, `packages/server/src/ports/ai.ts` (`LessonObjectiveAgentInput.objective.index`, `.existingCount`), `packages/server/src/modules/materials/lessons/lesson-pool-agent-input.ts` (wypełnia oba pola), `packages/server/src/index.ts` (eksport `FAKE_SLOW_MARKER` z nowego miejsca, jeśli stała się przenosi)
- Test: `packages/server/src/providers/fake-lesson-agent.test.ts`, `packages/server/src/modules/materials/lessons/lesson-pool-agent-input.test.ts`, `packages/server/src/providers/openai/lesson-pool-agent.test.ts` (prompt bez `index`/`existingCount`)

**Interfaces:**
- Produces (w `fake-lesson-pool.ts`): `fakeObjectiveExercises(input: LessonObjectiveAgentInput, offset: number, counts?: Partial<Record<"guided" | "productive" | "independent", number>>): { exercises: unknown[]; examples?: string[] }` — surowe rekordy po `materializeGeneratedCalculations`, tylko dla `input.objective`; przykłady pominięte, gdy `objective.examplesFromPlan`. Ziarno numeracji: `offset`. Gałąź rozdziału (`fakeChapterPool`) i pól szkoły (`schoolFieldsForFake`), wyjaśnienia (`FAKE_EXPLANATION` przy `pool.exerciseExplanations`), `voiceTone: "curious"` przy `pool.voiceTones`, `targets.listenAllowance` ćwiczeń `lesson_listen_choice`, polecenie open_answer zaczyna się od „Przetłumacz”, przykłady `Example for <id>.` — jak dziś. Stałe `FAKE_SLOW_MARKER`, `FAKE_SLOW_DELAY_MS`, `FAKE_EXPLANATION` eksportowane stąd (`fake.ts` je reeksportuje do Task 7).
- Produces (w `fake-lesson-agent.ts`): nowy krok `FakeAgentStep` `{ generate: true }` (jedno zgłoszenie generatora); opcje `FakeLessonPoolAgentOptions.generate?: { delayMs?: number }` (zagadnienie bez skryptu dostaje pętlę generatora; planista bez `plans` używa `fakePlanFromCoverage`) i `record?: boolean` (domyślnie `true`; `false` = `calls`/`planCalls` nie rosną). `fromLlm` zostaje do Task 8.
- Produces (port): `LessonObjectiveAgentInput.objective.index: number`, `.existingCount: number`.

Pętla generatora (spec §5.2 pkt 3–4), dla zagadnienia bez skryptu przy `generate`:
- krok 1: `fakeObjectiveExercises(input, input.objective.index * 1000 + input.objective.existingCount)` z liczbami z `pool.stageCounts`;
- po każdym `tools.submit` czyta wynik: `complete === true` → koniec; inaczej kolejny krok z `offset += 100` i liczbami etapów `max(0, targets[stage] - counts[stage])` (gdy wszystkie zero, a `complete === false` — pełne `stageCounts`), dopóki `steps < input.maxSteps`;
- opóźnienie każdego kroku `delayMs`; pierwszy krok, gdy `pool.material` zawiera `FAKE_SLOW_MARKER`: `max(delayMs, FAKE_SLOW_DELAY_MS)`; sen przerywa `signal` (`rejectOnAbort`).

- [ ] **Step 1: Testy (czerwone)** w `fake-lesson-pool.test.ts` i `fake-lesson-agent.test.ts`:
  - „zagadnienia lekcji gramatyki mają rozłączne odpowiedzi i bodźce” — trzy wejścia z `index` 0/1/2 i `existingCount: 0` dla trzech zagadnień `present_simple`; suma tożsamości ćwiczeń (`lessonExerciseIdentity`) bez powtórzeń;
  - to samo dla rozdziału (materiał `CHAPTER_MATERIAL` z `lesson-agent-generation.test.ts`) i szkoły;
  - „+N: przesunięcie z existingCount” — `existingCount: 20` daje ćwiczenia rozłączne z `existingCount: 0`;
  - „pętla generatora robi kolejny krok, gdy wynik narzędzia ma braki”: narzędzia testowe zwracają `{ complete: false, missing: ["independent: 0 of 3"], counts: {…independent: 0} }` po pierwszym i `complete: true` po drugim → `calls[0].outcomes.length === 2`; przy stale `complete: false` liczba kroków = `maxSteps`;
  - „FAKE_SLOW_MARKER opóźnia tylko pierwszy krok” (`vi.useFakeTimers`; pierwszy krok czeka 3000 ms, drugi `delayMs`);
  - „abort przerywa sen” — `AbortController.abort()` w trakcie snu 3 s → `runObjective` odrzuca w < 100 ms czasu fałszywego zegara;
  - „record: false nie zapisuje historii” — `calls.length === 0`, `planCalls.length === 0` po przebiegu;
  - „planista bez plans przy generate daje plan z pokrycia” — `planCalls[0].proposals[0]` równe `fakePlanFromCoverage(input)`;
  - w `lesson-pool-agent-input.test.ts`: `objective.index` = pozycja w kolejności lekcji, `existingCount` = liczba ćwiczeń zagadnienia w `fixed` + przyjętych;
  - w `openai/lesson-pool-agent.test.ts`: prompt podagenta nie zawiera `index` ani `existingCount` (porównanie z wejściem bez tych pól).
- [ ] **Step 2: Uruchom** testy z Step 1 — FAIL.
- [ ] **Step 3: Zaimplementuj** `fake-lesson-pool.ts` (przeniesienie z `fake.ts`; numeracja startuje od `offset` zamiast `existingExercises?.length`), pola portu i ich wypełnienie, krok `generate`, pętlę, opóźnienia, `record`.
- [ ] **Step 4: Uruchom** `pnpm typecheck` i `pnpm exec vitest run --config vitest.unit.config.ts packages/server/src/providers packages/server/src/modules/materials/lessons` — PASS (także stare testy `fake.test.ts`).
- [ ] **Step 5: Commit** „Fake agenta puli: generator ćwiczeń z pętlą kroków i opóźnieniami (#237)”.

### Task 3: Konfiguracja bez listy przedmiotów; brak klucza nie zatrzymuje workera

**Files:**
- Modify: `packages/server/src/config.ts` (usunąć `agentSubjectIds`, `lessonAgentSubjectsFromEnv`, `subjects` z `LessonAgentDeps`/`LessonAgentSettings`/`LessonAgentPublic`; dodać `LessonAgentUnavailable`; `GenerationDeps.lessonAgent?: LessonAgentDeps | LessonAgentUnavailable`; `lessonAgentSettingsFromEnv(env)` waliduje zawsze; `lessonAgentPublicFromEnv(env)`), `packages/server/src/config-defaults.ts` (bez `UMIEM_LESSON_AGENT_SUBJECTS`), `packages/server/src/providers/lesson-agent-env.ts`, `packages/server/src/providers/generation-env.ts` (eksport parsowania opóźnień fake, jeśli współdzielone), `apps/worker/src/composition.ts`, `apps/web/src/composition.ts`, `packages/server/src/modules/materials/lessons/lesson-agent-outcome.ts` (`lessonGeneratorFor`), `packages/server/src/modules/materials/lessons/lesson-api.ts` (`agentServicesOf` bez warunku listy; `lessonCatalog` dodaje `lessonGenerationAvailable`), `packages/contracts/src/lessons.ts` (`lessonGenerationAvailable: z.boolean()` w korzeniu `SubjectCatalogDtoSchema`; komentarz `generationService`), `.env.example` (linie o liście)
- Test: `packages/server/src/config.test.ts`, `packages/server/src/providers/lesson-agent-env.test.ts`, `apps/worker/src/composition.test.ts`, `apps/web/src/composition.test.ts`, `packages/server/src/modules/materials/lessons/lesson-api.test.ts`, `packages/server/src/modules/materials/lessons/lesson-agent-outcome.test.ts` (`lessonGeneratorFor`), `packages/contracts/src/lessons.test.ts`, `apps/web/src/orpc/parent-router.test.ts`, `tests/integration/lesson-parent-api.test.ts` (katalog), `tests/integration/lesson-agent-generation.test.ts:720` (składanie z env)

**Interfaces:**
- Consumes: `FakeLessonPoolAgent({ generate, record })` z Task 2.
- Produces:
  - `lessonAgentDepsFromEnv(env: Record<string, string | undefined>, usage?: UsageRecorder): LessonAgentDeps | LessonAgentUnavailable` (bez `subjects` i `llm`); tryb fake: `{ agent: new FakeLessonPoolAgent({ generate: { delayMs }, record: false }), checker: new FakeExerciseChecker({ unavailable: true }), policy }`, `delayMs = Number(UMIEM_FAKE_LESSON_DELAY_MS ?? UMIEM_FAKE_DELAY_MS ?? 0)` (NaN → 0), bez klucza i bez gradera; poza fake: brak klucza → `{ unavailable: "no_openrouter_key" }` (bez logu w tej funkcji), klucz w złym kształcie → wyjątek jak dziś.
  - `lessonAgentSettingsFromEnv(env): LessonAgentSettings | undefined` — walidacja modeli, wysiłku, routingu, rodziny i liczb **przed** kluczem i zawsze; `undefined` tylko przy braku klucza; `console.warn` znika.
  - `lessonAgentPublicFromEnv(env): LessonAgentPublic | undefined` — fake → etykiety fake; inaczej `undefined`, gdy `lessonAgentKeyFromEnv` zwraca `undefined` albo rzuca; nie rzuca nigdy. `Services.lessonAgentPublic` bez `subjects`.
  - `isLessonAgentAvailable(agent: GenerationDeps["lessonAgent"]): agent is LessonAgentDeps` (eksport z `config.ts`; `undefined` i `LessonAgentUnavailable` → `false`).
  - `lessonGeneratorFor(agent: GenerationDeps["lessonAgent"]): "agent" | "pipeline"` — tymczasowo „pipeline” tylko bez agenta (znika w Task 7).
  - Katalog: `lessonGenerationAvailable = services.lessonAgentPublic !== undefined`; opisy usług agenta (`generationServices`, `checkService`, `checkServiceIncludesMaterial`, `openCheckService`) tylko przy `true`, dla każdego przedmiotu. Korzeniowe `generationService` (usługa `UMIEM_LLM_*`) zostaje: zagadnienia szkoły, historyjka gramatyki (oba w `generationServices` przedmiotu jak dziś) i awaryjny adresat tematów zdań w formularzu.
  - Fixture'y katalogu w E2E `mocked` (`parent-lessons-layout`, `parent-lesson-editor-layout`, `parent-sources-layout`, `parent-source-vocabulary-layout`, `parent-deck-editor-layout`, `parent-lesson-voice-tone`) dostają `lessonGenerationAvailable: true` już w tym zadaniu.
  - Worker: `buildWorkerServices` zawsze ustawia `generation.lessonAgent`; przy `LessonAgentUnavailable` jeden `console.log("[config] lesson-agent=unavailable reason=no_openrouter_key")`.

- [ ] **Step 1: Testy (czerwone):**
  - `config.test.ts`: walidacja bez listy (zła wartość `UMIEM_LESSON_AGENT_MAX_STEPS=abc` rzuca z nazwą zmiennej także bez klucza); `UMIEM_LESSON_AGENT_SUBJECTS=english_grammar` w env nie zmienia wyniku; brak klucza → `undefined`; `lessonAgentPublicFromEnv({ OPENROUTER_API_KEY: "sk-proj-abc" })` → `undefined` bez wyjątku (Review Focus 4); fake bez klucza → etykiety fake. Usunąć testy listy (pusta lista, nieznany przedmiot, bez polityki, duplikaty).
  - `lesson-agent-env.test.ts`: bez klucza → `{ unavailable: "no_openrouter_key" }`; fake bez klucza → `FakeLessonPoolAgent`, `record === false`, `delayMs` z `UMIEM_FAKE_LESSON_DELAY_MS`; z kluczem → adaptery AI SDK; grader 2b jak dziś.
  - `apps/worker/src/composition.test.ts`: (a) z kluczem `sk-or-test` → `generation.lessonAgent` to `LessonAgentDeps`; (b) bez klucza, poza fake (z `OPENAI_API_KEY` dla obrazów) → worker się składa, `lessonAgent` równe `{ unavailable: "no_openrouter_key" }`, `console.log` wywołany dokładnie raz z linią z Global Constraints; (c) fake bez klucza → `LessonAgentDeps`, brak linii `[config]`.
  - `apps/web/src/composition.test.ts`: fake bez klucza → `services.lessonAgentPublic` zdefiniowane; poza fake bez klucza → `undefined`.
  - `lesson-api.test.ts`: `lessonCatalog` bez `lessonAgentPublic` → `lessonGenerationAvailable: false`, przedmioty bez `generationServices`/`checkService`; z nim → `true` i usługi dla **każdego** przedmiotu (bez listy).
  - `lessons.test.ts`: katalog bez `lessonGenerationAvailable` odrzucony; z polem przechodzi (dopisać pole we wszystkich istniejących `parse`).
- [ ] **Step 2: Uruchom** testy z Step 1 — FAIL.
- [ ] **Step 3: Zaimplementuj** zgodnie z Interfaces. `executeLessonGeneration` wybiera agenta przez `lessonGeneratorFor(deps.lessonAgent)`; bez agenta nadal potok (stan przejściowy do Task 7). Web: wszystkie miejsca budujące katalog w testach jednostkowych web (`new-lesson-form.test.tsx`, `sources-panel.test.tsx`, `lesson-service-info.test.ts`) dostają `lessonGenerationAvailable: true`.
- [ ] **Step 4: Uruchom** `pnpm typecheck`, unit z Files, `pnpm test:integration tests/integration/lesson-agent-generation.test.ts tests/integration/lesson-parent-api.test.ts` — PASS. Testy „przedmiot spoza listy → potok” (`lesson-agent-generation.test.ts:629, 662`) usunąć w tym zadaniu (lista znika); `:676, :688, :705` przenieść na agenta (`:688` — stary klucz `review` → `succeeded`, klucz zostaje, DTO bez `review`; `:705` — `attempts > MAX` → `attempts_exhausted`, `agent.calls` puste; `:676` — nowy szkic agenta bez klucza `review`).
- [ ] **Step 5: Commit** „Agent puli: bez listy przedmiotów, worker bez klucza OpenRouter startuje (#237)”.

### Task 4: Fake'i integracyjne na agencie; `lesson-agent-generation.test.ts` bez `fromLlm`

**Files:**
- Modify: `tests/integration/fakes.ts` (`fakeGeneration()` dokłada `lessonAgent`; zwraca uchwyt `agent: FakeLessonPoolAgent`; `routeLessonRound`/`LessonPoolRequest` zostają do Task 6), `tests/integration/lesson-agent-generation.test.ts`
- Test: ten sam plik

**Interfaces:**
- Consumes: Task 2 (`generate`, `{ generate: true }`, `fakeObjectiveExercises`), Task 3 (`LessonAgentDeps` bez `subjects`).
- Produces: `fakeGeneration(options?: { withAgent?: boolean; agent?: FakeLessonPoolAgentOptions; checker?: FakeExerciseChecker; policy?: Partial<LessonAgentPolicy> }): Promise<FakeGeneration & { agent: FakeLessonPoolAgent }>` — przy `withAgent: true` `fakes.deps.lessonAgent` = `{ agent: new FakeLessonPoolAgent({ generate: {}, ...options.agent }), checker: options.checker ?? new FakeExerciseChecker({ unavailable: true }), policy: options.policy ?? {} }`; bez niej `lessonAgent` nieustawione (pliki jeszcze nieprzeniesione idą potokiem). Uchwyt `agent` zwracany zawsze. Opcję `withAgent` usuwa Task 6 (agent domyślny).

- [ ] **Step 1:** W `lesson-agent-generation.test.ts` zamień `fromLlm: fakes.llm` w `agentWorld` na `generate: {}` (składanie przez `fakeGeneration({ withAgent: true, … })` albo jak dziś ręcznie), kroki `llmStep(fakes.llm)` na `{ generate: true }`, a wrappery `oneFamily`, `addGenerator`, `openPool` na `fakeObjectiveExercises(input, offset, counts)` (offset jak dziś przez fałszywe `existingExercises`). `AgentScript` traci wariant funkcji od `fakes`. Asercje `fakes.llm.lessonRequests` → `agent.calls`.
- [ ] **Step 2:** `fakes.ts` jak w Interfaces.
- [ ] **Step 3: Uruchom** `pnpm test:integration tests/integration/lesson-agent-generation.test.ts` — PASS; `pnpm test:integration` — PASS (pozostałe pliki bez `withAgent` bez zmian zachowania).
- [ ] **Step 4: Commit** „Testy agenta puli bez fake'a LLM potoku (#237)”.

### Task 5: `lesson-generation.test.ts` na ścieżce agenta

**Files:**
- Modify: `tests/integration/lesson-generation.test.ts`

**Interfaces:**
- Consumes: `fakeGeneration({ withAgent: true, agent: { objectives: { <slug>: [...] } } })`; `withAgentPolicy` z `domain/lessons/testing/agent-test-subject.ts`; `rejectionCodes` z `agent_checkpoint` (Rozstrzygnięcie 4).

- [ ] **Step 1:** Każdy test wg tabeli `pr2-map-tests.md` §1:
  - **DELETE** (usuń z helperami `MAIN_BATCH_ONLY`, `hangLessonRequests`, importem `routeLessonRound`): 324, 430, 726, 745, 786, 1017, 1711, cały blok „dogenerowanie pod brakujący etap” (1755–2046) i `describe FakeLlmProvider.generateLessonPool` (2062);
  - **KEEP**: 135, 172, 184, 696, 948, 979, 1119 — tylko składanie przez `fakeGeneration({ withAgent: true })`;
  - **PORT** pozostałe (lista z mapy, każdy z decyzją tam zapisaną): asercje `fakes.llm.lessonRequests[i].X` → `fakes.agent.calls[i].input.pool.X` albo `input.targets.X`; testy z `queueLesson`/wrapperem `generateLessonPool` → skrypt `objectives: { <slug>: [{ submit: { exercises, examples } }] }`; `rejectedReasons`/`rejectedCount` po wadliwym wejściu → `rejectionCodes` w punkcie kontrolnym; logi `[lesson] walidacja puli:`/`ujawnienia:`/`sanityzacja wariantów:`/`porzucone wyjaśnienia=` — asercje usuń, zostaje `[lesson] run=… zakończony`. Testy `test_history` (1049, 1077) działają na `historyLikeSubject` z polityką z Task 1. `generatedLessonDraft` i dwa testy zgodności starych danych (1540, 1562) zostają.
  - Test „0 poprawnych” i „pełne odrzucenie” sprawdzają `failed`/`validation` i niepuste `rejectionCodes`.
- [ ] **Step 2: Uruchom** `pnpm test:integration tests/integration/lesson-generation.test.ts` — PASS, i `git grep -nE "lessonRequests|queueLesson|MAIN_BATCH_ONLY|routeLessonRound|generateLessonPool" -- tests/integration/lesson-generation.test.ts` — pusto.
- [ ] **Step 3: Commit** „Testy generowania lekcji na ścieżce agenta (#237)”.

### Task 6: Rozdział, pliki pomocnicze i domyślny agent w fake'ach integracyjnych

**Files:**
- Modify: `tests/integration/fakes.ts` (agent domyślnie; usunąć opcję `withAgent`, `routeLessonRound`, `LessonPoolRequest`), `tests/integration/lesson-chapter.test.ts`, `tests/integration/lesson-chapter-sentence-audio.test.ts`, `tests/integration/school-lesson-audio-helpers.ts` (albo nowy `tests/integration/chapter-lesson-helpers.ts`: `seedChapterDraft`), oraz wg `pr2-map-tests.md` §4: `lesson-story.test.ts`, `child-interests.test.ts`, `lesson-listen-choice.test.ts`, `source-materials.test.ts`, `lesson-parent-api.test.ts`, `lesson-error-explanation.test.ts`, `lesson-story-audio.test.ts`, `publish-media-reconcile.test.ts`, `grammar-without-tts.test.ts`, `lesson-sentence-audio.test.ts`, `provider-usage-scope.test.ts`, `generation.test.ts`

**Interfaces:**
- Produces: `seedChapterDraft(services: Services, args: { material: string; objectives: { id: string; titlePl: string; kind: "words" | "frame"; cards: …; exercises: unknown[] }[]; examples: Record<string, string[]> }): Promise<{ deckId: string; versionId: string }>` — szkic rozdziału wprost w bazie (wzorzec `seedSchoolDraft`), z `dynamicTopic` i `lesson_context.examples`.

- [ ] **Step 1:** `fakes.ts`: agent zawsze (domyślny `generate: {}`), uchwyt `fakes.agent`.
- [ ] **Step 2:** `lesson-chapter.test.ts` wg `pr2-map-tests.md` §2: DELETE 409, 453 (Rozstrzygnięcie 8), 593, część „+N bez rundy” z 627; KEEP 691, 708 (rodzaje `["words","words","frame"]`, po usunięciu pierwszego `["words","frame"]`), 734, 749, część edycji z 627; PORT pozostałe — 118 (rodzaje z planisty fake'a, `coverage === []` na każdym zagadnieniu, `rejectedCount === 0`), 163 i 231 (słowo spoza materiału na slugach `part_1`/`part_2` przez `plans` i skrypty; 231: `failed`/`validation`, kody odrzuceń w `rejectionCodes`, potem „Ponów” z poprawnym skryptem → `succeeded`), 328/352 (przykład z `plans[].examples`), 375/558 (skrypty `{ calls: [...] }` przy „+N”), 492/552 (`agent.calls[i].input.cardSentences` i `pool.avoidSentences`), 532, 683; blok sesji dziecka (780–1084) przez `seedChapterDraft` (bez generacji).
- [ ] **Step 3: Test (Review Focus 5)** w `lesson-chapter.test.ts`: „+N na szkicu rozdziału sprzed agenta” — `seedChapterDraft` z tytułami „Zagadnienie 1: Ubrania”, `kind` `words`/`frame`, bez `agent_checkpoint`; `regenerateObjective(count: 4)` dla pierwszego zagadnienia; `executeLessonGeneration` → `succeeded`, liczba ćwiczeń zagadnienia rośnie o ≥ 4, `agent.calls[0].input.objective.kind === "words"`, `dynamicTopic` szkicu bez zmian.
- [ ] **Step 4:** Pliki pomocnicze wg `pr2-map-tests.md` §4 (decyzje tam zapisane). Ustalenia: `grammar-without-tts` — zamiast stałych 22 asercja `assets.length === draft.exercises.length` i 2 ćwiczenia słuchowe; `lesson-listen-choice` — skrypt zwracający 5 słuchowych → w szkicu najwyżej `listenAllowance`, reszta jako kod `limit_listen` w `rejectionCodes`; `lesson-chapter-sentence-audio` — szkic przez `seedChapterDraft` (bez `MAIN_BATCH_ONLY` i podmiany `generateLessonPool`); `provider-usage-scope` — `fakeGeneration({ agent: { generate: {}, usage: recorder } })`, wiersze kosztu runu lekcji z operacjami `agent_objective` (i `agent_plan` dla rozdziału); `generation.test.ts` — szpieg na `fakes.agent.runObjective`; `child-interests` — `agent.calls[*].input.pool.interests` i serializacja `JSON.stringify(agent.calls.map(c => c.input))` bez imienia, roku i id.
- [ ] **Step 5: Test „tryb fake z env” (spec §5.2)** w `lesson-agent-generation.test.ts` (rozwinięcie dzisiejszego testu składania z env, l.~720): usługi z `generation: { ...fakes.deps, lessonAgent: lessonAgentDepsFromEnv({ UMIEM_FAKE_PROVIDERS: "1" }) }` (brak klucza w env); (a) gramatyka `present_simple` z trzema zagadnieniami (`question`, `negative`, `short_answers`), pula 60 → `succeeded`, brak `generationGaps`, `publishLessonDraft` przechodzi, tożsamości ćwiczeń bez powtórzeń; (b) rozdział na materiale `CHAPTER_BODY` z `tests/e2e/parent-sources.spec.ts` (skopiuj stałą), pula 40 → to samo, ≥ 3 zagadnienia z `kind`; (c) szkoła na `SCHOOL_MATERIAL` → to samo; (d) „+N” = 6 na pierwszym zagadnieniu gramatyki → przybywa ≥ 6 ćwiczeń, bez duplikatów tożsamości w całej lekcji.
- [ ] **Step 6: Uruchom** `pnpm test:integration` (całość) — PASS; `git grep -nE "lessonRequests|queueLesson|queueLessonTopUp|MAIN_BATCH_ONLY|routeLessonRound|stageTopUp|generateLessonPool|withAgent" -- tests/integration` — pusto.
- [ ] **Step 7: Commit** „Testy integracyjne lekcji na agencie; szkic rozdziału z zasiewu (#237)”.

### Task 7: Usunięcie potoku; `lesson_agent_unavailable`

**Files:**
- Modify: `packages/server/src/modules/materials/lessons/lesson-drafts.ts` (ciało potoku i symbole z spec §3 „Potok w lesson-drafts.ts” — lista z liniami w `pr2-map-code.md` §1.5; `regenerateObjective` bez `existingAnswersOf`/`existingExercisesOf`; `LessonRunInput.regenerate: { objectiveId: string; count: number }`; `finalizeLessonPoolWrite.onSuccessTransaction` wymagane; nagłówek pliku; martwe drobiazgi z PR 1), `lesson-agent-outcome.ts` (`lessonGeneratorFor` znika), `lesson-agent-generation.ts` (`throw AppError("internal", "lesson agent not configured")` znika — sprawdzenie jest w `executeLessonGeneration`), `lesson-pool-acceptance.ts` (`acceptFreshLessonPool`, `FreshPoolInput`, `FreshPoolResult`), `domain/lessons/exposure-leaks.ts` (`resolveGenerationLeaks`, `GenerationLeakResolution`), `domain/lessons/lesson-coverage.ts` (`stageDeficits`, `StageDeficits`), `lesson-generation-control.ts` (`callSoft`, parametr `soft`), `lesson-generation-policy.ts` (`stageTopUp`)
- Test: `tests/integration/lesson-agent-generation.test.ts` (nowy `describe("brak agenta (#237 etap 3)")`), `lesson-drafts.test.ts` (testy usuniętych funkcji; test przydziału słuchowych przy istniejących ćwiczeniach → wprost na `listenChoiceAllowance`), `lesson-pool-acceptance.test.ts` (describe `acceptFreshLessonPool`), `exposure-leaks.test.ts` (175–311), `lesson-coverage.test.ts` (177–216), `lesson-generation-control.test.ts` (44–73), `lesson-generation-policy.test.ts`, `lesson-agent-outcome.test.ts` (`lessonGeneratorFor`, fixture `regenerate` bez `existingAnswers`)

**Interfaces:**
- Produces: `executeLessonGeneration` po claimie: `subject === undefined` → `failed`/`validation`; `!isLessonAgentAvailable(deps.lessonAgent)` → `markCurrentRun` z `state: "failed"`, `errorCode: "lesson_agent_unavailable"`, bez `nextAttemptAt` (nieponawialny), bez odczytu punktu kontrolnego i wywołań modeli; inaczej `executeLessonAgentGeneration` (z `lessonRunIsCurrent` jak dziś). `classifyLessonGenerationFailure` bez zmian.

- [ ] **Step 1: Testy (czerwone)** w `lesson-agent-generation.test.ts`, `describe("brak agenta (#237 etap 3)")` — usługi z `generation: { ...fakes.deps, lessonAgent: { unavailable: "no_openrouter_key" } }` oraz osobno `lessonAgent: undefined`:
  - pełna generacja gramatyki: run `failed`, `errorCode === "lesson_agent_unavailable"`, `attempts === 1`, `nextAttemptAt === null`; `fakes.agent.calls`, `fakes.llm.objectiveRequests`, `fakes.llm.storyRequests` puste; szkic bez ćwiczeń i z `editNumber` sprzed runu; brak runów historyjki (`storyRunStates` puste); stan nie `queued` ani `running` (Review Focus 2);
  - lekcja szkoły: zero wywołań `generateLessonObjectives`;
  - „+N”: run `failed`/`lesson_agent_unavailable`, szkic i `editNumber` bez zmian;
  - run historyjki w kolejce przy braku agenta → wykonany (`succeeded`) (Review Focus 2);
  - nieznany przedmiot przy braku agenta → `failed`/`validation`;
  - „Ponów” po dodaniu klucza: run `failed`/`lesson_agent_unavailable`, `retryGeneration`, usługi z dostępnym fake-agentem → `succeeded` (Review Focus 3);
  - run w kolejce z wejściem potoku (`regenerate: { objectiveId, count: 4, existingAnswers: ["x"], existingExercises: [{…}] }`, oraz pełny run z `purpose: "pool"`) zapisanym wprost w `generation_runs.input` → agent wykonuje, `succeeded` (Review Focus 1).
- [ ] **Step 2: Uruchom** — FAIL (bez agenta potok generuje).
- [ ] **Step 3: Usuń** potok i symbole z Files; zaimplementuj sprawdzenie. `git grep -nE "stageTopUpRound|StageTopUpContext|batchesForObjectives|trimToStageDeficits|STAGE_TOP_UP|EXPOSURE_LEAK_REASON|withinStageQuotas|capListenChoiceOverflow|ObjectiveGenerationLimits|collectBatchExerciseMetadata|filterExercisesToRequestedObjective|summarizeLessonPoolValidation|refineGeneratedDrafts|existingAnswersOf|existingExercisesOf|uniqueStimuli|acceptFreshLessonPool|resolveGenerationLeaks|stageDeficits|callSoft|stageTopUp|lessonGeneratorFor" -- packages apps tests` — pusto.
- [ ] **Step 4: Uruchom** `pnpm typecheck`, unit `packages/server/src`, `pnpm test:integration` — PASS.
- [ ] **Step 5: Commit** „Lekcje: agent jedynym generatorem, potok usunięty; brak klucza → lesson_agent_unavailable (#237)”.

### Task 8: Port i adaptery bez `generateLessonPool`

**Files:**
- Modify: `packages/server/src/ports/ai.ts` (`LlmProvider.generateLessonPool`; `LessonPoolInput.purpose|existingAnswers|existingExercises`; `LessonObjectivesInput.objectivesRules`), `packages/server/src/providers/openai/llm.ts` (`generateLessonPool`, `lessonExamplesToRecord`, bloki promptu istniejących odpowiedzi/ćwiczeń — zdanie „Within this response…” zostaje; `kind` w `lessonObjectivesJsonSchema`, zdania o `kind` i „Subject rules for objectives” w `lessonObjectivesSystemPrompt`), `packages/server/src/providers/fake.ts` (`generateLessonPool`, `queueLesson`, `queueLessonTopUp`, `#lessonBehaviors`, `#lessonTopUpBehaviors`, `lessonRequests`, `LlmLessonBehavior`, `fakeInvalidExercise`, `kind` w `fakeLessonObjectives`, reeksporty stałych), `packages/server/src/providers/fake-lesson-agent.ts` (`fromLlm`), `lesson-drafts.ts` (`buildPoolInput` bez `existingAnswers`, `existingExercises`, `purpose`; `generateDynamicObjectives` bez `objectivesRules`), `lesson-pool-agent-input.ts` (wywołanie `buildPoolInput`), `packages/server/src/index.ts` (eksporty `LlmLessonBehavior`, stałych), `packages/server/src/providers/usage-recording.architecture.test.ts` (liczba wywołań zapisu w `llm.ts`), `tests/probes/chapter-generation.probe.test.ts` (tylko kompilacja: usunąć wrapper `generateLessonPool`; pełna zmiana sondy w Task 10)
- Test: `packages/server/src/providers/openai/llm.test.ts` (testy treści promptu przez `generateLessonPool` → `lessonSystemPrompt`/`lessonUserMaterial` bez utraty asercji o treści, spec §4.2; testy `objectivesRules` → asercja, że prompt zagadnień nie zawiera „Subject rules for objectives” ani `kind`), `packages/server/src/providers/fake.test.ts` (testy generatora przeniesione do `fake-lesson-pool.test.ts` w Task 2 — tu usunąć), `packages/server/src/providers/lesson-calculations.test.ts` (materializacja rachunków przez `fakeObjectiveExercises` i adapter agenta — spec §4.2), `fake-lesson-agent.test.ts` (sekcja `fromLlm` 634–790 → odpowiedniki na `generate`), `lesson-drafts.test.ts` (indeksy parametrów `buildPoolInput`)

**Interfaces:**
- Produces: `buildPoolInput(subject, topic, objectiveId, count, material, instruction, graderAvailable, interests?: readonly string[], options: { avoidSentences?: readonly string[] } = {}): LessonPoolInput`; `listenChoiceAllowance(subject, objective, [])` w środku.

- [ ] **Step 1:** Przenieś testy promptu i rachunków (najpierw, przy żywej metodzie, żeby asercje przeszły na nowym API).
- [ ] **Step 2: Uruchom** przeniesione testy — PASS.
- [ ] **Step 3:** Usuń symbole z Files. `git grep -nE "generateLessonPool|lessonExamplesToRecord|queueLesson|lessonRequests|LlmLessonBehavior|fromLlm|existingAnswers|existingExercises|objectivesRules" -- packages apps tests` — zostają tylko: `prompts.objectivesRules` rozdziału, `LessonAgentPlanInput.objectivesRules`, `withSubjectObjectiveKinds` i ich testy; komentarze w `openai/lesson-pool-agent.ts` „jak generateLessonPool” przepisz.
- [ ] **Step 4: Uruchom** `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration tests/integration/lesson-agent-generation.test.ts tests/integration/lesson-generation.test.ts` — PASS.
- [ ] **Step 5: Commit** „Port LLM bez puli lekcji; testy promptu na lessonSystemPrompt (#237)”.

### Task 9: Panel rodzica — dostępność generowania

**Files:**
- Modify: `packages/contracts/src/messages.ts` (`lessons.generationErrors.lesson_agent_unavailable`; `themesService`/`themesServiceUnknown` — dopisek o checkerze), `apps/web/src/parent/lessons/NewLessonForm.tsx` (przy `catalog?.lessonGenerationAvailable === false`: `Alert` z komunikatem, `data-testid="lesson-generation-unavailable"`, przycisk `lesson-create-submit` wyłączony; `canSubmitLesson` uwzględnia pole), `apps/web/src/parent/lessons/LessonEditor.tsx` („Dogeneruj”: `regenDisabled` także przy `false`, komunikat w modalu i przy przycisku `regen-open-*`; „Ponów generowanie” runów lekcji `generation-retry` i `retry-stalled-generation` wyłączone przy `false` z komunikatem `data-testid="generation-unavailable"`; runy historyjki bez zmian), `apps/web/src/parent/lessons/LessonSupervisionPanel.tsx` (`pool-regen-*` wyłączone), `apps/web/src/parent/sources/SourcePage.tsx` (tworzenie lekcji ze źródła wyłączone), `apps/web/src/parent/lessons/lesson-service-info.ts`
- Test: `apps/web/src/parent/lessons/new-lesson-form.test.tsx`, `apps/web/src/parent/sources/sources-panel.test.tsx`, test edytora (istniejący plik testów `LessonEditor`, jeśli jest; inaczej E2E niżej), E2E `mocked`: `tests/e2e/parent-lessons-layout.spec.ts`, `tests/e2e/parent-lesson-editor-layout.spec.ts`, `tests/e2e/parent-sources-layout.spec.ts` (nowe przypadki z `lessonGenerationAvailable: false`)

**Interfaces:**
- Consumes: `SubjectCatalogDto.lessonGenerationAvailable` (Task 3).
- Tekst `themesService` (dokładnie): „Tematy zdań trafią do usługi: {service}. Z profilu wysyłamy tylko tematy — bez imienia i roku urodzenia. Drugi model sprawdzający ćwiczenia dostaje gotowe zdania, nie listę tematów. Zdania z tymi tematami może też zobaczyć usługa oceniająca odpowiedzi.” (analogicznie `themesServiceUnknown` z „do usługi generującej”).

- [ ] **Step 1: Testy (czerwone):** `new-lesson-form.test.tsx` — katalog z `false`: alert z komunikatem, przycisk wyłączony; z `true`: brak alertu. E2E `mocked`: `parent-lessons-layout.spec.ts` „bez klucza OpenRouter formularz nowej lekcji pokazuje komunikat i nie pozwala wysłać”; `parent-lesson-editor-layout.spec.ts` „bez klucza „Dogeneruj” i „Ponów generowanie” są wyłączone z komunikatem” (szkic z `generation.state: "failed"`, `errorCode: "lesson_agent_unavailable"` — alert `generation-failed` pokazuje komunikat z Global Constraints); tematy zdań z nowym tekstem.
- [ ] **Step 2: Uruchom** — FAIL.
- [ ] **Step 3: Zaimplementuj.**
- [ ] **Step 4: Uruchom** testy web (`pnpm exec vitest run --config vitest.unit.config.ts apps/web/src/parent`) i E2E `mocked` z Files (`UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test --project=mocked <pliki>`) — PASS.
- [ ] **Step 5: Commit** „Panel rodzica: generowanie lekcji niedostępne bez klucza OpenRouter (#237)”.

### Task 10: E2E `real`, smoke i sonda

**Files:**
- Modify: `tests/e2e/lesson-parent.spec.ts`, `tests/e2e/lesson-mock-test.spec.ts`, `tests/e2e/lesson-real-flow.spec.ts`, `tests/e2e/lesson-parent-supervision.spec.ts`, `tests/e2e/parent-sources.spec.ts` (tylko gdzie asercje zależą od potoku — wg `pr2-map-fake-config.md` §4), `tests/e2e/global-setup.ts` i `tests/e2e/spec-projects.ts` (komentarze o puli przez `UMIEM_LLM`/potok), `tests/e2e/helpers/fake-hold.ts` (komentarz), `deploy/compose.smoke.yaml` (`web.environment.UMIEM_FAKE_PROVIDERS: "1"`), `tests/probes/chapter-generation.probe.test.ts`, `tests/probes/probe-costs.ts` (+ test)

**Interfaces (sonda, spec §6.3):**
- składa `lessonAgentDepsFromEnv(env, usage)` z `@learning/server/lesson-agent`; `LessonAgentUnavailable` → błąd sondy przed rejestrem kosztów i pierwszym wywołaniem;
- wpis tymczasowy rejestru = `lessonAgentPolicyFromEnv(env).runBudgetUsd` (domyślnie 1,00 USD), nie `estimateProbeCostUsd`;
- strażnik hosta: agent i checker na stałym `https://openrouter.ai`, grader przez `probeEndpointHost(UMIEM_GRADER_BASE_URL)`; dla `UMIEM_PROBE_SUBJECT=school` bez pełnego `UMIEM_GRADER_*` — stop bez kosztu (komunikat z nazwą brakującej zmiennej);
- pętla: dopóki `readGeneration(...).state === "queued"`, czekaj do `nextAttemptAt` i wołaj `executeLessonGeneration`, najwyżej `MAX_AUTOMATIC_ATTEMPTS` razy; w wynikach `attempts` i `waitedMs`;
- linie `[lesson]` i `[lesson-agent]` do pliku wyników (pole `log`), nie na konsolę;
- koszt per operacja z `usage` (`agent_plan`, `agent_objective`, `check_*`, `check_grade`, `lesson_objectives`); `recordingLlm` dla puli i wątki potoku (`UNSOLICITED_V3_FIELDS` na surowych ćwiczeniach, `raw`) usunięte.
- Nowe `UMIEM_PROBE_ADD_COUNT` (liczba „+N” po pełnej generacji, domyślnie brak): po `succeeded` sonda woła `regenerateObjective` dla pierwszego zagadnienia i raportuje `addedExercises`.

- [ ] **Step 1:** E2E `real`: dopasuj asercje do fake-agenta (minima per cel, `open_answer` z „Przetłumacz”, ćwiczenia słuchowe, przykłady `Example for …`, restart z `FAKE_SLOW_MARKER`, „Dogeneruj” 12 domyka etap samodzielny). Uruchom każdy zmieniony spec: `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test --project=real <spec>` — PASS.
- [ ] **Step 2:** Sonda bez sieci: `pnpm exec vitest run --config vitest.unit.config.ts tests/probes/probe-costs.test.ts` — PASS; `pnpm probe:chapter` **bez** klucza i bez `UMIEM_PROBE_*` kończy się błędem konfiguracji przed jakimkolwiek wywołaniem (sprawdź komunikat, nie uruchamiaj z kluczem).
- [ ] **Step 3:** `pnpm typecheck` — PASS.
- [ ] **Step 4: Commit** „E2E i sonda rozdziału na agencie puli (#237)”.

### Task 11: Dokumentacja

**Files:** wg spec §7: `docs/architecture.md` (§19.3, §19.15, §19.17 — jedyny generator, brak listy, brak klucza, `agentPolicy` obowiązkowe; wzmianki o `acceptFreshLessonPool` i wyborze ścieżki; §23 operacja `lesson_pool` jako historyczna), `docs/provider-config.md`, `.env.example` (opisy `UMIEM_LLM_*` bez „pul ćwiczeń lekcji” i „dotychczasowego potoku”; ścisły `json_schema` przy `UMIEM_LLM_PROVIDER_*`), `docs/deploy.md` (klucz wymagany do lekcji w web i worker, Coolify per serwis, koszt agenta, walidacja `UMIEM_LESSON_AGENT_*` przy każdym starcie, wycofanie przez `git revert`, zmiana niezgodna dla konfiguracji OpenAI-direct), `docs/SPEC.md` (§29a.8, §29a.10, sekcja rozdziału), `AGENTS.md` (punkty o agencie: bez „domyślnie wyłączony” i listy; nowy przedmiot dodaje `agentPolicy`; `FAKE_SLOW_MARKER` jako opóźnienie pierwszego kroku fake-agenta; liczby testów E2E/integracji po Task 13), `docs/folder-structure.md`, komentarze kodu z spec §7 (`generation-env.ts`, `fake-lesson-agent.ts`, `fake-lesson-pool.ts`), spec etapu 3 §5.3 (nawias „checker i krytyk” → „checker”) i dopisek o rozstrzygnięciach planu PR 2.

- [ ] **Step 1:** Edytuj. `git grep -nE "UMIEM_LESSON_AGENT_SUBJECTS|generateLessonPool|stage_top_up|dogenerowanie pod etap|domyślnie wyłączony" -- docs AGENTS.md .env.example packages apps tests ':!docs/superpowers'` — zostają wyłącznie wzmianki historyczne opisane jako takie (np. „do PR 2 … ”).
- [ ] **Step 2: Commit** „Dokumentacja: agent jedynym generatorem lekcji (#237)”.

### Task 12: Płatny przebieg kontrolny (bramka zgody)

- [ ] **Step 1:** Wyślij właścicielowi wiadomość bramki (spec §6.4): 4 przebiegi (Unit 3 — rozdział, Present Simple — gramatyka, geografia — szkoła; materiały z 2026-11-03 poza repozytorium ze ścieżkami i SHA-256; jedno „+N” na lekcji gramatyki z tego przebiegu przez `UMIEM_PROBE_ADD_COUNT`), modele generatora, checkera i gradera z `CONFIG_DEFAULTS`/env, nowy rejestr (`UMIEM_PROBE_COSTS_INIT=1`, `UMIEM_PROBE_COSTS_CAP_USD=3`), górny koszt przebiegu = budżet runu × 4, commit HEAD. **Bez „tak” nic nie startuje.**
- [ ] **Step 2:** Po zgodzie uruchom przebiegi kolejno; po każdej porażce (spec §6.4: `failed`, wyjątek, `queued` po wyczerpaniu prób, zagadnienie bez ćwiczeń, koszt ponad budżet runu) zatrzymaj się i zapytaj o decyzję.
- [ ] **Step 3:** Wynik (same liczby: stan, ćwiczenia per zagadnienie i etap, `generationGaps`, braki publikacji, koszt, czas, histogram kodów odrzuceń, `checkCounters`, `kind` w rozdziale, `openCheck=on` i `openChecks` w szkole, ćwiczenia dodane przez „+N”) wpisz do `docs/architecture.md` §19.17 w miejsce „Etap 2a/2b: niezweryfikowane” i do szkicu opisu PR. Dane przebiegu poza repozytorium. Commit „Dokumentacja: wynik płatnego przebiegu kontrolnego agenta (#237)”.

### Task 13: Weryfikacja całości i PR

- [ ] **Step 1:** Każdy commit kompiluje się: `git rebase --exec "pnpm typecheck" 3b4c1ec0` (bez zmiany historii przy sukcesie) — PASS.
- [ ] **Step 2:** `pnpm check` — PASS; bundle web bez SDK AI (`tests/ai-sdk-scope.test.ts`, `lesson-agent-imports.architecture.test.ts` w `pnpm check`) — PASS.
- [ ] **Step 3:** `pnpm test:integration` — PASS; przelicz `INTEGRATION_BUCKETS` z sekwencyjnego pomiaru (`UMIEM_INTEGRATION_WORKERS=1 pnpm exec vitest run --config vitest.integration.config.ts --reporter=json`, LPT, AGENTS.md); `integration-buckets.test.ts` — PASS.
- [ ] **Step 4:** `pnpm test:e2e:shards` — PASS; gdy czasy plików `real` mocno się zmieniły, przelicz `REAL_BUCKETS`; zaktualizuj liczby testów w `AGENTS.md`.
- [ ] **Step 5:** Szkic opisu PR w scratchpadzie: zakres, co zostaje, zmiana niezgodna dla OpenAI-direct, nowi domyślni odbiorcy danych (spec §5.5), koszt (§5.6), walidacja env przy starcie, wdrożenie (web i worker razem, klucz w obu, bez migracji, `git revert`), API → MCP → SKILL.md (bez zmian, uzasadnienie), wynik przebiegu kontrolnego, sprawdzenia. Zapytaj właściciela o push i PR.
