# Etap 5c: usunięcie pętli agenta — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** usunąć pętlę agenta puli lekcji (kierownik, podagent, narzędzia, kontrole `solve`/`judgeVariants`/2b, grader w workerze, przedmioty testowe agenta), tak żeby jedynym generatorem lekcji był przebieg bazowy, bez zmiany jego zachowania.

**Architecture:** worker woła wyłącznie `runLessonBaselinePool`. Najpierw pokrycie testami przechodzi z agenta na przebieg bazowy (na obecnym kodzie, gdzie przedmioty produkcyjne już biegną przebiegiem bazowym), potem jednym commitem znika agent. Pola polityki agenta, których używa przebieg bazowy, przechodzą do `SubjectModule` bez zmiany nazw; reszta `SubjectAgentPolicy` znika razem z czytelnikami. Nazwy plików `lesson-agent-*` i `lesson-pool-agent-*` zostają (spec §6).

**Tech Stack:** TypeScript strict, Vitest (unit, integracja na PostgreSQL), Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-08-llm-content-judgment-stage5-chapter-school-design.md` §6, §9–§12, z wpisem v2.6 w §14 (zadanie 1).

## Global Constraints

- Bez zmian zachowania przebiegu bazowego: migawki promptu paczki i kontroli zamkniętych gramatyki, rozdziału i szkoły bajt w bajt bez zmian (istniejące testy migawek przechodzą bez aktualizacji). Przebieg bazowy rozlicza zagadnienia razem po walidacji puli na końcu próby (`lesson-baseline-pool.ts:374-446`) — tak zostaje.
- Bez migracji bazy. Historyczne wiersze `generation_runs.agent_checkpoint` (pola `checkCounters`, `cleanupCounts`, dawne `planExamples`) i `deck_versions.lesson_context` (`cleanupCounts`, `rejectedReasons`) nadal się parsują i wyświetlają.
- Historyczne nazwy operacji kosztu (`agent_objective`, `agent_plan`, `check_solve`, `check_variants`, `check_hints`, `check_open`, `check_grade`) zostają w dokumentacji jako historyczne i w `tests/probes/probe-costs.ts` (sumowanie starych rejestrów); kolumna jest tekstowa, kontraktów to nie dotyka.
- Do generatora i kontroli żadnych danych dziecka; dzienniki `[lesson-baseline]` bez treści ćwiczeń. `OPENROUTER_API_KEY` tylko po https do OpenRouter. Usunięcie gradera z workera zmniejsza to, co worker wysyła (nie wysyła już odpowiedzi modelu rozwiązującego do `UMIEM_GRADER_*`).
- Bez nowych reguł rozumiejących język i bez warstw z §8 specu zbiorczego.
- Warunek dostępności generowania zostaje: `lessonAgentPublicFromEnv` wymaga pełnej `UMIEM_GRADER_*` (grader ocenia dziecko w procesie web, etap 3); `openCheckServiceLabel` zostaje jako ten warunek. `graderAvailable` w wejściu runu (`lesson-agent-outcome.ts:57-58, 143`, `lesson-baseline-pool.ts:107, 242`) to dostępność gradera w web dla paczki — **zostaje**.
- MCP i `SKILL.md` bez zmian (`learning-overview` nie obejmuje lekcji; `openCheckService` jest opcjonalnym polem DTO panelu rodzica, poza `integrations/` i OpenAPI).
- Bez identyfikatorów modeli w commitach i PR. Nie pushować do `main`, nie scalać PR.

## Decyzje

1. **Bez wspólnego strojenia i biegu potwierdzającego** (decyzja właściciela 2026-11-09). Szkoła zostaje bez kontroli 2b (stan po 5b). Wpis v2.6 w specu.
2. **`ruleNotes` przechodzi do `SubjectModule`**, z samymi notami reguł rdzenia: przebieg bazowy wkleja notę `variants.duplicate` z sekcji ogólnej (`rule-book.ts:129`; gramatyka `CONTRACTIONS_NOTE`, rozdział). Noty `lesson.leak`, `lesson.leak_source`, `check.*` znikają (szkoła zostaje bez not). `validateSubject` (`catalog-validation.ts:91-93`) przyjmuje tylko klucz reguły rdzenia.
3. **`typeExamples`, `checkerNeedsMaterial`, `sanitize`** → `SubjectModule` bez zmiany nazw. `independentReserve` → stała `INDEPENDENT_RESERVE = 1` w `domain/lessons/packet-plan.ts`, czytana też w `status.ts`. Znikają: `slack`, `blindSolveTypes`, `variantCheckTypes`, `hintJudgeTypes`, `openAnswerCheckTypes`, `requiredTypes`, `exerciseGate`, `objectiveGaps`, typ `AgentGateFinding`, `objectiveAgentLimits` z parametrem `slack`. `ObjectiveAgentLimits` traci `maxExercises` (jedyny czytelnik to usuwany `deterministicSteps`; implementujący sprawdza, co `finalLessonCheck` robi z `limits`, i zostawia tylko czytane pola).
4. **Pliki `agent-policy.ts` przedmiotów zostają** z polami, które przechodzą do modułu (sanitize, noty, przykłady); `module.ts` składa je w `SubjectModule`. Bez nowych plików i bez zmian nazw (mniejszy diff; zmiana nazwy w osobnym PR, jeśli potrzebna).
5. **Księga reguł tylko dla paczki:** `LessonRuleBookInput` i `RuleBook` bez sekcji `lesson` i `checks` (`ports/ai.ts:146-151`, `rule-book.ts`), bez `CHECK_AREA` i umieszczania `LESSON_RULES`; `renderRuleBook` (`llm.ts:161-185`) z jedną gałęzią (dzisiejsza gałąź `packet`) i bez opcji; znika `lessonSystemPrompt` z pomocnikami (`llm.ts:104-136, 200-269`). `LESSON_RULES` czyta już tylko `lessonRulesStep`. Pola wejścia agenta (`LessonPoolInput.targets[].requiredTypes`, linia `Required:`) znikają, jeśli prompt paczki ich nie czyta (sprawdzić migawką). Migawki paczki bez zmian, bo puste sekcje dziś nic nie renderują.
6. **Reguły bez emitera znikają:** `check.blind_solve`, `check.variants`, `check.hint_judge`, `check.open_answer`, `lesson.limit_full`, `lesson.limit_listen` (z przypadkami w `lesson.rule-cases.ts`). `lesson.leak`, `lesson.leak_source` i reguły puli zostają. **Etykiety odrzuceń `agentRejectionReasons` (`messages.ts:866-892`) zostają bez zmian** — klucz w szkicu to etykieta, a punkt kontrolny runu w toku niesie stare kody; poprawić tylko komentarz „agenta puli” (`messages.ts:865`).
7. **`cleanupCounts`**: znika producent (`CLEANUP_COUNTER_KEYS`, `HINT_REMOVED_RULE`, scalanie w `lesson-agent-outcome.ts:264-285`, `CHECK_COUNTER_KEYS`), a **przenoszenie historycznej wartości zostaje**: `lesson-drafts.ts:1105-1112` (`withCleanupCounts`), `lesson-api.ts:102, 437-438`, `lesson-agent-generation.ts:157, 316, 366, 375`, pole kontraktu szkicu (`contracts/lessons.ts:589-593`, schemat ścisły) i linia edytora. Usunięcie pola to osobna decyzja z migracją danych, poza 5c.
8. **`openCheckService`** znika z `LessonAgentPublic`, DTO katalogu, komunikatów i panelu.
9. **Zmienne `UMIEM_LESSON_AGENT_MAX_STEPS` i `UMIEM_LESSON_AGENT_OBJECTIVE_TIMEOUT_MS`** znikają (config czyta klucze jawnie, bez ścisłego schematu env — stara zmienna w `.env` jest ignorowana, jak dziś `UMIEM_LESSON_AGENT_SUBJECTS`, `config.test.ts:302-304`); pola polityki `maxStepsPerObjective`, `objectiveTimeoutMs`, `graderConcurrency`, `graderStageTimeoutMs`, `unknownGraderCallEstimateUsd`, `graderBreakerThreshold`; `OBJECTIVE_TIMEOUT_REASON`.
10. **`agentGrammarRegistry()`** znika; testy biorą `createSubjectRegistry` z przedmiotami produkcyjnymi (i `historyLikeSubject`, tam gdzie dziś — po 5c biegnie przebiegiem bazowym).
11. **`planExamples`**: zostaje test zgodności starego punktu kontrolnego (`lesson-agent-checkpoint.test.ts:114-116`) i komentarz w schemacie.
12. **Wdrożenie:** web i worker razem (stary web z nowym workerem pokazałby nieaktualną linię usługi kontroli — kosmetyka). Przed wdrożeniem zapytanie tylko do odczytu o runy lekcji w toku, za zgodą właściciela (spec §10).

## Review Focus

1. **Run agenta w toku na produkcji po wdrożeniu**: punkt kontrolny z runu agenta wznawia się przebiegiem bazowym — test w zadaniu 3 z niepustymi `checkCounters` i `cleanupCounts` oraz zagadnieniem `incomplete` z częściowymi ćwiczeniami.
2. **Prompt paczki po zmianie księgi reguł i przeniesieniu `ruleNotes`/`typeExamples`**: migawki gramatyki, rozdziału i szkoły bez aktualizacji — zadanie 5.
3. **Historyczny szkic z `cleanupCounts`** po „+N” albo ponownym generowaniu nadal zwraca `cleanupCounts` w DTO — test integracyjny w zadaniu 3.
4. **`.env` produkcji z usuniętymi zmiennymi agenta** — web i worker startują (zadanie 4, `config.test.ts`, `apps/web/src/composition.test.ts:59-62` przepięty na istniejącą zmienną).
5. **Mechanika workera na fake'u paczek** (zamknięcie procesu w ostatniej próbie, termin runu, budżet, nadpisanie edycją, Ponów w trakcie próby) — przepisana na semantykę przebiegu bazowego w zadaniu 3, nie usunięta.

---

### Task 1: Spec v2.6 — zrobione

Wpis v2.6 w §14 i nagłówek wersji (decyzje 1–11, stan bramki u sędziego 2). Commit razem z planem: `Etap 5c: spec v2.6 i plan`.

### Task 2: Fake paczek z krokami mechaniki

**Files:** Modify: `packages/server/src/providers/fake-lesson-agent.ts`, `tests/integration/fakes.ts` (przekazanie `packets`); Test: `packages/server/src/providers/fake-lesson-agent.test.ts`.

**Interfaces — Produces:**
```ts
export type FakePacketStep =
  | { throw: Error }
  | { gate: Promise<void>; onReached?: () => void } // koszt `packet_generate` zapisany PRZED czekaniem; przerwanie odrzuca signal.reason
  | { hang: true }                                  // czeka do przerwania, potem odrzuca signal.reason (termin runu)
  | { stall: true }                                 // ignoruje przerwanie (dostawca bez obsługi abort)
  | { build: (input: LessonPacketInput) => { exercises: unknown[]; examples?: unknown[] } };
```
Po zwolnieniu `gate` paczka zwraca wynik generatora (`fakePacketExercises`). Kroki biorą kolejne wywołania paczek slugu w kolejności wejścia do semafora (FIFO); scenariusz liczy się z planem paczek zagadnienia. `hang` i `stall` służą testom jednostkowym przebiegu bazowego (zadanie 3b), `gate`/`build`/`throw` — integracyjnym.

- [ ] Testy: `gate` woła `onReached`, koszt zapisany przed zwolnieniem, po zwolnieniu ćwiczenia generatora, `abort()` odrzuca `signal.reason`; `hang` odrzuca po `abort()`; `stall` nie kończy się po `abort()` (wyścig z timerem); `build` dostaje `LessonPacketInput` i zwraca swój wynik. `pnpm vitest run packages/server/src/providers/fake-lesson-agent.test.ts` — FAIL, implementacja, PASS.
- [ ] Commit.

### Task 3: Pokrycie testami na przebiegu bazowym (agent jeszcze istnieje)

Na obecnym kodzie przedmioty produkcyjne (gramatyka, rozdział, szkoła) i tak biegną przebiegiem bazowym (`lesson-agent-generation.ts:472-476`), więc przepięte testy przechodzą przed usunięciem agenta.

**3a. Integracja.** Files: `tests/integration/helpers.ts` (bez `agentGrammarRegistry`), `lesson-agent-generation.test.ts`, `lesson-generation.test.ts`, `lesson-listen-choice.test.ts`, `lesson-present-continuous.test.ts`, `lesson-parent-api.test.ts`, `child-interests.test.ts`, `lesson-story.test.ts`, `generation.test.ts`, `lesson-chapter.test.ts`, `lesson-school-baseline.test.ts`.

Zasada (każdy test osobno; w PR lista: przepięte / przepisane / usunięte z powodem):
- **Przepięte** (asercje bez zmian poza nazwami): punkt kontrolny, CAS, Ponów po próbie, wynik próby, `provider_configuration`, uszkodzony punkt kontrolny, `attempts > MAX`, ponowienie przejściowe, generator niedostępny, nieznany przedmiot, stare pola kolejki, zapis szkicu, `payload_version`, oczyszczenie świeżego wyjścia, zły kształt, przykłady kart, objaśnienia, temat dynamiczny szkoły, ton głosu, rachunki, publikacja, patch, reguła ujawnień, historyjka. Przedmiot produkcyjny, scenariusz `packets` (krok `build` z tym samym rekordem co dziś skrypt `submit`) zamiast `objectives`; `agent.calls` → `agent.packetCalls`; `agent_objective` → `packet_generate`; `vi.spyOn(fakes.agent, "runObjective")` (`generation.test.ts:87`) → `generatePacket`; `child-interests.test.ts:189-264` → `packetCalls[].pool.interests`.
- **Przepisane na semantykę przebiegu bazowego** (rozliczenie wszystkich zagadnień na końcu próby, koszt per paczka i per `checkClosed`, budżet sprawdzany przy wejściu w wywołanie): `shutdownInLastAttempt` (`lesson-agent-generation.test.ts:463-470`) i jego użycia (`:1102`, `:1208`), zamknięcie procesu z kosztem #317 (`:1130-1160`), błąd bazy #319 (`:1168-1180`), budżet `runBudgetUsd` (`:1232`), termin runu (`:1259`, `:1501`), Ponów w trakcie próby (`:1336-1346`), `:1274`, `:1296`, `:1706`, nadpisanie edycją / `editNumber`, wyczerpane próby z częściowym zapisem, „+N” (limity, kolizja z historyjką, ponowienie, „nic nowego”, `add_short`), koszty `UsageRecorder`, `familyId` przy wznowieniu, `lesson-listen-choice.test.ts:107-153` (limit słuchania: liczba `lesson_listen_choice` w szkicu z planu paczek zamiast odrzucenia `limit_listen`), `lesson-present-continuous.test.ts:131-193`. Oczekiwane USD i liczby wywołań przeliczone z planu paczek; to, co test chronił (koszt zapisany przy zamknięciu, brak podwójnego liczenia, brak zapisu po nadpisaniu, ponowienie bez utraty runu), zostaje w asercji.
- **Usunięte**: mechanika samej pętli (brak czasu dla kierownika, kroki podagenta, `submit`/`remove`, limity zgłoszeń narzędzi, `maxStepsPerObjective`), kontrole 2b szkoły (`:1908-2237`), asercje `agent.calls` długości 0 w `lesson-chapter.test.ts` i `lesson-school-baseline.test.ts` (pole znika).
- **Nowe**: (1) wznowienie runu, którego punkt kontrolny (surowy JSON w wierszu runu) ma niepuste `checkCounters` i `cleanupCounts` oraz zagadnienie `incomplete` z częściowymi ćwiczeniami — kończy się przebiegiem bazowym bez błędu, ćwiczenia z punktu kontrolnego zostają `fixed`; (2) szkic z `lesson_context.cleanupCounts` po „+N” zwraca to samo `cleanupCounts` w DTO.
- [ ] Po każdym pliku `pnpm test:integration <plik>` — PASS. Commit.

**3b. Unit przebiegu bazowego** (pokrycie z usuwanych `lesson-pool-agent*.test.ts`). File: `packages/server/src/modules/materials/lessons/lesson-baseline-pool.test.ts`. Przypadki: termin runu przy zawieszonym generatorze (`hang`); generator ignorujący przerwanie (`stall`) nie blokuje końca runu; przerwanie przed startem; odrzucenie z `signal.reason`; limity współbieżności generatora i kontroli (`ConcurrencyMeter`); `initialSpentUsd` bez podwójnego liczenia; dziennik `[lesson-baseline]` bez treści (jeśli brak); „+N” z nieznanym zagadnieniem i N < 1 (jeśli walidacja jest w przebiegu bazowym — inaczej test zostaje tam, gdzie walidacja). Przeniesione z `lesson-pool-agent-tools.test.ts:121-207`: `RunCostMeter`, domyślna polityka, `Semaphore`, `deadlineSignal` (do `lesson-pool-agent-policy.test.ts` / `lesson-agent-timers.test.ts`).
- [ ] `pnpm vitest run <pliki>` — PASS (kod bez zmian; przypadek, który nie przechodzi, to błąd przebiegu bazowego — zgłosić, nie naprawiać po cichu). Commit.

### Task 4: Usunięcie pętli agenta i gradera w workerze (jeden commit)

Ścieżki względem `packages/server/src/`, o ile nie podano inaczej.

- **Worker i config:** `modules/materials/lessons/lesson-agent-generation.ts` (zawsze `runLessonBaselinePool`, bez `agentCheckStartLine`, bez gradera), `lesson-agent-outcome.ts` (+test: bez `agentCheckStartLine`, liczników kontroli i sprzątania), `config.ts` (`LessonAgentDeps { agent: LessonPacketGenerator; checker: ClosedExerciseChecker; policy; finalizationReserveMs? }`, bez `AgentGraderDeps`, `agentGraderFromEnv`, pól polityki z decyzji 9) i `config.test.ts` (`:320, :339, :354, :420` — testy `toThrow(/MAX_STEPS/)` zastąpione testem „stara zmienna ignorowana”; `:461-505` grader), `config-defaults.ts:75, 78`, `providers/lesson-agent-env.ts` (+test `:187`), `ports/ai.ts` (`AnswerGraderProvider.grade` bez `cost`), `providers/openai-compatible/grader.ts` (bez `usageLabel` `check_grade`), `providers/usage-recording.architecture.test.ts`, `tests/integration/fakes.ts:79`, `apps/web/src/composition.test.ts:59-62` (inna istniejąca zmienna `UMIEM_LESSON_AGENT_*`), `.env.example:140, 143`, `docs/provider-config.md:121, 124`.
- **Delete:** `modules/materials/lessons/lesson-agent-check-run.ts` (+test), `lesson-pool-agent.test.ts`, `lesson-pool-agent.add.test.ts`, `lesson-pool-agent.limits.test.ts`, `lesson-pool-agent-input.test.ts`, `lesson-pool-agent-tools.test.ts` (po przeniesieniu z 3b), `domain/lessons/agent/admission.checks.test.ts` (blok `submitExamples` `:424-498` do `admission.test.ts`), `providers/fake-lesson-pool.test.ts`, `domain/lessons/testing/agent-grammar-subject.ts`, `agent-school-subject.ts`; eksporty w `domain/lessons/testing/index.ts` i `packages/server/src/index.ts:12-13`.
- **Modify (zostają symbole KEEP):** `lesson-pool-agent.ts` (typy wejścia/wyniku, `slugOf`, `emptyLessonPoolAgentStats`, `addModePlan`, `lessonAgentLimits`, `poolStartState`, `objectivesToRun`, `EXTRA_SOURCES_KEY`; `LessonPoolAgentStats` = `submitted`, `accepted`, `rejectedByKind`, `checkerCalls` — pozostałe pola znikają), `lesson-pool-agent-tools.ts` (`parseLessonRecord`, `ParsedRecord`, `RejectionLogEntry` z helperami), `lesson-pool-agent-input.ts` (`lessonAvoidSentences`, `withoutTexts`), `lesson-pool-agent-policy.ts`, `domain/lessons/agent/admission.ts` (KEEP: typy `ObjectiveAgentLimits`, `AgentCheckContext`, `Rejection`, `LessonSnapshot`; `rejectionOf`, `lessonRules`, `lessonLeaks`, `snapshotOf`, `lessonRulesStep` z pomocnikami, `objectiveOf`, `MAX_CARD_EXAMPLES`, `submitExamples`, `removeExercise`), `pool-validation.ts` (bez `agentReanalysisDraft`), `keyword-families.ts` (bez `familyBase`, jeśli bez użytkownika), `agent/solver.ts` (`solverView`, `groupItemsInViewOrder`, `instructionOf`), `agent/status.ts`, `ports/ai.ts` (bez interfejsów agenta i checkera agenta; `LessonPacketInput.objective` jako jawny typ), `providers/openai/lesson-pool-agent.ts` (+test: zostają `generatePacket`, `checkClosed`, prompty paczki i kontroli, `tracked`, mapowanie błędów, `OPENROUTER_BASE_URL`, `openRouterCostOf`; `AgentOperation` = `packet_generate | check_closed`), `providers/openai/llm.ts` (+test; decyzja 5), `providers/fake-lesson-agent.ts` (+test: bez scenariuszy agenta i metod checkera agenta; tryb `generate` zostaje — używa go tryb fake workera dla paczek), `providers/fake-lesson-pool.ts` (bez `fakeObjectiveExercises` i pomocników etapów), testy mieszane `admission.test.ts`, `admission.leaks.test.ts`, `admission.property.test.ts` (przepięte na `lessonRulesStep` / `snapshotOf` / `submitExamples` / `removeExercise` tam, gdzie testują wspólną logikę: reguły lekcji, ujawnienia ofiara/źródło, kolejność keywords, konflikt słuchania; niezmienniki — jeśli dają się wyrazić przez `lessonRulesStep`, inaczej usunięte), `solver.test.ts`, `status.test.ts`, `rules/lesson-rules.ts`, `rules/lesson.rule-cases.ts` (przez `lessonRulesStep`; decyzja 6), `rules/rules.architecture.test.ts` (`SCANNED`, `EXCEPTIONS[TOOLS_FILE]`, `textHooks`, `ISSUE_RESULT_TYPE`), `rules/rule-book.test.ts`, `tests/ai-sdk-scope.test.ts` (sprawdzić; plik adaptera zostaje), `providers/lesson-agent-imports.architecture.test.ts` (sprawdzić).
- [ ] `pnpm typecheck` (wyłapuje resztki), `pnpm test:unit`, `pnpm test:integration` — PASS; migawki paczki i kontroli bez aktualizacji. `git diff --stat` — pomiar linii względem §9.2 specu.
- [ ] Commit.

### Task 5: Polityka przedmiotu w module, rejestr bez `agentPolicy`, księga reguł paczki

**Files:** `domain/lessons/types.ts` (`SubjectModule`: `typeExamples?`, `checkerNeedsMaterial: boolean`, `sanitize?`, `ruleNotes?`; bez `agentPolicy`, `baselinePool`, `SubjectAgentPolicy`, `AgentGateFinding`), `domain/lessons/registry.ts` (+test `:27-38`), `rules/catalog-validation.ts` (+test `:260-272`), `rules/rule-book.ts` (+test), `rules/catalog.ts` (`RuleBookContext.policy` → pola modułu), `ports/ai.ts` (`LessonRuleBookInput` bez `lesson`, `checks`), `providers/openai/llm.ts` (`renderRuleBook`), `domain/lessons/packet-plan.ts` (`INDEPENDENT_RESERVE`), `agent/status.ts`, `subjects/english-chapter/{agent-policy,module}.ts` (+`agent-policy.test.ts`, `module.test.ts`), `subjects/english-grammar/{agent-policy,module,type-examples}.ts` (+test), `subjects/school/{agent-policy,module,school.rule-cases}.ts` (+`agent-policy.test.ts`, `module.test.ts`), `domain/lessons/testing/{test-agent-policy,history-like-subject,agent-test-subject}.ts`, `lesson-baseline-pool.ts` (bez czyszczenia `lesson`/`checks` przy budowie wejścia paczki — sekcji już nie ma), `modules/materials/lessons/lesson-api.ts` (+test; `checkServiceIncludesMaterial` z pola modułu), `tests/probes/chapter-generation.probe.test.ts:723-725` (`variantOf` bez `baselinePool`).

- [ ] Testy: rejestr przyjmuje moduł bez `agentPolicy`; `validateSubject` odrzuca `ruleNotes` z kluczem `lesson.leak` i z kluczem spoza katalogu, przyjmuje `variants.duplicate`; `packetPlan` używa `INDEPENDENT_RESERVE`. FAIL.
- [ ] Przeniesienie; `pnpm typecheck`, `pnpm test:unit` — PASS, **migawki promptu paczki i kontroli bez aktualizacji**. Pomiar linii.
- [ ] Commit.

### Task 6: Kontrakty i panel bez `openCheckService`

**Files:** `packages/contracts/src/lessons.ts` (`:140`; opis `checkService` `:136` bez „agenta puli”; komentarz przy `cleanupCounts` `:589`: „historyczne szkice; nowe nie mają”) i `lessons.test.ts:885-890`, `packages/contracts/src/messages.ts` (`openCheckServiceInfo` `:1180`, komentarz `:865`), `config.ts` (`LessonAgentPublic.openCheckService`) i `config.test.ts:386-456`, `lesson-api.ts:186-203` (+`lesson-api.test.ts:74, 118-130`), `apps/web/src/parent/lessons/lesson-service-info.ts` (+test `:23-40`), `NewLessonForm.tsx:683-684` (+`new-lesson-form.test.tsx:462`), `apps/web/src/parent/sources/SourcePage.tsx:357` (+`sources-panel.test.tsx:135-143`).

- [ ] Testy bez `openCheckService` — FAIL, usunięcie — PASS (`pnpm test:unit`, testy web).
- [ ] Commit.

### Task 7: Sondy

**Files:** Delete: `tests/probes/agent-generation.probe.test.ts`, `probe-submissions.ts`, `probe-submissions.test.ts`. Modify: `package.json` (bez `probe:agent`), `vitest.probe.config.ts:15-16`, `vitest.unit.config.ts:20` (bez usuniętych i nieistniejących plików), `tests/probes/chapter-generation.probe.test.ts` (bez `recordingAgent`, `submissionMetrics`, `cleanupCounters`, gradera, `graderAvailable` arkusza, prefiksu `[lesson-agent]`, ramienia agenta), `probe-preflight.ts` (bez wymogu gradera dla 2b; wymóg `UMIEM_GRADER_*` zostaje, bo generowanie wymaga go w `lessonAgentPublicFromEnv`), `probe-costs.ts` (bez `unknownGraderCallEstimateUsd`; lista historycznych operacji zostaje) i jego test, `blind/coverage.cjs:47`, `blind/coverage.test.ts:30`, `blind/gen-blind-sheet.cjs:52` (tekst o zrzutach `probe:agent` — obsługa starych zrzutów zostaje, jeśli kod je czyta).

- [ ] `pnpm test:unit` — PASS; `pnpm exec vitest run --config vitest.probe.config.ts` bez zmiennych — sondy pominięte, bez błędów importu.
- [ ] Commit.

### Task 8: Dokumentacja

**Files:** `AGENTS.md` (`:134` reguła `agentPolicy`/`baselinePool`, `:137` akapit agenta, `:188` grader w workerze, `:189-190` przebieg bazowy i porty agenta; katalog reguł), `docs/architecture.md` (§19.5 `:490` grader w workerze, `:545` `cleanupCounts` historyczne; §19.17 `:745-854` bez opisu pętli, kontroli 2b, `agentGrammarRegistry`, `planExamples`; §23 `:942` operacje historyczne), `docs/provider-config.md` (`:99-231` sekcja agenta, 2b grader `:216-231`, operacje `:180-184`), spec kosztów (`docs/superpowers/specs/2026-11-02-llm-cost-tracking-design.md` tabela §2: operacje agenta historyczne), spec zbiorczy (`2026-11-07-llm-content-judgment-design.md` §3, §11 — stan etapu 5).

- [ ] `rg -n "runLessonPoolAgent|agentPolicy|baselinePool|judgeHints|solveOpen|agentGrammarRegistry|probe:agent|MAX_STEPS" AGENTS.md docs packages apps tests` — trafienia tylko w historii specu/planów i w opisach historycznych.
- [ ] Commit.

### Task 9: Weryfikacja i PR

- [ ] `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards` (w tle); testy `*.architecture.test.ts`.
- [ ] Bilans linii (`git diff --stat origin/main`) wobec §9.2 specu w PR.
- [ ] Trzech krytyków na gałęzi (mechanika workera i testy; dane, zgodność historycznych wierszy i prywatność; prostota i kompletność usunięcia), `ponytail:ponytail-review`, poprawki.
- [ ] PR: API → MCP → skill (bez zmian, uzasadnienie), lista przepiętych / przepisanych / usuniętych testów, wdrożenie (web i worker razem; zapytanie tylko do odczytu o runy w toku za zgodą właściciela), „Closes #362”.
