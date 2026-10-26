# Struktura projektu

Propozycja 1.2 • 7 października 2026  
Podstawa: architecture.md oraz SPEC.md 1.1. Tabele opisują uzgodnione granice; repozytorium jest już implementowane zgodnie z tym układem.

## 1. Organizacja

Jeden workspace pnpm. Dwie aplikacje wykonawcze, trzy współdzielone pakiety. To wystarczy do oddzielenia klienta od serwera i umożliwienia użycia Kid UI w innym hoście.

| Ścieżka | Rola |
| --- | --- |
| apps/web/ | Next.js: strony rodzica, host dziecka, API |
| apps/worker/ | Node.js: długie zadania przygotowania materiałów |
| packages/contracts/ | Zod, DTO i typy wspólne klient–serwer |
| packages/kid-ui/ | React: przenośny interfejs nauki |
| packages/server/ | Domena, przypadki użycia, baza i adaptery usług |
| tests/integration/ | Testy z PostgreSQL i fake-providerami |
| tests/e2e/ | Przepływy Playwright |
| tests/fixtures/ | Małe zatwierdzone zestawy i syntetyczne dane, bez nagrań dziecka |
| docs/ | Specyfikacja, architektura, próba techniczna i procedury |
| docs/integrations/ | Kontrakty JSON Schema i procedury integracji |
| apps/web/src/integrations/ | MCP Streamable HTTP adapter w istniejącym procesie web; współdzieli DTO, auth i use case |
| integrations/umiem-mcp/ | Wersjonowany walidator kontraktu, JSON Schema, manifest, lockfile Python i skill Hermesa; bez serwera MCP i dostępu do bazy |
| deploy/ | Compose, obrazy, skrypty migracji i backupu |

Serwer MCP Umiem! jest częścią `apps/web` pod `/api/mcp`. Pakiet `integrations/umiem-mcp/` nie uruchamia serwera; udostępnia przenośny walidator/schema/skill dla raportera Hermesa i jest instalowany jako wersjonowany pakiet konsumenta. Powiązane zasady aktualizacji API/MCP/skilla są w `AGENTS.md`.

Nazwy pakietów: @learning/contracts, @learning/kid-ui i @learning/server. apps/web jest @learning/web, apps/worker jest @learning/worker.

## 2. Host web

| Ścieżka | Odpowiedzialność |
| --- | --- |
| apps/web/src/app/layout.tsx | Wspólna powłoka, język i metadane |
| apps/web/src/app/learn/page.tsx | Osadzenie KidApp; bez pobierania sesji wymagającego SSR |
| apps/web/src/app/parent/page.tsx | Lista dzieci, tematów i wejście do postępów |
| apps/web/src/app/parent/decks/[id]/page.tsx | Edycja/podgląd zestawu |
| apps/web/src/app/parent/progress/page.tsx | Panel dziecka i zestawu |
| apps/web/src/app/api/v1/parent/[...path]/route.ts | Cienki dispatch zatwierdzonych operacji Parent API |
| apps/web/src/app/api/v1/kid/[...path]/route.ts | Cienki dispatch zatwierdzonych operacji Kid API |
| apps/web/src/app/api/openapi.json/route.ts | Read-only spec OpenAPI Kid API generowana z kontraktu `kidApiContract` |
| apps/web/src/app/api/v1/media/[id]/route.ts | Odczyt autoryzowanego zasobu |
| apps/web/src/app/api/health/route.ts | Liveness i readiness web (proces + baza) dla Compose |
| apps/web/src/app/manifest.ts | Manifest PWA |
| apps/web/src/orpc/base.ts | Kontekst oRPC i middleware: koperta AppError, kontrola Origin/CSRF |
| apps/web/src/orpc/handler.ts | Fabryka OpenAPIHandler: autorytatywna koperta błędu i mapa statusów |
| apps/web/src/orpc/request-limits.ts | Limity rozmiaru ciała: JSON, multipart audio i pre-check content-length |
| apps/web/src/orpc/parent-router.ts | Router oRPC Parent API — cały kontrakt /api/v1/parent (w tym auth) |
| apps/web/src/orpc/kid-router.ts | Router oRPC Kid API — cały kontrakt /api/v1/kid |
| apps/web/src/parent/orpc-contract.ts | Kontrakt Parent API (oRPC, wewnętrzny dla web; nie trafia do @learning/contracts) |
| apps/web/src/http/errors.ts | Jednolity format błędów i requestId |
| apps/web/src/http/security.ts | Sesja, Origin/CSRF, limity żądań |
| apps/web/src/parent/DeckEditor.tsx | Formularz szkicu, warianty i zasoby |
| apps/web/src/parent/DecksPanel.tsx | Lista zestawów, generowanie AI i tworzenie pustych szkiców |
| apps/web/src/parent/deck-editor-state.ts | Migawka formularza, serializacja PATCH i porównanie kart |
| apps/web/src/parent/DeckConflictPanel.tsx | Porównanie lokalnej i aktualnej wersji szkicu |
| apps/web/src/parent/generation-request.ts | Walidacja potwierdzenia 202 i klasyfikacja definitywnych odrzuceń generacji |
| apps/web/src/parent/useParentLeaveGuard.ts | Kontrola wyjścia z niezapisanej edycji rodzica |
| apps/web/src/parent/LeaveEditorDialog.tsx | Dostępny dialog „Zostań / Opuść bez zapisu” |
| apps/web/src/parent/ChildEditor.tsx | Profile i przypisania |
| apps/web/src/parent/ProgressPanel.tsx | Widok postępu i pomyłek |
| apps/web/src/composition.ts | Złożenie zależności serwerowych dla web |

Catch-all jest wyłącznie mapą jawnie dozwolonych operacji, nie dynamicznym dostępem do modułów ani bazy. Jeżeli router urośnie, można podzielić go na route.ts poszczególnych endpointów bez zmiany API. Wszystkie endpointy mutujące są dynamiczne i nie są cache'owane jako strony.

## 3. Przenośny interfejs dziecka

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/kid-ui/src/KidApp.tsx | Główne widoki, przejścia i złożenie przenośnych ekranów |
| packages/kid-ui/src/api/client.ts | KidApi na OpenAPILink (oRPC) z konfigurowalnym baseUrl |
| packages/kid-ui/src/theme/KidThemeProvider.tsx | Scoped Mantine theme dla dziecięcego UI |
| packages/kid-ui/src/layout/KidPage.tsx | Pomiar viewportu i hostowy podział flow/session |
| packages/kid-ui/src/layout/KidScreen.tsx | Wspólny ekran Mantine z nagłówkiem, treścią i akcjami |
| packages/kid-ui/src/components/ | Wspólne przyciski, postęp, ikony i feedback dostępny dotykowo |
| packages/kid-ui/src/screens/ | Ekrany profilu, talii, podsumowań, próbnych testów i przebiegu lekcji |
| packages/kid-ui/src/exercises/ExerciseView.tsx | Wybór widoku według rodzaju ćwiczenia |
| packages/kid-ui/src/exercises/ExerciseFrame.tsx | Wspólny nagłówek, materiał, wynik oraz dolne akcje ćwiczenia |
| packages/kid-ui/src/exercises/ | Widoki ćwiczeń, pisania, odpowiedzi obrazkowych, mowy i lekcji |
| packages/kid-ui/src/session/ | Kontroler sesji, odczyt stanu i lokalne zdarzenia aktywności |
| packages/kid-ui/src/media/ | Przenośne interfejsy nagrywania, odtwarzania i preferencji |
| packages/kid-ui/src/visuals/ | Wizualizacje znaczeń i okładek |
| packages/kid-ui/src/styles.css oraz pliki CSS Modules | Warstwa wizualna Kid UI i style własnych komponentów Mantine |

Uzupełnienie UI (2026-10-24): `KidThemeProvider` ogranicza nocny motyw Mantine do aplikacji dziecka; `KidPage` mierzy viewport bez zależności od Next.js, a `KidScreen` i `ExerciseFrame` dzielą widok na stabilne sloty. Style rodzica pozostają poza tym zakresem. Macierz Playwright obejmuje wirtualne ekrany telefonów, tabletów i desktopu; nie jest odbiorem fizycznego urządzenia. Fizyczny test Galaxy S10e/PWA pozostaje osobnym dowodem.

Nie importujemy tutaj next/navigation, next/image, Server Actions ani @learning/server. Zwykły img i serwerowy media URL wystarczą do ilustracji. Transport API nie jest wbudowany w komponent ćwiczenia; dostarcza go KidApp przez zależność.

## 4. Kontrakty i domena

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/contracts/src/common.ts | Identyfikatory, błędy, daty |
| packages/contracts/src/decks.ts | Publiczne schematy zestawów i poleceń rodzica |
| packages/contracts/src/kid.ts | Publiczne TaskDto, AttemptInput, AttemptDto, SessionDto, DisclosureInput/Dto, PresentationCompletionInput/Dto |
| packages/contracts/src/progress.ts | Podsumowanie per umiejętność |
| packages/contracts/src/messages.ts | Jeden katalog polskich komunikatów UI współdzielony przez web i kid-ui; bez logiki |
| packages/server/src/domain/types.ts | Prywatne AnswerKey, Grade, History, Policy |
| packages/server/src/domain/evaluate.ts | Reguły treści i pisowni |
| packages/server/src/domain/independence.ts | Kwalifikacja próby i ekspozycje |
| packages/server/src/domain/task-completion.ts | Decyzja o stanie zadania po próbie; `attempts.ts` koordynuje zapis wyniku |
| packages/server/src/domain/task-materialization.ts | Składa prompt i prywatny klucz z gotowych opcji; `sessions.ts` tasuje opcje, tworzy ID i zapisuje zadanie |
| packages/server/src/domain/session-limits.ts | Czyste limity czasu sesji współdzielone przez sesje, próby i raportowanie |
| packages/server/src/domain/progress.ts | Wyliczanie projekcji z historii |
| packages/server/src/domain/learning-work.ts | Oddzielne terminy i gotowość Recall, pisowni i wymowy |
| packages/server/src/domain/support-cycle.ts | Odtwarzanie pojedynczego cyklu wsparcia z historii sesji |
| packages/server/src/domain/recognition-options.ts | Bezpieczne, unikalne opcje rozpoznawania i fragmentów |
| packages/server/src/domain/confusion-priority.ts | Kierunkowe rankowanie wiarygodnych mylonych par |
| packages/server/src/modules/learning/skill-history.ts | Odczyt historii ocen ograniczony do dziecka, skill version i umiejętności |
| packages/server/src/modules/learning/skill-projections.ts | Wspólny zapis projekcji postępu |
| packages/server/src/modules/learning/learning-snapshot.ts | Zbiorcza migawka postępu, pracy, ekspozycji i pomyłek |
| packages/server/src/domain/scheduler.ts | Wybór ćwiczenia z ochroną celów oczekujących na samodzielne sprawdzenie |
| packages/server/src/domain/test-preparation.ts | Czyste wyznaczanie 48-godzinnego okna terminu w strefie rodziny, z obsługą DST |
| packages/server/src/domain/feedback.ts | Komunikaty zgodne z wynikiem |
| packages/server/src/domain/revision-impact.ts | Mapa wpływu zmiany treści na skill_versions |
| packages/server/src/domain/policies/learning-v1.ts | Jawne parametry i wersja algorytmu |

Typy bazy nie są DTO. Pole answer_key nigdy nie jest częścią eksportu packages/contracts. Biblioteka domeny nie odczytuje Date.now() ani zmiennych środowiskowych; czas i konfiguracja są argumentami.

Komunikaty wynikowe generowane przez domenę (feedback.ts) trafiają do klienta w DTO; statyczne etykiety ekranów, przycisków i błędów UI dla web oraz kid-ui pochodzą wyłącznie z messages.ts. Locale UI, treści i wymowy pozostają osobnymi wartościami; nie budujemy przełącznika języka ani systemu tłumaczeń.

## 5. Przypadki użycia i infrastruktura

Przypadki użycia w `packages/server/src/modules/` są pogrupowane w cztery obszary produktu: `materials/` (zestawy, rewizje, generowanie, zasoby), `learning/` (sesje, zadania, próby, oceny, ekspozycje, projekcje, kartkówki), `family/` (profile, dostęp rodzica, tokeny integracyjne) i `reporting/` (modele odczytu postępu i aktywności). Każdy obszar ma wąski `index.ts` jako publiczne API; inne obszary importują wyłącznie z barrela, a wewnątrz obszaru obowiązują bezpośrednie importy plików. Dozwolone kierunki to reporting → learning → materials oraz zależność każdego obszaru od `family`; moduły źródłowe nie importują raportowania. Granic pilnuje `packages/server/src/modules/module-boundaries.architecture.test.ts`, który dodatkowo sprawdza, że czysta domena (`src/domain`) nie importuje modułów ani infrastruktury. Publiczne `packages/server/src/index.ts` komponuje eksporty pakietu z barreli obszarów; klienci web i worker korzystają wyłącznie z `@learning/server`. Wyjątek stanowią testy integracyjne, które dla kilku wewnętrznych helperów (np. zapis ekspozycji, migawka nauki) importują pliki obszarów bezpośrednio — to jawnie nazwany dług testowy, nie druga ścieżka wykonania.

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/server/src/modules/family/profiles.ts | Tożsamość i preferencje profilu, kasowanie danych dziecka |
| packages/server/src/modules/learning/learning-settings.ts | Ustawienia polityki nauki dziecka (progi wymowy, nowe wersje polityki) |
| packages/server/src/modules/family/auth.ts | Hasło/PIN, sesje i limity logowania |
| packages/server/src/modules/materials/decks.ts | Szkice, rewizje, przypisania, publikacja |
| packages/server/src/modules/materials/generation.ts | Zlecanie zestawu słówek, odczyt i retry runów; wykonanie treści słówek oraz delegowanie runów mediów |
| packages/server/src/modules/materials/generation-runs.ts | Współdzielony cykl życia runów generacji (zlecenie idempotentne, claim CAS, status, unieważnianie runów lekcji) dla wykonawców słówek, lekcji i mediów |
| packages/server/src/modules/materials/media-generation.ts | Wykonanie jednego zasobu TTS/ilustracji: lease assetu, wywołanie providera, zapis niezmiennego pliku i finalizacja asset/run |
| packages/server/src/modules/materials/generation-runtime.ts | Wspólne wymagane zależności generowania, limit prób i klasyfikacja błędów dla wykonawców oraz workera |
| packages/server/src/modules/materials/generation-worker.ts | Koordynacja pracy generowania: odczyt kolejek, limity i delegowanie do wykonawców słówek, lekcji i mediów |
| packages/server/src/modules/materials/worker-schedule.ts | Reguły rotacji kolejek i obsługi wolnych slotów, bez zależności od bazy |
| packages/server/src/modules/materials/media-reconciliation.ts | Dopasowanie fingerprintów szkicu, zachowanie zgodnych zasobów i enqueue brakujących |
| packages/server/src/modules/learning/sessions.ts | Start/resume, koordynacja next i starsze planowanie treningu, historia ekspozycji, completePresentation, koniec |
| packages/server/src/modules/learning/vocabulary-plan-tasks.ts | Wybór i pomijanie slotu z niezmiennego planu; wydanie deleguje do wspólnego writera |
| packages/server/src/modules/learning/vocabulary-task-issuance.ts | Wspólny zapis zadania treningu słownictwa, faktów, ekspozycji i rezerwacji w Tx koordynatora |
| packages/server/src/modules/learning/mock-test-reports.ts | Publiczny dispatch raportu, listy i omówienia do implementacji kartkówki słówek albo lekcji; istniejące operacje zachowują własne transakcje, blokady, zamykanie sesji i zapis ekspozycji |
| packages/server/src/domain/training-session-plan.ts | Prywatny format planu treningu słówek, walidacja wersji oraz niezmienne sloty |
| packages/server/src/modules/learning/events.ts | Kontekst sesji i zapis/zamknięcie ujawnienia przed HTTP; opcjonalne potwierdzenia klienta |
| packages/server/src/modules/learning/attempts.ts | Rezerwacja i finalizacja prób |
| packages/server/src/modules/learning/speech.ts | Krótka analiza nagrania i wynik częściowy |
| packages/server/src/modules/reporting/reporting.ts | Postęp i mylone pary |
| packages/server/src/modules/learning/progress-rebuild.ts | Dry-run oraz transakcyjna, scoped odbudowa projekcji z historii |
| packages/server/src/db/client.ts | Połączenie, pula i transakcje |
| packages/server/src/db/schema.ts | Autorytatywna definicja tabel Drizzle po implementacji |
| packages/server/src/db/queries/ | Konkretne zapytania grupowane według modułu |
| packages/server/src/ports/ai.ts | LlmProvider, TtsProvider, SttProvider, PronunciationProvider, ImageProvider |
| packages/server/src/ports/media.ts | MediaStore |
| packages/server/src/providers/openai/ | Adaptery LLM i TTS; modeli nie zapisujemy w domenie |
| packages/server/src/providers/azure/ | Ocena wymowy i ewentualna niezależna transkrypcja |
| packages/server/src/providers/images/ | Pierwszy wybrany adapter ilustracji |
| packages/server/src/providers/media/local.ts | Prywatny wolumen; putImmutable/get, zapis bez nadpisywania blobów |
| packages/server/src/providers/audio/normalize.ts | Limity i konwersja audio w pamięci |
| packages/server/src/config.ts | Walidacja konfiguracji i zależności |
| packages/server/drizzle/ | Migracje SQL i snapshoty Drizzle |
| packages/server/drizzle.config.ts | Ustawienia generatora migracji |
| apps/worker/src/main.ts | Rejestracja zadań i graceful shutdown |
| apps/worker/src/rebuild-progress.ts | Jednorazowe CLI odbudowy projekcji; nie uruchamia pętli workera |
| apps/worker/src/tasks.ts | Powiązanie nazw Graphile z przypadkami użycia |
| apps/worker/src/composition.ts | Składanie zależności workera |

DocumentAnalysisProvider pojawi się dopiero podczas budowy source_material. Nie tworzymy pustych adapterów wszystkich przyszłych usług.

## 6. Testy i deployment

| Ścieżka | Rola |
| --- | --- |
| packages/server/src/domain/*.test.ts | Testy reguł z kontrolowanym zegarem |
| tests/test-run-config.ts | Izolacja zasobów równoległych przebiegów Vitest i Playwright przez run ID |
| tests/test-run-config.test.ts | Walidacja run ID, portu i wartości domyślnych runnerów |
| tests/integration/auth-profiles.test.ts | Sesje rodzica, profile, usuwanie |
| tests/integration/revisions.test.ts | Niezmienność wersji i wpływ edycji |
| tests/integration/generation.test.ts | Idempotencja, retry, stary draft, reconcile i asset lease |
| tests/integration/media.test.ts | Niezmienność gotowych zasobów i zapis no-clobber przy spóźnionym workerze |
| tests/integration/history.test.ts | Niezmienne zadania/oceny/ujawnienia i usunięcie profilu |
| tests/integration/learning-algorithm.test.ts | Wielodniowa regresja harmonogramu dla dwóch profili i dużego zestawu |
| tests/integration/progress-rebuild.test.ts | Dry-run, izolacja dzieci, odtworzenie i idempotencja projekcji |
| tests/integration/sessions.test.ts | Granice sesji, completePresentation, budżet, wersje i ujawnienia bez ACK |
| tests/e2e/test-preparation.spec.ts | Wcześniejsza ekspozycja → sprawdzian → pisemne Recall bez mikrofonu |
| tests/integration/attempts.test.ts | Atomowość i retry odpowiedzi |
| tests/integration/speech.test.ts | Timeouty, zatwierdzone warianty, częściowy wynik, brak audio na dysku |
| tests/integration/reporting.test.ts | Rozdzielenie dzieci i mylonych par |
| tests/e2e/parent-flow.spec.ts | Generacja → review → publikacja |
| tests/e2e/kid-flow.spec.ts | Sesja z mikrofonem i bez, błędy sieci |
| tests/e2e/privacy.spec.ts | Brak sekretów i odpowiedzi w DTO |
| tests/e2e/learning-algorithm.spec.ts | Mały zestaw i cykl pomocy w interfejsie dziecka |
| docs/speech-spike.md | Wynik weryfikacji mowy i kodeków, bez surowych nagrań |
| docs/provider-config.md | Wybrane modele i parametry bez kluczy |
| docs/backup-restore.md | Procedura i zapis testu odtworzenia |
| docs/operations/progress-rebuild.md | Okno serwisowe, backup/restore i bezpieczne uruchomienie odbudowy |
| deploy/Dockerfile | Wieloetapowy build web i worker |
| deploy/compose.yaml | Web, worker, db i wolumeny |
| deploy/migrate.ts | Jednorazowe migracje aplikacji i kolejki |
| deploy/backup.sh | Zrzut bazy i zasoby |
| deploy/restore.sh | Kontrolowane odtworzenie |
| .env.example | Nazwy i przykładowe niesekretne ustawienia |
| pnpm-workspace.yaml / package.json | Workspace i polecenia sprawdzeń |

## 7. Czego nie tworzymy teraz

Uzupełnienie #30 (2026-10-10): `contracts/src/mock-tests.ts` definiuje cele, liczbę i publiczne raporty; prywatne typy planu są w `server/src/domain/mock-test-types.ts`. `mock-test-plan.ts` dobiera zamrożoną porcję, `mock-test-report.ts` liczy pełny zakres, a `server/src/modules/learning/mock-tests.ts` wydaje sloty, zamyka próbę i czyta raport/omówienie. Migracja `server/drizzle/0004_mock_tests.sql` dodaje konfigurację przypisania, tryb i niezmienność planu/raportu. `kid-ui/src/screens/MockTestSummaryScreen.tsx` obsługuje potwierdzenie porcji i omówienie; rodzic korzysta z `web/src/parent/AssignmentTestGoalFields.tsx` oraz `MockTestReportPanel.tsx`. Synthetic fixtures pozostają w `tests/fixtures/mock-test-world.ts`; nowe testy obejmują `mock-test-settings`, `mock-tests`, `mock-test-reporting` (PostgreSQL) i `mock-test`, `mock-test-parent` (E2E).

Brak apps/android, osobnego backendu Express/Nest, package OCR, repozytorium wektorowego i systemu pluginów. Przyszły host Capacitor będzie konsumował @learning/kid-ui i @learning/contracts oraz istniejące API. Nie trzeba dziś budować go tylko po to, aby wykazać możliwość rozbudowy.

Lekcje i moduły przedmiotów (moduł gramatyki, 2026-10-12): silnik i przedmioty żyją w `packages/server/src/domain/lessons/**`, a przypadki użycia w obszarach lekcji: autorstwo i generowanie w `packages/server/src/modules/materials/lessons/**`, silnik sesji i prób w `packages/server/src/modules/learning/lessons/**`. Dodane ścieżki:

| Ścieżka | Rola |
| --- | --- |
| packages/server/src/domain/lessons/types.ts | `SubjectModule`, `LessonTopic`, `LearningObjective`, `ErrorCategory`, `LessonExerciseType`, `LessonStage`, `AnswerNormalizer` |
| packages/server/src/domain/lessons/registry.ts | Rejestr przedmiotów (`getSubject`, `listSubjects`, `getTopic`) |
| packages/server/src/domain/lessons/catalog-validation.ts | `validateSubject` — spójność katalogu |
| packages/server/src/domain/lessons/base-error-categories.ts | Kategorie błędów wspólne dla przedmiotów |
| packages/server/src/domain/lessons/normalize.ts | Bazowy normalizator tekstu (NFC, apostrofy, interpunkcja, tokenizacja) |
| packages/server/src/domain/lessons/stages.ts | Mapa typ → etap i etapy oceniane |
| packages/server/src/domain/lessons/evaluate.ts | Dopasowanie, tolerancja literówki, walidacja i interpretacja werdyktu |
| packages/server/src/domain/lessons/progress.ts | Kwalifikacja niezależności i projekcja per cel |
| packages/server/src/domain/lessons/scheduler.ts | Selektor zadań lekcji |
| packages/server/src/domain/lessons/lesson-policy.ts | Parametry selektora/polityki lekcji |
| packages/server/src/domain/lessons/pool-validation.ts | Walidacja ćwiczeń (ogólna + walidatory przedmiotu) |
| packages/server/src/domain/lessons/mock-test-plan.ts | Plan kartkówki lekcji |
| packages/server/src/domain/lessons/subjects/english-grammar/ | `module.ts`, `normalizer.ts`, `error-categories.ts`, `validators.ts`, `prompts.ts`, `topics/present-simple.ts`, `topics/to-be.ts` |
| packages/server/src/domain/lessons/testing/history-like-subject.ts | Fixture przedmiotu nie-językowego (dowód niezależności silnika) |
| packages/server/src/modules/materials/lessons/ | `lesson-api.ts`, `lesson-drafts.ts`, `lesson-supervision.ts`, `lesson-generation-{control,errors,policy}.ts` (autorstwo, generowanie i nadzór nad materiałem lekcji) |
| packages/server/src/modules/learning/lessons/ | `lesson-sessions.ts`, `lesson-attempts.ts`, `lesson-materialize.ts`, `lesson-mock-tests.ts`, `lesson-deck-overview.ts` (sesje, próby i kartkówki lekcji) |
| packages/server/src/ports/ai.ts | + `AnswerGraderProvider`, `LlmProvider.generateLessonPool` |
| packages/server/src/providers/openai-compatible/grader.ts | Adapter modelu oceniającego (zgodny z OpenAI) |
| packages/contracts/src/lessons.ts | DTO lekcji, ćwiczeń, postępu celów, werdyktów, raportu kartkówki, katalogu przedmiotów |
| packages/kid-ui/src/exercises/lesson/ | Widoki ćwiczeń lekcji |
| apps/web/src/parent/lessons/ | Formularz lekcji, przegląd puli, werdykty, postęp |
| packages/server/drizzle/0007_lessons.sql | Migracja: `decks.kind`, `lesson_context`, `lesson_verdicts`, `child_objective_progress`, triggery i CHECK-i |

Testy lekcji: `packages/server/src/domain/lessons/*.test.ts` (jednostkowe, kontrolowany zegar), `tests/integration/lesson-*.test.ts` (PostgreSQL + fake grader), `tests/e2e/lesson-*.spec.ts` (Playwright, fake providerzy). Fixtures lekcji w `tests/fixtures/`.

Edycja profilu: `contracts/src/decks.ts` definiuje `ChildPatchSchema`, `server/src/modules/family/profiles.ts` implementuje `updateChild`, a PATCH `/children/{id}` udostępnia router oRPC Parent API (`apps/web/src/parent/orpc-contract.ts` + `apps/web/src/orpc/parent-router.ts`). `ChildEditor.tsx` odpowiada także za formularz imienia i awatara; istniejąca historia nie jest modyfikowana.

### Wariant obrazkowy słownictwa (2026-10-14)

Zgodność profilu, wersji zestawu i Kid UI: `packages/contracts/src/kid.ts`, `decks.ts`, `ui-audio.ts`; domena/publikacja/generowanie: `packages/server/src/domain/vocabulary-capabilities.ts`, `picture-recognition-options.ts`, `modules/materials/decks.ts` i `modules/learning/sessions.ts`; migracja schematu: `packages/server/drizzle/0010_picture_vocabulary.sql`. Kid UI korzysta z `src/visuals/MeaningVisualView.tsx`, `src/session/guidance-audio.ts`, `src/exercises/Picture*.tsx` oraz istniejącego `KidApi` — bez importu serwera. Testy regresji: `tests/integration/picture-vocabulary.test.ts`, `packages/kid-ui/src/session/session-controller.test.ts` i `tests/e2e/picture-vocabulary.spec.ts`. Raport MCP pozostaje `learning-overview` v1; nie ma nowego endpointu ani schematu konsumenta.

### Okładka zestawu słownictwa (2026-10-15)

Wspólne ustawienie `decks.cover_asset_id`, migracja `0011_deck_cover_image.sql`, endpoint rodzica `/decks/{id}/cover`, walidacja i zapis przez `modules/materials/deck-cover.ts`; Kid API zwraca opcjonalne `coverAssetId`. Rodzic może podglądać lub usunąć okładkę dla zestawu słownictwa. Kid UI wyświetla ją przed dotychczasowym `coverVisual`; MCP i treść wersji zestawu pozostają bez zmian.

### Aktywna praca do rozliczeń nagród (2026-10-16)

Kontrakt sygnału i ograniczonego podsumowania: `packages/contracts/src/reward-activity.ts`; reguły limitów: `packages/server/src/domain/reward-activity.ts`; utrwalenie i transakcyjne rozliczenie: `packages/server/src/modules/reward-activity.ts`, `attempts.ts`, `sessions.ts`, migracja `0012_reward_activity.sql`. Kid UI wysyła sygnały z `session-controller.ts` i hooka cyklu życia; Kid API znajduje się w `apps/web/src/orpc/kid-router.ts`. Odczyt rodzica `GET /reward-activity/{childId}` wymaga Parent Mode i jest w `apps/web/src/orpc/parent-router.ts`. Testy: `packages/contracts/src/reward-activity.test.ts`, `packages/server/src/domain/reward-activity.test.ts`, `tests/integration/reward-activity.test.ts` i `packages/kid-ui/src/session/session-controller.test.ts`. Raport MCP i jego skill pozostają bez zmian, bo nie konsumują nowego endpointu.

Naliczanie punktów i podsumowania: settlement przechowuje czas, punkty, resztę oraz stabilny `deck_id`; `packages/server/src/domain/reward-activity.ts` zawiera arytmetykę minut i podział dni lokalnych, a `packages/server/src/modules/reward-activity.ts` odczytuje widoki dziecka. Kid DTO/teksty są w `packages/contracts/src/kid.ts` i `messages.ts`; ekrany to `ProfileScreen.tsx`, `DeckScreen.tsx` i `SummaryScreen.tsx`. Migracja `0013_reward_points.sql`. MCP nie konsumuje nagród i zachowuje estymowaną semantykę `learning-overview`.

### Projekcje nagród i wycofanie rundy dnia (2026-10-17)

`packages/server/drizzle/0016_reward_projections_and_retire_daily_round.sql` odtwarza `child_reward_projection`, `deck_reward_projection` i `reward_day_projection`, kończy istniejące aktywne rundy bez settlementu oraz blokuje tworzenie aktywnej sesji `daily_round`. `packages/server/src/modules/reward-activity.ts` utrzymuje projekcje w transakcji settlementu i używa ich przy odczytach profili, zestawów oraz rezerwacji Xbox; ręczna odbudowa pojedynczego dziecka pozostaje jawna. Usunięto start rundy i preflight z `modules/learning/sessions.ts`, `modules/lessons/`, API wejściowego oraz Kid UI; historyczny tryb jest zachowany w DTO i widoku karty rodzica. Zmiana DTO Kid/Parent Work Card nie zmienia `learning-overview`: MCP, walidator, JSON Schema i skill Hermesa nie konsumują tych kontraktów ani nagród.
