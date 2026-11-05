# Agent puli lekcji — etap 3: agent jedynym generatorem, usunięcie krytyka (#237)

Wersja 2, 2026-11-05. Zastępuje wersję 1 (płatne porównanie agenta z potokiem),
którą właściciel odrzucił: agent ma generować i dogenerowywać lekcje, a stary
sposób i krytyk mają zniknąć. Etapy 1, 2a i 2b są scalone (#258, #275).

## 1. Cel i decyzje właściciela (2026-11-05)

**Cel.** Pulę ćwiczeń lekcji generuje i dogenerowuje („Dogeneruj +N”) wyłącznie
agent puli. Dzisiejszy sposób jednym wywołaniem z rundami dogenerowania etapów
(„potok”) i krytyk lekcji znikają z kodu.

| Pytanie | Decyzja |
|---|---|
| Płatne porównanie agent kontra potok | nie robimy |
| Stary sposób generowania | usunąć, nie zostawiać jako zapasu |
| Krytyk lekcji | usunąć (dawny etap 4) |
| Podział | dwa PR: PR 1 krytyk, PR 2 agent jedynym generatorem |
| Brak klucza OpenRouter w workerze | worker startuje, lekcje się nie generują, panel mówi dlaczego (§4.4) |
| Test na prawdziwych modelach | test dymny: 1 płatny przebieg na przedmiot, za zgodą przed startem (§5) |

**Poza zakresem:** strojenie promptów i polityk agenta; lematyzator; punkty 2–7
z „Do rozwiązania” w issue; pokazywanie rodzicowi liczby niesprawdzonych
ćwiczeń; zmiany słówek, kartkówek i sesji dziecka.

**Moduł i zależności.** Obszar `materials/lessons` (autorstwo materiału) i
konfiguracja (`config.ts`, `config-defaults.ts`, kompozycje web i worker).
Bez nowych zależności, bez migracji, bez zmian granic modułów. Transakcje
zapisu do szkicu (`finalizeLessonPoolWrite`) i punkt kontrolny agenta bez zmian.

**Kolejność:** PR 1 scala właściciel, PR 2 powstaje na `main` po PR 1.

## 2. PR 1: usunięcie krytyka lekcji

### 2.1. Zakres

Krytyk (PR #236, `LessonReviewerProvider`, `UMIEM_REVIEWER_*`, domyślnie
wyłączony) jest wołany tylko z potoku. Usuwamy go w całości:

- **Domena:** `domain/lessons/review-criteria.ts`, `review-report.ts`,
  `review-verdicts.ts` (z testami); pole `SubjectModule.reviewRules` (typ,
  walidacja katalogu, teksty w promptach przedmiotów i w
  `testing/history-like-subject.ts`).
- **Moduł:** `modules/materials/lessons/lesson-review.ts` (z testem); w
  `lesson-drafts.ts` faza przeglądu, `REVIEW_*`, `LessonPoolReview`,
  `LessonContext.review`, parametry `review` w `stageTopUpRound`,
  `failLessonPoolValidation`, `finalizeLessonPoolWrite`; termin fazy wraca do
  terminu runu.
- **Port i adaptery:** typy krytyka w `ports/ai.ts`;
  `providers/openai/lesson-reviewer.ts`, `lesson-review-schema.ts` (z testem);
  `FakeLessonReviewer` w `providers/fake.ts`; `fakeReviewerFromEnv` i pole
  `reviewer` w `generation-env.ts`; prefiks `UMIEM_REVIEWER` w
  `chat-request-options.ts` i `openrouter-key.ts`.
- **Konfiguracja:** `GenerationDeps.reviewer`, `ReviewerPolicy|State|Deps`,
  `Services.reviewService`, `reviewerEnabled`, `reviewerFromEnv`,
  `reviewerPublicServiceFromEnv` i reszta bloku krytyka w `config.ts`;
  `UMIEM_REVIEWER_*` w `config-defaults.ts`; eksport w `index.ts`;
  `reviewerHealthBudgetWarning` w workerze (`loop.ts`, `main.ts`);
  `reviewService` w kompozycji web.
- **Kontrakty:** `SubjectCatalogDto.reviewService`, schematy `Review*`,
  `LessonDraftDto.review`, `LessonDeckDto.reviewService`; komunikaty `review*`
  w `messages.lessons` (37 kluczy).
- **Panel rodzica:** `LessonReviewBanner.tsx` (z testem); notatki i plakietki
  krytyka w `LessonExerciseCard.tsx` i `LessonEditor.tsx`; informacja o
  usłudze krytyka w `LessonSupervisionPanel.tsx`, `NewLessonForm.tsx`,
  `SourcePage.tsx`; styl `.pp-lesson-review-toggle`.
- **Sondy:** `tests/probes/lesson-review.probe.test.ts`, skrypt
  `probe:review`; wątki krytyka w `chapter-generation.probe.test.ts`
  (stan krytyka, koszt `lesson_review`, prefiks `[lesson-review]`).
- **Dokumentacja:** `docs/architecture.md` §19.16 i odwołania w §19.15 i
  §19.17; `docs/SPEC.md` §29a.9; `AGENTS.md` (punkt o krytyku i wzmianki w
  punktach o agencie, tematach zdań i pomiarze integracji); `.env.example`;
  `docs/folder-structure.md`. Spec i plany krytyka z 2026-11-02 zostają jako
  historia, z dopiskiem „usunięty w etapie 3 #237” na początku.

### 2.2. Nie mylić — zostaje

- **Ocena aktywności sesji** (`SessionActivityReviewer`,
  `session_activity_review`, `ParentWorkCardDto.reviewService`,
  `WorkCardPanel`) to inna funkcja.
- `findExposureLeaks`, `lesson-pool-acceptance.ts`, `lesson-json-request.ts`,
  `lesson-payload.ts`, `nextReviewAt`, `mockTestReview*`.
- W PR 1 zostaje też cały potok (bez fazy przeglądu) — usuwa go PR 2.

### 2.3. Dane i zgodność

- `lesson_context.review` to klucz w kolumnie JSONB `deck_versions.lesson_context`
  — **bez migracji**. `readLessonContext` kopiuje tylko znane pola, więc stare
  szkice z kluczem `review` działają; `withoutRunReports` nadal usuwa klucz
  `review` przy tworzeniu nowej wersji, żeby nie przenosić starych raportów.
- Wiersze `provider_usage_events` z `operation = 'lesson_review'` zostają jako
  historia (kolumna tekstowa, bez CHECK).
- Pozostawione `UMIEM_REVIEWER_*` w `.env` niczego nie psują (nieczytane).
- Rodzic traci linijkę „Dogenerowane ćwiczenia, by uzupełnić brakujące etapy:
  N” (żyła tylko w raporcie krytyka). W PR 2 rundy dogenerowania etapów i tak
  znikają.

### 2.4. Testy PR 1

- Usuwamy testy krytyka (unit, `tests/integration/lesson-review.test.ts`,
  sonda, E2E banera i plakietek w `parent-lesson-editor-layout.spec.ts`,
  asercje `lesson-review-service` w `parent-lessons-layout.spec.ts`).
- `tests/integration/lesson-review.test.ts` zawiera jedyne testy integracyjne
  rundy dogenerowania etapów. Nie przenosimy ich: PR 2 usuwa tę rundę; do
  scalenia PR 2 potok ma pokrycie testów jednostkowych `trimToStageDeficits` i
  `lesson-generation.test.ts`.
- `tests/integration-buckets.ts`: wpis pliku i komentarz;
  `tests/ai-sdk-scope.test.ts`: przykładowy plik `lesson-reviewer.ts` zastąpić
  istniejącym (`lesson-json-request.ts`).
- `tests/integration/lesson-agent-generation.test.ts`: test „agent nie woła
  krytyka i nie rusza `review` w kontekście” traci sens — usunąć część o
  krytyku, zostawić resztę asercji.
- `lesson-fingerprint.ts` (`exerciseFingerprint`) staje się martwy — usunąć z
  testem.
- Przed PR: `pnpm check`, `pnpm test:integration`, `pnpm test:e2e:shards`.

### 2.5. API → MCP → SKILL.md

Zmiany dotyczą wyłącznie DTO panelu rodzica (usunięte pola opcjonalne).
Generowanie i szkic nie są częścią MCP ani `learning-overview`; `integrations/`
nie odwołuje się do tych pól. Bez zmian w MCP i `SKILL.md`.

## 3. PR 2: agent jedynym generatorem — zakres

### 3.1. Co znika

- **Wybór ścieżki:** `lessonGeneratorFor`, lista `UMIEM_LESSON_AGENT_SUBJECTS`
  (`agentSubjectIds`, `lessonAgentSubjectsFromEnv`, pole
  `LessonAgentDeps.subjects`). `executeLessonGeneration` zawsze woła
  `executeLessonAgentGeneration`.
- **Potok w `lesson-drafts.ts`:** ciało potoku w `executeLessonGeneration`,
  `stageTopUpRound`, `StageTopUpContext`, `stageCountsOf`,
  `batchesForObjectives`, `trimToStageDeficits`, `STAGE_TOP_UP_*`,
  `EXPOSURE_LEAK_REASON`, `withinStageQuotas`, `capListenChoiceOverflow`,
  `collectBatchExerciseMetadata`, `filterExercisesToRequestedObjective`,
  `summarizeLessonPoolValidation`, `refineGeneratedDrafts`,
  `existingAnswersOf`, `existingExercisesOf`, `uniqueStimuli`; gałąź
  `finalizeLessonPoolWrite`, która czyści punkt kontrolny po zapisie potokiem;
  pola `LessonRunInput.regenerate.existingAnswers|existingExercises` (stare
  runy w kolejce z tymi polami nadal się parsują — pola ignorowane).
- **Inne moduły:** `acceptFreshLessonPool` (`lesson-pool-acceptance.ts`;
  `sanitizeFreshLessonDraft` zostaje), `resolveGenerationLeaks`
  (`exposure-leaks.ts`), `stageDeficits` (`lesson-coverage.ts`), `callSoft`
  (`lesson-generation-control.ts`), `stageTopUp` w polityce generowania.
- **Port i adapter:** `LlmProvider.generateLessonPool` i `LessonPoolInput.purpose`
  (`ports/ai.ts`); `generateLessonPool` i `lessonExamplesToRecord` w
  `providers/openai/llm.ts` oraz blok „istniejące odpowiedzi” promptu, jeśli
  nie używa go agent (sprawdzić w planie; agent podaje `[]`).
- **Rozdział — zagadnienia potoku:** `objectivesRules` przedmiotu rozdziału i
  gałąź `kind` w zagadnieniach (prompt, schemat, `fakeLessonObjectives`):
  rozdział planuje planista agenta. `generateLessonObjectives` zostaje dla
  szkoły.

### 3.2. Co zostaje (agent z tego korzysta)

`buildPoolInput`, `poolStageCounts`, `objectiveBatchCounts`,
`minimumCountPerObjective`, `meetsStageMinimums`, `splitStages`,
`lessonSystemPrompt`, `lessonUserMaterial`, `lessonPoolJsonSchema`,
`finalizeLessonPoolWrite`, `failLessonPoolValidation`, `generateDynamicObjectives`
(szkoła), `markLessonRun`, `mergeExamples`, historyjka lekcji,
`sanitizeFreshLessonDraft`, `validatePool*`, `refineGeneratedPool`,
`materialize*`, `findExposureLeaks`, `classifyLessonGenerationFailure`,
`generationGaps`, `agent_checkpoint`, `UMIEM_LESSON_GENERATION_*`,
`UMIEM_LLM_*` (zagadnienia szkoły, historyjka). Parametry `buildPoolInput`
używane tylko przez potok (`existingAnswers`, `existingExercises`, `purpose`)
usuwamy.

Testy `llm.test.ts` sprawdzające treść promptu przez `generateLessonPool`
przenosimy na `lessonSystemPrompt`/`lessonUserMaterial` — bez utraty asercji
o treści.

### 3.3. `agentPolicy` obowiązkowe

`SubjectModule.agentPolicy` staje się wymagane (typ i walidacja rejestru przy
starcie). Trzy przedmioty produkcyjne już je mają. Testowy
`historyLikeSubject` dostaje politykę wzorowaną na szkole bez kontroli 2b
(`hintJudgeTypes` i `openAnswerCheckTypes` puste). Test architektury
(`module-boundaries` / rejestr) pilnuje, że każdy przedmiot w rejestrze ma
politykę. `AGENTS.md`: nowy przedmiot dodaje także `agentPolicy`.

## 4. PR 2: konfiguracja, tryb fake, panel

### 4.1. Konfiguracja

- `UMIEM_LESSON_AGENT_SUBJECTS` znika z `CONFIG_DEFAULTS`, `.env.example` i
  dokumentacji; pozostawiona w `.env` jest ignorowana (bez błędu).
- Pozostałe `UMIEM_LESSON_AGENT_*` (modele, wysiłek, limity, routing,
  `UMIEM_LESSON_AGENT_API_KEY`) bez zmian i są walidowane przy każdym starcie
  workera — błędna wartość zatrzymuje start z nazwą zmiennej, jak dziś.
- `lessonAgentDepsFromEnv` zwraca zależności agenta zawsze, gdy jest klucz
  OpenRouter; bez klucza zwraca wariant „niedostępny” (§4.4) zamiast
  `undefined` i ostrzeżenia o potoku.
- Grader kontroli otwartej szkoły bez zmian: bez pełnego `UMIEM_GRADER_*`
  szkoła działa bez kontroli otwartej (jak w 2b), log startu
  `openCheck=off`.

### 4.2. Tryb fake (`UMIEM_FAKE_PROVIDERS=1`)

- Lekcje generuje `FakeLessonPoolAgent`. Deterministyczny generator ćwiczeń z
  `FakeLlmProvider.generateLessonPool` przenosimy do `providers/fake-lesson-agent.ts`
  (funkcja fake'a, nie metoda portu `LlmProvider`); tryb `fromLlm` znika.
- `FAKE_SLOW_MARKER` działa w fake-agencie (opóźnienie 3 s na pierwszym kroku
  zagadnienia), bo E2E używa go do stanu „generowanie”.
- Checker fake: `FakeExerciseChecker` w trybie „poprawne odpowiedzi” zamiast
  `unavailable`, żeby tryb fake przechodził pełną ścieżkę przyjęcia (ślepe
  rozwiązanie zgodne z kluczem, warianty i podpowiedzi `ok`). Grader w fake
  nadal nieobecny (kontrola otwarta nie dotyczy).
- Planista rozdziału w fake daje zagadnienia z pokrycia (`fakePlanFromCoverage`)
  — tytuły zagadnień rozdziału w E2E zmieniają się z „Zagadnienie N: …” na
  tytuły planisty fake. Specy dopasowujemy do nowych tytułów.

### 4.3. Panel rodzica

- Katalog przedmiotów zawsze opisuje usługi agenta (`generationServices`,
  `checkService`, `checkServiceIncludesMaterial`, `openCheckService`) — bez
  warunku listy. `generationService` potoku znika z katalogu tam, gdzie
  dotyczył puli; zostaje informacja o usłudze zagadnień szkoły i historyjki,
  jeśli panel ją dziś pokazuje (sprawdzić w planie).
- `lessonAgentPublicFromEnv` liczy dostępność z tego samego klucza co worker
  (`lessonAgentKeyFromEnv` w `try`; web i worker czytają ten sam `.env`).

### 4.4. Brak klucza OpenRouter

- **Worker** startuje normalnie (słówka, media, kartkówki, ocena aktywności
  działają). Log startu jedną linią: `[config] lesson-agent=unavailable
  reason=no_openrouter_key`.
- **Run lekcji** (pełna generacja i „+N”) kończy się od razu `failed` z nowym
  kodem `lesson_agent_unavailable` (nieponawialny), bez wywołań modeli.
- **Panel:** komunikat błędu runu „Generowanie lekcji wymaga klucza
  OpenRouter w konfiguracji serwera.” (`messages.lessons.generationErrors`).
  Katalog dostaje pole `lessonGenerationAvailable: boolean` (web liczy je z
  klucza); formularz nowej lekcji i przycisk „Dogeneruj” pokazują przy `false`
  ten sam komunikat i są wyłączone.
- Klucz w złym kształcie (np. klucz OpenAI pod `OPENROUTER_API_KEY`) pozostaje
  błędem startu, jak dziś.

### 4.5. Prywatność

Bez zmian względem 2a/2b: generator, checker i grader dostają to, co dziś przy
przedmiocie na liście agenta. Zmienia się tylko to, że dotyczy to każdej
lekcji: domyślnymi odbiorcami danych lekcji stają się generator agenta
(OpenRouter, Gemini) i checker innej rodziny (OpenRouter, DeepSeek), w szkole
z materiałem; grader w workerze przy pełnym `UMIEM_GRADER_*`. Nigdy dane
dziecka. Panel nadal informuje o tych usługach. Opis PR i
`provider-config.md` wymieniają nowych domyślnych odbiorców wprost.

### 4.6. Koszt i wdrożenie

- Agent kosztuje więcej niż potok (budżet runu domyślnie 1,00 USD; próba
  2026-11-03: rozdział 0,11–0,15, gramatyka ok. 0,07, szkoła 0,20–0,31 USD
  plus kontrole 2b). `docs/deploy.md` i opis PR mówią to wprost.
- Bez migracji. Web i worker wdrażamy razem (katalog i run czytają ten sam
  klucz). Runy w kolejce sprzed wdrożenia przejdą agentem (agent ignoruje pola
  potoku w wejściu, start z pustym punktem kontrolnym).
- Wycofanie: `git revert` PR 2 (stary sposób wraca w całości); zmiennej
  przełączającej nie ma.

## 5. PR 2: testy

### 5.1. Testy integracyjne

- `tests/integration/fakes.ts`: fake'i generowania składają agenta
  (fake-agent + fake checker) zamiast `routeLessonRound`.
- `lesson-generation.test.ts` (56 testów) i `lesson-chapter.test.ts` (26):
  testy sprawdzające mechanikę potoku (partie, `MAIN_BATCH_ONLY`, rundy
  dogenerowania etapów, liczba żądań puli, reguła twarda po fakcie) usuwamy.
  Testy zachowań, które nadal obowiązują, przepisujemy na agenta, o ile nie
  pokrywa ich już `lesson-agent-generation.test.ts`: zapis do szkicu i
  wersjonowanie, anulowanie i `superseded`, ponowienia i błędy dostawcy,
  przykłady kart, historyjka, tematy zdań, „+N”, polecenie rodzica, temat
  dynamiczny szkoły, odrzucenie przy publikacji. Plan wymienia każdy test z
  decyzją (usunąć / przepisać / już pokryty przez …).
- `lesson-agent-generation.test.ts`: testy „przedmiot spoza listy idzie
  potokiem” usuwamy; dochodzi test braku klucza (`lesson_agent_unavailable`,
  zero wywołań modeli).
- Pliki ze zmianą tylko w składaniu (`lesson-story`, `child-interests`,
  `lesson-listen-choice`, `source-materials`, `lesson-parent-api`,
  `lesson-error-explanation`, `lesson-story-audio`, `publish-media-reconcile`,
  `grammar-without-tts`, `lesson-chapter-sentence-audio`,
  `lesson-sentence-audio`): dopasować oczekiwane liczby i tytuły do fake-agenta.

### 5.2. Unit, E2E, architektura

- Unit: `config.test.ts` (lista przedmiotów → klucz i dostępność),
  `lesson-agent-env.test.ts`, `lesson-agent-outcome.test.ts`, `fake.test.ts`,
  `fake-lesson-agent` (przeniesiony generator, `FAKE_SLOW_MARKER`, checker
  „poprawne”), `lesson-drafts.test.ts`, `lesson-generation-policy.test.ts`,
  `llm.test.ts` (przeniesienie asercji promptu), kompozycje web i worker
  (z kluczem i bez).
- E2E (`real`): `lesson-parent.spec.ts` (restart z `FAKE_SLOW_MARKER`,
  przykłady, luka + „Dogeneruj”), `lesson-real-flow`, `lesson-archive`,
  `lesson-parent-supervision`, `parent-sources` — dopasować do fake-agenta;
  nowy przypadek w mocked: formularz nowej lekcji przy
  `lessonGenerationAvailable: false`.
- Architektura: `tests/ai-sdk-scope.test.ts` i
  `lesson-agent-imports.architecture.test.ts` bez zmian w regułach (web nadal
  nie ładuje SDK — sprawdzić bundle jak w 2a); test „każdy przedmiot ma
  `agentPolicy`”.
- Przed PR: `pnpm check`, brak SDK w bundlu web, `pnpm test:integration`,
  pełny `pnpm test:e2e:shards`.

### 5.3. Test dymny na prawdziwych modelach

- Sonda `probe:chapter` po PR 2 generuje agentem (innej ścieżki nie ma).
  Zostaje rejestr kosztów, strażnik hosta i zapis poza repozytorium; usuwamy z
  niej wątki potoku i krytyka. `probe:agent` (bez bazy) zostaje do szybkich
  prób.
- **Bramka zgody:** przed uruchomieniem wiadomość do właściciela z planem
  (3 przebiegi: Unit 3, Present Simple, geografia — materiały z 2026-11-03),
  limitem rejestru 3 USD i commitem; bez „tak” nic nie startuje.
- **Sprawdzamy (bez ślepej oceny):** run kończy się `succeeded`; liczba
  ćwiczeń per zagadnienie i etap; `generationGaps` i braki publikacji;
  koszt (z `usage.cost`) i czas; histogram kodów odrzuceń i `checkCounters`
  z podsumowania; w szkole `openCheck=on` i niezerowe `openChecks`.
- **Wynik** trafia do opisu PR 2 (same liczby, bez treści). Przebieg z
  porażką albo bez ćwiczeń w którymś przedmiocie zatrzymuje PR do decyzji
  właściciela.
- Test dymny wykonujemy na gałęzi PR 2 po zielonych testach, przed otwarciem
  PR.

## 6. Dokumentacja (PR 2)

- `docs/architecture.md`: §19.3 (generowanie puli — agent zamiast partii),
  §19.15 (bez rund dogenerowania etapów), §19.17 (stan: jedyny generator,
  brak listy, brak klucza), odwołania do potoku.
- `docs/provider-config.md`: sekcja agenta bez listy przedmiotów i bez
  „powrotu do potoku”; brak klucza; nowi domyślni odbiorcy danych; koszt.
- `.env.example`: bez `UMIEM_LESSON_AGENT_SUBJECTS`.
- `docs/deploy.md`: „Aktualizacja aplikacji” — klucz OpenRouter wymagany do
  lekcji, koszt, wycofanie przez revert.
- `docs/SPEC.md` §29a.8 i §29a.10; `AGENTS.md` (punkty o agencie i
  `agentPolicy`, usunięcie „domyślnie wyłączony”); `docs/folder-structure.md`.
- Spece i plany etapów 1–2b zostają jako historia.

## 7. Ryzyka

- **Niepełne pule:** potok gwarantował minima etapów rundami dogenerowania;
  agent kończy z lukami (`generationGaps`) przy terminie lub budżecie. Rodzic
  widzi alert i „Dogeneruj”. Test dymny pokaże skalę na trzech lekcjach.
- **Koszt i czas lekcji** rosną (§4.6).
- **Zależność od OpenRouter:** bez klucza lekcje się nie generują (§4.4);
  awaria OpenRouter zatrzymuje generowanie lekcji (ponowienia jak dziś).
- **Nadmierne kasowanie:** wspólne elementy z §3.2 łatwo wziąć za kod potoku;
  plan wymienia je jawnie, a testy promptu przenosimy, nie usuwamy.
- **Duża zmiana testów** (ok. 100–150 testów integracyjnych do usunięcia lub
  przepisania): plan wymienia każdy test z decyzją, żeby nie zgubić zachowań.
- **Brak porównania jakości:** świadoma decyzja właściciela; jakość agenta
  oceniamy w użyciu.
