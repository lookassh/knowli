# Struktura projektu

Propozycja 1.1 • 7 października 2026  
Podstawa: architecture.md oraz SPEC.md 1.1. To plan plików; repozytorium aplikacji nie zostało jeszcze utworzone.

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
| deploy/ | Compose, obrazy, skrypty migracji i backupu |

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
| apps/web/src/app/manifest.ts | Manifest PWA |
| apps/web/src/http/parent-router.ts | Jawna tabela endpointów rodzica |
| apps/web/src/http/kid-router.ts | Jawna tabela endpointów dziecka |
| apps/web/src/http/errors.ts | Jednolity format błędów i requestId |
| apps/web/src/http/security.ts | Sesja, Origin/CSRF, limity żądań |
| apps/web/src/parent/DeckEditor.tsx | Formularz szkicu, warianty i zasoby |
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
| packages/kid-ui/src/exercises/Spelling.tsx | Luki i pełny zapis |
| packages/kid-ui/src/media/platform.ts | Interfejsy nagrywania/odtwarzania/storage |
| packages/kid-ui/src/media/browser.ts | Implementacja przeglądarkowa |
| packages/kid-ui/src/visuals/Visual.tsx | Kolor, liczba, sekwencja, obraz albo brak |
| packages/kid-ui/src/styles.css | Motyw dziecka i style Tailwind |

Nie importujemy tutaj next/navigation, next/image, Server Actions ani @learning/server. Zwykły img i serwerowy media URL wystarczą do ilustracji. Transport API nie jest wbudowany w komponent ćwiczenia; dostarcza go KidApp przez zależność.

## 4. Kontrakty i domena

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/contracts/src/common.ts | Identyfikatory, błędy, daty |
| packages/contracts/src/decks.ts | Publiczne schematy zestawów i poleceń rodzica |
| packages/contracts/src/kid.ts | Publiczne TaskDto, AttemptInput, AttemptDto, SessionDto, DisclosureInput/Dto, PresentationCompletionInput/Dto |
| packages/contracts/src/progress.ts | Podsumowanie per umiejętność |
| packages/server/src/domain/types.ts | Prywatne AnswerKey, Grade, History, Policy |
| packages/server/src/domain/evaluate.ts | Reguły treści i pisowni |
| packages/server/src/domain/independence.ts | Kwalifikacja próby i ekspozycje |
| packages/server/src/domain/progress.ts | Wyliczanie projekcji z historii |
| packages/server/src/domain/scheduler.ts | Wybór ćwiczenia z ochroną celów oczekujących na samodzielne sprawdzenie |
| packages/server/src/domain/feedback.ts | Komunikaty zgodne z wynikiem |
| packages/server/src/domain/revision-impact.ts | Mapa wpływu zmiany treści na skill_versions |
| packages/server/src/domain/policies/learning-v1.ts | Jawne parametry i wersja algorytmu |

Typy bazy nie są DTO. Pole answer_key nigdy nie jest częścią eksportu packages/contracts. Biblioteka domeny nie odczytuje Date.now() ani zmiennych środowiskowych; czas i konfiguracja są argumentami.

## 5. Przypadki użycia i infrastruktura

| Ścieżka | Odpowiedzialność |
| --- | --- |
| packages/server/src/modules/profiles.ts | Profile, kasowanie danych dziecka |
| packages/server/src/modules/auth.ts | Hasło/PIN, sesje i limity logowania |
| packages/server/src/modules/decks.ts | Szkice, rewizje, przypisania, publikacja |
| packages/server/src/modules/generation.ts | Zlecanie i wykonywanie generacji |
| packages/server/src/modules/media-reconciliation.ts | Dopasowanie fingerprintów szkicu, zachowanie zgodnych zasobów i enqueue brakujących |
| packages/server/src/modules/sessions.ts | Start/resume, next, completePresentation, koniec |
| packages/server/src/modules/events.ts | Zapis i zamknięcie ujawnienia przed odpowiedzią HTTP; opcjonalne potwierdzenia klienta |
| packages/server/src/modules/attempts.ts | Rezerwacja i finalizacja prób |
| packages/server/src/modules/speech.ts | Krótka analiza nagrania i wynik częściowy |
| packages/server/src/modules/reporting.ts | Postęp i mylone pary |
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
| apps/worker/src/tasks.ts | Powiązanie nazw Graphile z przypadkami użycia |
| apps/worker/src/composition.ts | Składanie zależności workera |

DocumentAnalysisProvider pojawi się dopiero podczas budowy source_material. Nie tworzymy pustych adapterów wszystkich przyszłych usług.

## 6. Testy i deployment

| Ścieżka | Rola |
| --- | --- |
| packages/server/src/domain/*.test.ts | Testy reguł z kontrolowanym zegarem |
| tests/integration/auth-profiles.test.ts | Sesje rodzica, profile, usuwanie |
| tests/integration/revisions.test.ts | Niezmienność wersji i wpływ edycji |
| tests/integration/generation.test.ts | Idempotencja, retry, stary draft, reconcile i asset lease |
| tests/integration/media.test.ts | Niezmienność gotowych zasobów i zapis no-clobber przy spóźnionym workerze |
| tests/integration/history.test.ts | Niezmienne zadania/oceny/ujawnienia i usunięcie profilu |
| tests/integration/sessions.test.ts | Granice sesji, completePresentation, budżet, wersje i ujawnienia bez ACK |
| tests/integration/attempts.test.ts | Atomowość i retry odpowiedzi |
| tests/integration/speech.test.ts | Timeouty, zatwierdzone warianty, częściowy wynik, brak audio na dysku |
| tests/integration/reporting.test.ts | Rozdzielenie dzieci i mylonych par |
| tests/e2e/parent-flow.spec.ts | Generacja → review → publikacja |
| tests/e2e/kid-flow.spec.ts | Sesja z mikrofonem i bez, błędy sieci |
| tests/e2e/privacy.spec.ts | Brak sekretów i odpowiedzi w DTO |
| docs/speech-spike.md | Wynik weryfikacji mowy i kodeków, bez surowych nagrań |
| docs/provider-config.md | Wybrane modele i parametry bez kluczy |
| docs/backup-restore.md | Procedura i zapis testu odtworzenia |
| deploy/Dockerfile | Wieloetapowy build web i worker |
| deploy/compose.yaml | Web, worker, db i wolumeny |
| deploy/migrate.ts | Jednorazowe migracje aplikacji i kolejki |
| deploy/backup.sh | Zrzut bazy i zasoby |
| deploy/restore.sh | Kontrolowane odtworzenie |
| .env.example | Nazwy i przykładowe niesekretne ustawienia |
| pnpm-workspace.yaml / package.json | Workspace i polecenia sprawdzeń |

## 7. Czego nie tworzymy teraz

Brak apps/android, osobnego backendu Express/Nest, package OCR, repozytorium wektorowego i systemu pluginów. Przyszły host Capacitor będzie konsumował @learning/kid-ui i @learning/contracts oraz istniejące API. Nie trzeba dziś budować go tylko po to, aby wykazać możliwość rozbudowy.
