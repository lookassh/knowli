# Implementation Plan — silnik lekcji z modułami przedmiotów (pierwszy: gramatyka angielska)

Źródła: `requirements.md`, `design.md` w tym katalogu (design jest wiążący dla nazw, interfejsów i modelu danych). Wykonanie: subagent-driven-development — implementer per zadanie, niezależny review (spec + jakość) po każdym zadaniu, końcowe review całej gałęzi, PR do `main` bez scalania.

## Global Constraints

- Gałąź `feature/grammar-module`; nigdy commit na `main`. Każde zadanie = co najmniej jeden commit Conventional Commits.
- TDD: test zachowania przed implementacją, potwierdzony RED, potem GREEN. Testy domeny z kontrolowanym zegarem (czas jako argument), integracyjne na PostgreSQL (Docker, `pnpm test:integration`), providerzy zastąpieni fake-adapterami.
- Polecenia: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`, `pnpm contracts:export-learning-overview --check`. Na Windows pnpm: `C:\Users\looka\AppData\Local\npm-global\pnpm.cmd`; w PowerShell nie łączyć komend `&&`.
- SOLID: silnik lekcji (`domain/lessons/*` poza `subjects/`) nie zna angielskiego ani gramatyki; przedmiot podłączany przez `SubjectModule` i rejestr. Brak hardcodowanych wartości specyficznych dla przedmiotu w silniku; parametry polityki/selektora w konfiguracji, nie w literałach rozsianych po kodzie.
- Nie duplikować logiki istniejących modułów — wydzielać wspólne funkcje (blokady, rezerwacja `processing`, zapis ekspozycji, idempotencja, OSA) zamiast kopiować.
- Kid DTO nie zawiera odpowiedzi, wariantów, `focus`, celu, kategorii ani źródła oceny. Sekrety tylko po stronie serwera.
- Zachowanie słówek bez zmian: pełne istniejące suite muszą pozostać zielone po każdym zadaniu, które dotyka istniejących modułów.
- Kontrakt `learning-overview` v1 bez zmian (`--check` bez różnic).
- Komunikaty UI po polsku w `packages/contracts/src/messages.ts`; kod, identyfikatory i nazwy po angielsku.
- Implementer nie uruchamia subagentów i nie tworzy PR.

### Task 0: Przygotowanie gałęzi (kontroler)

- Gałąź `feature/grammar-module` z aktualnego `main`; `pnpm install --frozen-lockfile`; baseline unit/typecheck/integration.
- `.gitignore`: `.kiro/` → `.kiro/*` + `!.kiro/specs/`, aby spec był wersjonowany razem z implementacją.
- _Requirements: —_

### Task 1: Silnik lekcji — typy, rejestr przedmiotów, walidacja katalogu, bazowy normalizator

- `packages/server/src/domain/lessons/types.ts`, `registry.ts`, `catalog-validation.ts`, `base-error-categories.ts`, `normalize.ts` zgodnie z design „Przedmiot i katalog” i „Normalizacja” (bazowy normalizator).
- Rejestr: `registerSubject`/`getSubject(id)`/`listSubjects()`/`getTopic(subjectId, topicId, version)`/`getLatestTopic(subjectId, topicId)`; rejestr budowany z jawnej listy modułów (bez efektów ubocznych importu), możliwy do utworzenia z dowolną listą w testach.
- Typy etapów i mapa `LessonExerciseType → LessonStage` w silniku.
- Fixture przedmiotu testowego „history-like” w `tests/fixtures/lesson-subjects/` (bez skrótów angielskich, typy `lesson_choice`/`lesson_order`/`lesson_gap`/`lesson_open_answer`, własna kategoria błędu, cele z kartami i podpowiedziami).
- Testy: `validateSubject` (każda reguła z design), bazowy normalizator, rejestr (duplikat id przedmiotu odrzucony, nieznany temat/wersja), fixture przechodzi walidację, test architektoniczny: pliki silnika nie importują `subjects/`.
- _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 11.1, 11.2, 11.4, 11.5_

### Task 2: Moduł przedmiotu `english_grammar` z tematem Present Simple

- `domain/lessons/subjects/english-grammar/`: `normalizer.ts` (Decorator bazowego, tabela skrótów z design), `error-categories.ts`, `topics/present-simple.ts` (7 celów z requirements 1.4, karty po polsku 2–4 na cel z `{{examples}}`, szablony podpowiedzi dla każdej kategorii celu, `descriptionEn`, przekształcenia `to_negative`/`to_question`/`to_affirmative`, dozwolone typy), `prompts.ts` (profil promptów), `validators.ts` (np. odpowiedź luki zawiera formę podanego czasownika: `hint` = bezokolicznik; forma podstawowa, +s/+es/+ies lub z listy wyjątków `have→has`, `be→is/are/am`, `do→does`, `go→goes`), `module.ts` (składa `SubjectModule`).
- Rejestr produkcyjny (`domain/lessons/subjects/index.ts`) z listą `[englishGrammar]`.
- Testy: `validateSubject(englishGrammar)`; normalizator (`he's` → dwa rozwinięcia, `can't`, `doesnt`, apostrofy typograficzne, rozwinięcie przed porównaniem długości); walidator luki.
- _Requirements: 1.4, 6.1, 11.3_

### Task 3: Ocena odpowiedzi (czysta domena)

- `domain/lessons/evaluate.ts`: `matchLessonAnswer`, `validateVerdict`, `gradeFromMatch`, `gradeFromVerdict`, wybór najbliższego zatwierdzonego wariantu, budowa segmentów `plain`/`pill` po punktach kodowych; ocena typów zamkniętych (`choice` po id, `sequence` == kanoniczna).
- Wydzielenie OSA z `domain/spelling-diff.ts` do wspólnej funkcji (np. `domain/text-distance.ts`) bez zmiany zachowania `compareSpelling` (istniejące testy muszą przejść).
- Testy z design „Testing Strategy” dla oceny, z normalizatorem angielskim i z fixture przedmiotu.
- _Requirements: 4.3, 6.2, 6.3, 6.4, 6.7, 6.9, 6.11_

### Task 4: Kwalifikacja niezależności i projekcja postępu celu

- `domain/lessons/progress.ts`: `qualifyLessonAttempt`, `projectObjectiveProgress` z parametrami z istniejącej `Policy` (odczytać `domain/progress.ts`, `domain/independence.ts` i odwzorować regułę serii, potwierdzenia po przerwie i `nextReviewAt`; reużyć wspólne helpery zamiast kopiować).
- Testy z kontrolowanym zegarem wg design.
- _Requirements: 7.2, 7.3, 7.4, 7.5_

### Task 5: Selektor zadań lekcji

- `domain/lessons/scheduler.ts`: `selectLessonTask` z priorytetami z design; parametry selektora (`advanceAfterCorrect`, `maxNewObjectivesPerSession`, docelowy rozkład etapów) w obiekcie konfiguracji lekcji (`domain/lessons/lesson-policy.ts`), nie w literałach.
- Testy wg design (etapy, awans, cykl wsparcia raz na cel, „Nie pamiętam”, limit nowych celów, preferencja niewidzianych, należne sprawdzenie, okno sprawdzianu, brak modelu / zerowy limit, budżet i „Jeszcze 3”, wyczerpana pula → null).
- _Requirements: 5.1–5.8_

### Task 6: Walidacja puli, pokrycie etapów, plan kartkówki (czysta domena)

- `domain/lessons/pool-validation.ts`: walidacja ogólna z design + delegacja do `subject.validateExercise`; `coverage(pool, objectiveIds)` zwracająca braki wg minimów (3 prowadzone / 4 produktywne / 2 samodzielne na cel — w konfiguracji lekcji).
- `domain/lessons/mock-test-plan.ts`: proporcjonalne pokrycie celów, preferencja niewidzianych i produktywnych, deterministyczny wynik dla danego wejścia.
- Testy: każda reguła walidacji; pokrycie; plan kartkówki (proporcje, preferencje, mniej ćwiczeń niż porcja).
- _Requirements: 2.3, 2.5, 3.4, 9.3_

### Task 7: Migracja bazy i schemat Drizzle

- `packages/server/src/db/schema.ts` + `packages/server/drizzle/0007_lessons.sql` (+ snapshot/journal Drizzle) zgodnie z design „Data Models”, z triggerami; kod `objective` w `SKILLS` domeny (bez zmiany `REPORT_SKILLS`).
- Testy integracyjne `tests/integration/lesson-schema.test.ts`: każdy nowy CHECK/trigger odrzuca niepoprawny zapis i przepuszcza poprawny; istniejące dane słówek bez zmian; usunięcie profilu kasuje `child_objective_progress`, zostawia `lesson_verdicts`.
- Pełne `pnpm test:integration` zielone.
- _Requirements: 3.5, 9.2, 10.2_

### Task 8: Kontrakty

- `packages/contracts/src/lessons.ts` i rozszerzenia `kid.ts`, `decks.ts`, `messages.ts` zgodnie z design „Kontrakty”.
- Testy kontraktów: `.strict()` Kid DTO bez pól prywatnych; segmenty feedbacku; sekwencja w `AttemptInput`.
- `pnpm typecheck`, `pnpm contracts:export-learning-overview --check` bez różnic.
- _Requirements: 4.1, 7.7, 10.3_

### Task 9: Izolacja lekcji w istniejących modułach + regresja słówek

- Odczyt `decks.kind` w `learning-overview.ts`, `published-progress.ts`, `reporting.ts`, `kid.ts` (lista zestawów z `kind`/`subjectTitle`), `sessions.ts`/`attempts.ts` (lekcja → `deck_kind_mismatch` do czasu zadań 13/15).
- Test `tests/integration/lesson-isolation.test.ts`: opublikowana lekcja przypisana dziecku nie zmienia `ProgressDto` słówek, `learning-overview`, raportów kartkówek słówek; endpointy słówek dla lekcji zwracają `deck_kind_mismatch`.
- Pełne unit + integration + e2e zielone.
- _Requirements: 7.8, 10.3_

### Task 10: Generowanie puli (worker)

- Port `LlmProvider.generateLessonPool`, implementacja w adapterze OpenAI (prompt z profilu przedmiotu, partie per cel, structured output, walidacja w domenie), fake provider deterministyczny (także dla fixture przedmiotu).
- `modules/lessons/lesson-drafts.ts`: `createLesson` (szkic + `lesson_context` + generation_run w jednej transakcji, idempotencja jak `enqueueDeckGeneration`), wykonanie w workerze z walidacją puli (odrzucenia pojedyncze z licznikiem), przejście draft → review, `regenerateObjective` (`existingAnswers`), TTS odpowiedzi przez istniejący potok mediów, gdy `subject.ttsForAnswers`.
- Testy integracyjne `lesson-generation.test.ts`: idempotencja, częściowe odrzucenia, całkowity błąd bez publikacji, dogenerowanie bez duplikatów, restart workera, fixture przedmiotu nie-językowego przez cały przepływ generacji.
- _Requirements: 2.2–2.6, 11.4_

### Task 11: API rodzica — lekcje, edycja, publikacja, przypisania (serwer)

- `parent-router.ts` + moduły: katalog przedmiotów/tematów, tworzenie lekcji, odczyt szkicu, edycja ćwiczenia (walidacja puli, `expectedEditNumber`), dogenerowanie dla celu, zatwierdzenie celu, publikacja z wymogiem pokrycia (409 z listą braków), przypisanie z celem kartkówki `lesson`.
- Testy integracyjne `lesson-parent-api.test.ts`: autoryzacja, walidacje, konflikty wersji, publikacja z brakami i bez, niewidoczność szkicu w Kid API, przypisanie.
- _Requirements: 2.1, 2.7, 3.1–3.6_

### Task 12: UI rodzica — lekcje + E2E

- `apps/web/src/parent/lessons/`: formularz (przedmiot, temat, materiał ≤8000, instrukcja, cele, wielkość puli z domyślną formułą z requirements 2.1), przegląd pogrupowany po celach z zaznaczonym `focus`, edycja ćwiczenia, karty z przykładami, licznik odrzuconych, publikacja z komunikatem o brakach; lista zestawów rozróżnia rodzaj.
- E2E `tests/e2e/lesson-parent.spec.ts` (fake provider).
- _Requirements: 2.1, 3.1–3.4_

### Task 13: Sesja lekcji po stronie serwera (bez modelu oceniającego)

- `sessions.ts` → `modules/lessons/lesson-sessions.ts` (start z `lesson_context`, `nextTask` przez `selectLessonTask`, budowa promptów, zakończenie z podsumowaniem); `attempts.ts` → `modules/lessons/lesson-attempts.ts` (typy zamknięte, sekwencja, dopasowanie i literówka, zamrożenie kontekstu, ekspozycja poprawnej odpowiedzi przed HTTP, projekcja celu w tej samej transakcji, niedopasowana → nieocenione); `complete-presentation` dla `lesson_card`; `events.ts` (odsłuch jako wsparcie).
- Testy integracyjne `lesson-sessions.test.ts`: niezależność per `target_key` (także ujawnienie w innej lekcji/kartkówce), idempotentny retry, budżet, cykl wsparcia, „Nie pamiętam”, pominięcie, usunięcie profilu w trakcie, regresja słówek.
- _Requirements: 4.2, 4.3, 4.6, 5.1–5.8, 6.1–6.4, 6.13, 7.1–7.5_

### Task 14: Kid UI — ćwiczenia lekcji + E2E

- `packages/kid-ui/src/exercises/lesson/`: karta, wskazanie, wybór, klocki (dotknięcie dodaje/cofa), krótka odpowiedź, luka, pole tekstu (bez autokorekty), feedback z `answerSegments` i podpowiedzią; ekran zestawu dla lekcji (gwiazdki z opanowanych celów); bez importów Next.js/serwera.
- E2E `tests/e2e/lesson-kid.spec.ts`: karty → wskazanie → wybór → klocki → luka z błędem (zaznaczenie, podpowiedź, cykl wsparcia) → podsumowanie; bez mikrofonu; prywatność DTO.
- _Requirements: 4.1, 4.4, 4.5, 5.5, 7.7_

### Task 15: Model oceniający i cache werdyktów

- Port `AnswerGraderProvider`, adapter `providers/openai-compatible/grader.ts`, konfiguracja `UMIEM_GRADER_*` (https poza dev/test; brak = wyłączony), fake grader, `.env.example`.
- `lesson-attempts.ts`: cache z `parent_decision`, rezerwacja `processing` z inkrementem `graderCalls` pod blokadą, wywołanie poza transakcją, `validateVerdict`, zapis cache `ON CONFLICT DO NOTHING` + odczyt, finalizacja CAS, leniwa finalizacja.
- Selektor włącza typy otwarte przy dostępnym modelu (już w zadaniu 5 — tu tylko podłączenie `graderAvailable`/`graderCallsLeft`).
- Testy kontraktowe adaptera (fake HTTP), integracyjne `lesson-grader.test.ts` (sukces, timeout, odrzucony wynik, retry bez drugiego wywołania i bez inkrementu, równoległe identyczne odpowiedzi, limit, brak konfiguracji, token nieobecny w logach/DTO), E2E przekształcenia ocenionego fake graderem (`almost`, `incorrect`).
- _Requirements: 6.5–6.15_

### Task 16: Nadzór rodzica nad werdyktami, postęp celów, odbudowa projekcji

- API i UI: lista werdyktów modelu w lekcji, zmiana werdyktu (`parent_decision`) bez przeliczenia, oznaczenie ocen ze zmienionym werdyktem, „dodaj jako wariant” do następnego szkicu, informacja o providerze oceny.
- `modules/lessons/lesson-progress.ts` + widok postępu celów (status, najczęstsze kategorie z przykładami).
- `progress-rebuild.ts`: odbudowa `child_objective_progress` (dry-run, apply).
- Testy integracyjne + E2E panelu.
- _Requirements: 7.6, 8.1–8.3, 10.1_

### Task 17: Próbna kartkówka lekcji

- `mock-tests.ts` → `modules/lessons/lesson-mock-tests.ts`: plan z `mock-test-plan.ts`, brak feedbacku, ocena modelem dozwolona, limit czasu, omówienie z ekspozycjami, raport per cel z kategoriami i oznaczeniem ocen modelu; UI rodzica i omówienie dziecka.
- Testy integracyjne i E2E: zamrożona porcja, wznowienie, timeout, ćwiczenia z kartkówki widziane dla nauki, raport.
- _Requirements: 9.1–9.4_

### Task 18: Dokumentacja, MCP i pełna weryfikacja

- `docs/SPEC.md` (§10, §26, §30, A36, nowa sekcja lekcji i przedmiotów), `docs/architecture.md` (silnik lekcji, `SubjectModule`, model oceniający, rozgałęzienie po rodzaju zestawu, nowe tabele), `docs/folder-structure.md`, `AGENTS.md`, `.env.example`, `docs/provider-config.md`.
- `integrations/umiem-mcp/skills/umiem-learning/SKILL.md` i `docs/integrations/hermes-learning.md`: raport nie obejmuje jeszcze lekcji; `pnpm test:mcp`.
- Pełna weryfikacja: typecheck, unit, integration, e2e, build, `--check`.
- _Requirements: 10.3, 10.4_
