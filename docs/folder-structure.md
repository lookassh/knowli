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
| integrations/umiem-mcp/ | Wersjonowany adapter MCP/stdio, lockfile Python i skill Hermesa; bez dostępu do bazy |
| deploy/ | Compose, obrazy, skrypty migracji i backupu |

Integracja agentów Umiem! utrzymuje kod MCP, Python lockfile, kontrakt i skill w `integrations/umiem-mcp/`. Pakiet nie jest częścią workspace pnpm ani procesu web/worker; komunikuje się wyłącznie przez API i jest instalowany u konsumenta z wersji tego repo. Powiązane zasady aktualizacji API/MCP/skilla są w `AGENTS.md`.

Nazwy pakietów: @learning/contracts, @learning/kid-ui i @learning/server. apps/web jest @learning/web, apps/worker jest @learning/worker.

## 2. Host web

| Ścieżka | Odpowiedzialność |
| --- | --- |
| apps/web/src/app/layout.tsx | Wspólna powłoka, język i metadane |
| apps/web/src/app/learn/page.tsx | Osadzenie KidApp; bez pobierania sesji wymagającego SSR |
| apps/web/src/app/parent/page.tsx | Lista dzieci, tematów i wejście do postępów |
| apps/web/src/app/parent/decks/[id]/page.tsx | Edycja/podgląd zestawu |
| apps/web/src/app/parent/progress/page.tsx | Panel dziecka i zestawu |
| apps/web/src/app/api/v1/parent/login/route.ts | Login i cookie rodzica |
| apps/web/src/app/api/v1/parent/[...path]/route.ts | Cienki dispatch zatwierdzonych operacji Parent API |
| apps/web/src/app/api/v1/kid/[...path]/route.ts | Cienki dispatch zatwierdzonych operacji Kid API |
| apps/web/src/app/api/v1/media/[id]/route.ts | Odczyt autoryzowanego zasobu |
| apps/web/src/app/api/health/route.ts | Liveness i readiness web (proces + baza) dla Compose |
| apps/web/src/app/manifest.ts | Manifest PWA |
| apps/web/src/parent/parent-router.ts | Jawna tabela endpointów rodzica |
| apps/web/src/http/kid-router.ts | Jawna tabela endpointów dziecka |
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
| packages/kid-ui/src/KidApp.tsx | Główne widoki i przejścia |
| packages/kid-ui/src/api/client.ts | KidApi z konfigurowalnym baseUrl |
| packages/kid-ui/src/session/useLearningSession.ts | Stan sesji, zapis i wznowienie |
| packages/kid-ui/src/screens/ProfilePicker.tsx | Wybór dziecka |
| packages/kid-ui/src/screens/DeckPicker.tsx | Przypisane tematy |
| packages/kid-ui/src/screens/SessionScreen.tsx | Jedno zadanie, odsłuch, feedback |
| packages/kid-ui/src/screens/SessionSummary.tsx | Krótkie podsumowanie bez score |
| packages/kid-ui/src/exercises/Exposure.tsx | Prezentacja nowego słowa |
| packages/kid-ui/src/exercises/Choice.tsx | Rozpoznawanie słuchowe, tekstowe i odwrotne |
| packages/kid-ui/src/exercises/Recall.tsx | Odpowiedź ustna lub pisemna |
| packages/kid-ui/src/exercises/Pronunciation.tsx | Powtarzanie widocznego wzorca |
| packages/kid-ui/src/exercises/SpeechRecordButton.tsx | Gest z trybu profilu, stan mikrofonu i klawiatura |
| packages/kid-ui/src/exercises/recording-gesture.ts | Czysta redukcja gestu nagrywania |
| packages/kid-ui/src/screens/SpeechFeedbackCard.tsx | Nie-modalny, dostępny wynik mowy i następne działanie |
| packages/kid-ui/src/screens/speech-feedback-view.ts | Uczciwe mapowanie statusu STT/wymowy na tekst i ton |
| packages/kid-ui/src/exercises/Spelling.tsx | Luki i pełny zapis |
| packages/kid-ui/src/media/platform.ts | Interfejsy nagrywania/odtwarzania i lokalnych preferencji urządzenia (bez trybu profilu) |
| packages/kid-ui/src/media/browser.ts | Implementacja przeglądarkowa |
| packages/kid-ui/src/visuals/Visual.tsx | Kolor, liczba, sekwencja, obraz albo brak |
| packages/kid-ui/src/styles.css | Motyw dziecka i style Tailwind |

Uzupełnienie UX (2026-10-11): `kid-ui/src/layout/viewport.ts` mierzy widoczny viewport bez zależności od Next.js; `layout/KidPage.tsx` rozdziela ograniczoną ramę sesji od naturalnego widoku `flow`, a `exercises/ExerciseFrame.tsx` współdzieli instrukcję, materiał, wynik i akcje. `components/KidIcon.tsx`, `exercises/exercise-presentation.ts` oraz `screens/deck-presentation.ts` dostarczają zamknięte ikony i prezentację bez zmiany DTO. Host web ustawia viewport wyłącznie dla tras dziecka. Testy Playwright w `tests/e2e/kid-ui-layout.spec.ts`, `kid-decks-layout.spec.ts` i `kid-flow-screens.spec.ts` są macierzą przeglądarkową; odbiór rzeczywistego Galaxy S25/PWA pozostaje osobnym wymaganiem i nie wynika z symulacji viewportu.

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
| packages/server/src/domain/progress.ts | Wyliczanie projekcji z historii |
| packages/server/src/domain/learning-work.ts | Oddzielne terminy i gotowość Recall, pisowni i wymowy |
| packages/server/src/domain/support-cycle.ts | Odtwarzanie pojedynczego cyklu wsparcia z historii sesji |
| packages/server/src/domain/recognition-options.ts | Bezpieczne, unikalne opcje rozpoznawania i fragmentów |
| packages/server/src/domain/confusion-priority.ts | Kierunkowe rankowanie wiarygodnych mylonych par |
| packages/server/src/modules/skill-history.ts | Odczyt historii ocen ograniczony do dziecka, skill version i umiejętności |
| packages/server/src/modules/skill-projections.ts | Wspólny zapis projekcji postępu |
| packages/server/src/modules/learning-snapshot.ts | Zbiorcza migawka postępu, pracy, ekspozycji i pomyłek |
| packages/server/src/domain/scheduler.ts | Wybór ćwiczenia z ochroną celów oczekujących na samodzielne sprawdzenie |
| packages/server/src/domain/test-preparation.ts | Czyste wyznaczanie 48-godzinnego okna terminu w strefie rodziny, z obsługą DST |
| packages/server/src/domain/feedback.ts | Komunikaty zgodne z wynikiem |
| packages/server/src/domain/revision-impact.ts | Mapa wpływu zmiany treści na skill_versions |
| packages/server/src/domain/policies/learning-v1.ts | Jawne parametry i wersja algorytmu |

Typy bazy nie są DTO. Pole answer_key nigdy nie jest częścią eksportu packages/contracts. Biblioteka domeny nie odczytuje Date.now() ani zmiennych środowiskowych; czas i konfiguracja są argumentami.

Komunikaty wynikowe generowane przez domenę (feedback.ts) trafiają do klienta w DTO; statyczne etykiety ekranów, przycisków i błędów UI dla web oraz kid-ui pochodzą wyłącznie z messages.ts. Locale UI, treści i wymowy pozostają osobnymi wartościami; nie budujemy przełącznika języka ani systemu tłumaczeń.

## 5. Przypadki użycia i infrastruktura

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/server/src/modules/profiles.ts | Profile, kasowanie danych dziecka |
| packages/server/src/modules/auth.ts | Hasło/PIN, sesje i limity logowania |
| packages/server/src/modules/decks.ts | Szkice, rewizje, przypisania, publikacja |
| packages/server/src/modules/generation.ts | Zlecanie i wykonywanie generacji |
| packages/server/src/modules/media-reconciliation.ts | Dopasowanie fingerprintów szkicu, zachowanie zgodnych zasobów i enqueue brakujących |
| packages/server/src/modules/sessions.ts | Start/resume z przypięciem terminu, next, historia ekspozycji, completePresentation, koniec |
| packages/server/src/modules/events.ts | Kontekst sesji i zapis/zamknięcie ujawnienia przed HTTP; opcjonalne potwierdzenia klienta |
| packages/server/src/modules/attempts.ts | Rezerwacja i finalizacja prób |
| packages/server/src/modules/speech.ts | Krótka analiza nagrania i wynik częściowy |
| packages/server/src/modules/reporting.ts | Postęp i mylone pary |
| packages/server/src/modules/progress-rebuild.ts | Dry-run oraz transakcyjna, scoped odbudowa projekcji z historii |
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

Uzupełnienie #30 (2026-10-10): `contracts/src/mock-tests.ts` definiuje cele, liczbę i publiczne raporty; prywatne typy planu są w `server/src/domain/mock-test-types.ts`. `mock-test-plan.ts` dobiera zamrożoną porcję, `mock-test-report.ts` liczy pełny zakres, a `server/src/modules/mock-tests.ts` wydaje sloty, zamyka próbę i czyta raport/omówienie. Migracja `server/drizzle/0004_mock_tests.sql` dodaje konfigurację przypisania, tryb i niezmienność planu/raportu. `kid-ui/src/screens/MockTestSummaryScreen.tsx` obsługuje potwierdzenie porcji i omówienie; rodzic korzysta z `web/src/parent/AssignmentTestGoalFields.tsx` oraz `MockTestReportPanel.tsx`. Synthetic fixtures pozostają w `tests/fixtures/mock-test-world.ts`; nowe testy obejmują `mock-test-settings`, `mock-tests`, `mock-test-reporting` (PostgreSQL) i `mock-test`, `mock-test-parent` (E2E).

Brak apps/android, osobnego backendu Express/Nest, package OCR, repozytorium wektorowego i systemu pluginów. Przyszły host Capacitor będzie konsumował @learning/kid-ui i @learning/contracts oraz istniejące API. Nie trzeba dziś budować go tylko po to, aby wykazać możliwość rozbudowy.

Edycja profilu: `contracts/src/decks.ts` definiuje `ChildPatchSchema`, `server/src/modules/profiles.ts` implementuje `updateChild`, a `web/src/app/api/v1/parent/children/[id]/route.ts` udostępnia PATCH. `ChildEditor.tsx` odpowiada także za formularz imienia i awatara; istniejąca historia nie jest modyfikowana.
