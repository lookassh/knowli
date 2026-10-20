# AGENTS.md — Knowli / Umiem!

Instrukcje dla agentów pracujących w tym repozytorium. Umieść ten plik w katalogu głównym repozytorium.

<!-- bmad:context -->
<!-- Verified 2026-10-15 against b820a2420a37f1421d91ae034ecf7bf3e7286eaa. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep other instructions outside the markers. -->

## Policy

- Nie wypychaj zmian bezpośrednio do `main` i nie scalaj PR bez polecenia właściciela. Osobny PR dokumentacyjny wymaga wyraźnego polecenia; sposób zakończenia implementacji uzgodnij w ramach danego zadania.

## Running and verifying

- Aby skopiować brakujący `.env` w worktree bez instalacji zależności, uruchom `node scripts/setup-worktree.cjs --skip-install`; wywołanie bez tej opcji instaluje zależności, gdy brak `node_modules`.

<!-- /bmad:context -->

## Tożsamość projektu i język

- Nazwa repozytorium i projektu technicznego: **Knowli**. Identyfikator repozytorium/katalogu: `knowli`.
- Polska nazwa aplikacji widoczna dla użytkownika: **Umiem!** — zachowuj wykrzyknik.
- Pierwsza wersja ma polski interfejs: `pl-PL`, w panelu rodzica i dziecka, komunikatach, błędach, onboarding oraz manifeście PWA. Nazwa aplikacji w manifeście: `Umiem!`.
- Angielski jest językiem materiału pierwszego modułu, a nie językiem interfejsu. Początkowa para języków materiału: `pl-PL` → `en-GB`.
- Kod, nazwy plików, identyfikatory, DTO, klucze API i tabel pisz po angielsku. Dokumentację projektu i komunikację z właścicielem pisz po polsku.
- Teksty interfejsu trzymaj w jednym prostym katalogu komunikatów współdzielonym przez odpowiednich klientów. Nie buduj teraz przełącznika języka ani rozbudowanego systemu tłumaczeń. Locale treści, wymowy i UI są osobnymi wartościami.
- Utrzymuj techniczne nazwy pakietów `@learning/*` przyjęte w architekturze; branding nie wymaga ich zmiany.

## Cel produktu

Prywatna, self-hostowana aplikacja rodzinna: rodzic określa materiał, AI przygotowuje zestaw, rodzic sprawdza i zatwierdza wynik, a dziecko uczy się podczas krótkich sesji. System pamięta próby i trudności konkretnego dziecka.

Pierwszy moduł to angielskie słownictwo dla początkującego dziecka w wieku około 8 lat. MVP obejmuje także przygotowanie do pisemnych sprawdzianów, profile dzieci i naukę bez mikrofonu. Priorytetem jest prostota i wiarygodne rozróżnienie nauki ze wsparciem od samodzielnego przypominania.

## Dokumenty i początek pracy

Przed zmianami przeczytaj sekcje dokumentów dotyczące zadania:

1. `docs/SPEC.md` — wymagania i kryteria akceptacji, wersja bazowa 1.1.
2. `docs/architecture.md` — decyzje i kontrakty, obecna wersja 1.3 (bazowo 1.2 po review).
3. `docs/schema.sql` — początkowy projekt bazy, wersja bazowa 1.2.
4. `docs/folder-structure.md` — uzgodnione granice i ścieżki.
5. `docs/implementation-plan.md` — małe zadania, zależności oraz regresje R01–R07.

Ten plik uzupełnia dokumenty w `docs/` o zasady pracy i branding. Nie zastępuje szczegółowych wymagań ani uzgodnionych kontraktów. Aktualne polecenia właściciela mają pierwszeństwo; istotne nowe ustalenia odzwierciedlaj w dokumentacji.

Na początku sprawdź stan repozytorium, istniejące skrypty i zakres zmian użytkownika. Nie nadpisuj jego niezwiązanych zmian. W razie sprzeczności wpływającej na model danych, prywatność lub publiczny kontrakt wyjaśnij ją przed implementacją zależnego fragmentu. Rutynowe wybory rozstrzygaj samodzielnie.

### Szybki start w worktree — zasady unikania redundancji i kosztów

W celu przyspieszenia pracy agentów i wyeliminowania powtarzalnych, kosztownych operacji przy każdym nowym zadaniu w worktree:

1. **Zależności (`node_modules`)**:
   - Przed wywołaniem instalatora **zawsze sprawdź, czy katalog `node_modules` już istnieje** (`Test-Path node_modules` lub `[ -d node_modules ]`). Jeśli istnieje, a Twoje zadanie nie modyfikuje `package.json` ani `pnpm-lock.yaml`, **bezwzględnie pomiń krok instalacji**.
   - Jeśli instalacja jest konieczna: używaj wyłącznie `corepack pnpm install --prefer-offline --frozen-lockfile` (lub `pnpm install --prefer-offline --frozen-lockfile`). **Nigdy nie uruchamiaj `npm install`** (niszczy dowiązania pnpm i generuje niepożądany `package-lock.json`).
2. **Kopiowanie pliku `.env`**:
   - Nowe worktree nie zawiera plików ignorowanych przez git. Przed uruchomieniem testów lub narzędzi upewnij się, że plik `.env` istnieje. W razie braku skopiuj go z głównego repozytorium: `node scripts/setup-worktree.cjs --skip-install` (lub skopiuj z `$(git rev-parse --git-common-dir)/../.env`).
3. **Celowane czytanie dokumentacji**:
   - Nie czytaj wszystkich 5 plików dokumentacji (`SPEC.md`, `architecture.md`, `schema.sql`, `folder-structure.md`, `implementation-plan.md`) od deski do deski na początku każdego małego zadania. Przeczytaj **wyłącznie sekcje bezpośrednio powiązane z Twoim zakresem zmian** (np. `schema.sql` przy modelowaniu bazy, `architecture.md` sekcja 19 przy lekcjach, `SPEC.md` sekcje dotyczące danego ekranu).
4. **Oszczędny baseline test**:
   - Podczas sprawdzania stanu początkowego **nie uruchamiaj pełnego monorepo ani testów e2e / Playwright**. Uruchom wyłącznie szybki test jednostkowy związany ze zmienianym modułem (np. `corepack pnpm vitest run <ścieżka-do-testu>` lub `pnpm vitest run <ścieżka-do-testu>`).
5. **BMAD w worktree**:
   - Runtime BMAD (`_bmad/`) i skills dla Codex/ZCode/Antigravity (`.agents/skills/`, `.zcode/skills/`, `.agent/skills/`) instaluj w głównym checkoutcie. Plik `.worktreeinclude` kopiuje te ignorowane katalogi do nowych worktree tworzonych przez Codex. Zwykłe worktree tworzone ręcznie przez Git mogą korzystać z `scripts/setup-worktree.cjs` i hooka `post-checkout`; Codexowe worktree nie uruchamiają tego hooka. Jeśli worktree ZCode lub Antigravity nie ma runtime’u albo skilli, uruchom w nim `node scripts/setup-worktree.cjs --skip-install`.
   - **Przekazanie BMAD Codex → ZCode:** Codex przygotowuje specyfikację, plan i historie w `docs/bmad/` w swoim worktree. Przed przekazaniem zapisuje te dokumenty commitem na gałęzi planistycznej; nie scala ani nie wypycha ich do `main`. Następnie ZCode tworzy własny worktree na bazie tej gałęzi/commitu i implementuje wskazaną, gotową historię przez `bmad-build`. Jeśli Git nie pozwala ponownie checkoutować tej samej gałęzi, bo jest zajęta przez worktree Codex, ZCode tworzy własną gałąź implementacyjną od commitu planu. Dzięki temu dokumenty są dostępne w ZCode, a jego zmiany nie współdzielą checkoutu z Codex. Artefakty BMAD pozostają pod `docs/bmad/` i są wersjonowane razem z właściwą zmianą. Po implementacji Codex może kontynuować pracę na gałęzi implementacyjnej.
   - Świeżą instalację albo odtworzenie lokalnego runtime’u wykonaj stabilną wersją BMAD i skonfiguruj Codex, ZCode oraz Antigravity:

     ```sh
     npx --yes bmad-method@6.12.4 install --modules bmm --tools codex,zcode,antigravity \
       --communication-language Polish --document-output-language Polish \
       --output-folder docs/bmad \
       --set 'bmm.planning_artifacts={project-root}/docs/bmad/planning-artifacts' \
       --set 'bmm.implementation_artifacts={project-root}/docs/bmad/implementation-artifacts'
     ```

## Architektura i stack

- Next.js App Router, React i TypeScript w trybie strict; runtime serwera Node.js.
- PostgreSQL, Drizzle ORM i Drizzle Kit; Zod do walidacji granic i wyników AI.
- Tailwind CSS, PWA, pnpm workspaces, Vitest i Playwright.
- Modularny monolit w jednym repozytorium: proces `web`, proces `worker`, jedna baza PostgreSQL. Kolejka Graphile Worker korzysta z tej samej instancji bazy.
- Docker Compose/Coolify, prywatny trwały wolumen mediów; konkretne stabilne wersje przypnij podczas implementacji.

Granice kodu:

| Ścieżka | Odpowiedzialność |
| --- | --- |
| `apps/web` | Next.js: panel rodzica, host Kid UI i cienkie endpointy API |
| `apps/worker` | Długie zadania przygotowania materiałów |
| `packages/contracts` | Publiczne DTO, schematy Zod i typy bez sekretów |
| `packages/kid-ui` | Przenośny interfejs dziecka w React |
| `packages/server` | Domena, przypadki użycia, baza i adaptery providerów |

Kid UI używa jawnego `/api/v1/kid` i konfigurowalnego `baseUrl`. Nie importuje Next.js, Server Actions, bazy ani kodu serwerowego. Mikrofon, odtwarzanie i lokalne ustawienia mają adaptery platformowe. Dzięki temu przyszły host Capacitor może ponownie wykorzystać interfejs; nie buduj teraz aplikacji Android.

SDK dostawców występują tylko w adapterach za portami LLM, TTS, STT, pronunciation, images i mediów. Domena nie zna Azure/OpenAI. Nie wywołuj LLM przy każdym kliknięciu; generuje materiał, a sesję prowadzą jawne reguły serwera. Wyjątek (moduł lekcji, 2026-10-12): w lekcjach odpowiedź tekstowa niedopasowana deterministycznie do zatwierdzonych wariantów może zostać oceniona przez konfigurowalny model oceniający zgodny z OpenAI (proces web, port `AnswerGraderProvider`), z cache werdyktów `lesson_verdicts` i limitem wywołań na sesję; zamknięte ćwiczenia, trafienia cache i brak konfiguracji modelu nie wołają modelu, a awaria daje „nieocenione" bez kary. Nowy przedmiot nauki (np. historia) dodawaj jako moduł za interfejsem `SubjectModule` (katalog, typy ćwiczeń, normalizator, kategorie błędów, prompty, walidatory) + wpis w rejestrze — bez logiki przedmiotu w silniku lekcji; test architektoniczny pilnuje tej granicy. Szczegóły: `docs/architecture.md` sekcja 19 i `.kiro/specs/grammar-module/`.

Nie dodawaj mikroserwisów, Redis, osobnego backendu, ogólnego frameworka pluginów ani abstrakcji repozytorium dla każdej tabeli.

## Integracja MCP i skill Umiem! — wspólny kontrakt z API

- Serwer MCP Streamable HTTP utrzymuj w `apps/web/src/integrations/` i udostępniaj pod `/api/mcp`, używając istniejących kontraktów i przypadków użycia. Pakiet `integrations/umiem-mcp/` zawiera semantyczny walidator, wygenerowany schemat, manifest kontraktu i skill w `skills/umiem-learning/SKILL.md`; nie zawiera alternatywnego serwera stdio ani klienta REST.
- Hermes łączy się jako zwykły klient MCP przez `url` i nagłówki Bearer z chronionego środowiska. Kod raportu rodzinnego pozostaje w repozytorium Hermesa; nie utrzymuj tam niezależnego forka schematu lub skilla.
- **Przy każdej zmianie API sprawdź wpływ na MCP i `SKILL.md`.** Gdy zmiana dotyczy udostępnionych endpointów, DTO, parametrów, wartości domyślnych, autoryzacji, kodów błędów albo znaczenia danych (np. samodzielności, czasu nauki i terminów sprawdzianów), zaktualizuj w tym samym PR adapter, jego walidację oraz skill w wymaganym zakresie. Samo przejście testów serwera nie potwierdza zgodności integracji.
- Źródłem kontraktu są schematy w `packages/contracts`. Regeneruj przenośny JSON Schema i aktualizuj jego kopię w pakiecie konsumenta MCP, przykłady oraz testy zgodności; nie rozwijaj ręcznie rozbieżnych definicji. Sprawdź zgodność `schemaVersion` i zachowanie względem już wdrożonych wersji API/MCP; zmianę niezgodną zaplanuj wraz z kolejnością aktualizacji obu stron.
- W `SKILL.md` utrzymuj prawdziwe nazwy narzędzi i parametrów, ograniczenia odczytu, interpretację wyniku, obsługę błędów oraz zasady prywatności. Nie umieszczaj w nim tokenów, prywatnych danych dzieci ani twierdzeń, że poprawne odpowiedzi oznaczają trwałe opanowanie lub brak zapisu oznacza brak nauki. Czas szacowany pozostaje jawnie oznaczony.
- Uruchom adekwatne testy endpointu HTTP, walidacji kontraktu i standardowego klienta Streamable HTTP, korzystając z fikcyjnych danych; sprawdź, że instrukcje skilla odpowiadają rzeczywistemu narzędziu. Jeśli zmiana API nie wymaga zmiany MCP albo skilla, uzasadnij to w dzienniku/PR. Gdy integracja jest jeszcze planowana, zamiast deklarować sprawdzenia nieistniejącego kodu aktualizuj specyfikację, przykładowy kontrakt i plany.
- W opisie PR podaj wpływ na API → MCP → skill, wykonane sprawdzenia oraz wymagane wdrożenia po stronie konsumentów. Aktualizacja kodu w repo nie oznacza aktualizacji zainstalowanego MCP ani skilla u Hermesa.

## Zasady danych i uczenia

- Opublikowana treść jest niezmienna. Edycja tworzy nowy szkic; sesja przypina wersję zestawu i polityki.
- Oddzielaj `learning_item`, `item_revision` i `skill_version`. Postęp jest osobny dla dziecka i umiejętności: listening, reading, recall, pronunciation, spelling. Stara próba nie awansuje nowych kryteriów.
- Historia prób, ocen i ekspozycji jest źródłem danych; liczniki postępu są odtwarzalną projekcją. Nie przepisuj zakończonych ocen. Usunięcie profilu usuwa jego historię i transkrypcje, zachowując wspólny materiał.
- Serwer zapisuje i zamyka komplet ekspozycji **przed** wysłaniem ujawnianej treści. Dotyczy to podpowiedzi, dystraktorów, feedbacku, retry i ponownego odsłuchu z cache. ACK klienta jest opcjonalną obserwacją.
- Operacje sesji wszystkich klientów podlegają tej samej blokadzie. Kontekst kwalifikacji próby zamraża się przy `received_at`, przed analizą mowy.
- Wydane zadanie ma niezmienny prompt, klucz odpowiedzi i kontekst. Exposure kończy się idempotentnym `complete-presentation`, bez próby, oceny i zużycia budżetu ocenianych zadań.
- Scheduler chroni cele należnych samodzielnych sprawdzeń przed wcześniejszym ujawnieniem, także jako dystraktory. Jedna samodzielna odpowiedź pisemna może oceniać Recall i pisownię oddzielnie.
- Zwykłe STT sprawdza treść, a osobny provider ocenia wymowę. Zatwierdzone warianty odpowiedzi są poprawne także w mowie. Wyniku wymowy dla innego wariantu nie przenoś na wypowiedziany tekst.
- Parametry startowe polityki: 300 sekund od ujawnienia dla samodzielnego Recall/pisowni, trzy ostatnie kwalifikujące sukcesy, potwierdzenie innego dnia po minimum 12 godzinach, wsparcie po dwóch błędach. Szczegóły i wyjątki stosuj zgodnie ze SPEC i architekturą.
- „Nie pamiętam” jest trudnością. „Pomiń”, cisza, niepewne rozpoznanie i awaria techniczna nie są dowodem błędnej wiedzy. Niepewny STT nie tworzy pomyłki między słowami.

## Generowanie, media i prywatność

- Waliduj structured output AI po stronie serwera. Materiał dostępny dziecku wymaga zatwierdzenia rodzica.
- TTS generuj i cache'uj podczas przygotowania materiału. Gotowy rekord zasobu i jego bajty są niezmienne; ręczna regeneracja tworzy nowy zasób/generację.
- Media job jest związany z `asset_id`, a nie numerem edycji całego szkicu. Lease należy do współdzielonego zasobu. Każda edycja uzgadnia fingerprinty, zachowuje zgodne media i zleca brakujące w tej samej transakcji.
- `MediaStore.putImmutable` zapisuje bez nadpisywania istniejącego blobu. Spóźniony worker nie może zmienić gotowych mediów ani powiązań szkicu.
- Nagranie dziecka przetwarzaj krótkotrwale w pamięci. Nie zapisuj go w bazie, kolejce, plikach tymczasowych, logach, fixture ani backupie. Zwolnij mikrofon i bufory także po błędzie/anulowaniu.
- Sekrety pozostają na serwerze. Kid DTO nie zawiera klucza odpowiedzi, kryteriów oceny ani technicznych score'ów. Nie serializuj bezpośrednio rekordów bazy.
- Model oceniający lekcji (gdy skonfigurowany, `UMIEM_GRADER_*`, proces web): wysyłaj do usługi wyłącznie treść ćwiczenia, regułę i odpowiedź dziecka (≤200 znaków) jako dane, nigdy imienia/wieku/identyfikatorów; token tylko w adapterze (nie w logach, DTO, promptach). Komentarz modelu jest wyłącznie dla rodzica; werdykt w cache `lesson_verdicts` nie ma kolumn dziecka. Panel rodzica informuje, do której usługi trafiają odpowiedzi dziecka. Raport Hermesa (`learning-overview`) świadomie NIE obejmuje lekcji — przy zmianach API/MCP utrzymaj ten filtr i notę w `SKILL.md`.
- Ocena aktywności sesji (spec client-reward-time, port `SessionActivityReviewer`, wspólna konfiguracja `UMIEM_GRADER_*`, deadline 20 s): model dostaje jedną sesję z zerowymi numerami zadań, instrukcje/bodźce/opcje, warianty poprawne i faktycznie wysłane odpowiedzi oraz lokalną aktywność — wyłącznie jako dane; bez imion, identyfikatorów, kluczy i nagrań. Model wskazuje tylko zadania bez podstaw do zaliczenia pracy i uzasadnienia; sekundy i punkty (1 pkt/60 s z resztą przenoszoną między sesjami) liczy wyłącznie kod. Szczegółowy JSONB raportu znika po 7 dniach; punkty, krótki wynik i fingerprint pozostają. Awaria modelu = zapisany błąd bez punktów, bez kolejki i automatycznych ponowień; jedno wywołanie na sesję (znacznik + fingerprint + deadline). Nie ma Xbox, salda do wydania ani punktów per zestaw.
- Parent Mode wymaga PIN-u/hasła, sesji i serwerowej autoryzacji każdej operacji. Wybór profilu dziecka nie jest mechanizmem zabezpieczenia publicznej instancji.
- Sposób dostępu spoza domu wymaga osobnego ustalenia przed publicznym wystawieniem. Nie twórz teraz platformy wielorodzinnej.

## UX pierwszej wersji

- Polski tekst ma być krótki, naturalny i zrozumiały dla dziecka. Duże pola dotykowe, jeden jasny krok, mobile first i tablet friendly.
- Przykłady feedbacku: „Świetnie!”, „Prawie! Posłuchaj jeszcze raz”, „Spróbuj jeszcze raz”. Feedback musi odpowiadać rzeczywistemu wynikowi; nie chwal błędnej odpowiedzi jako poprawnej.
- Sesje trwają około 5–10 minut. Po „Jeszcze 3 i koniec!” nie dokładaj zadań ponad obiecany budżet.
- Dziecko nie widzi modeli, promptów, procentowych ocen, konfiguracji powtórek ani administracji.
- Rodzic ma prosty podgląd materiału, edycję, przypisania i postęp per umiejętność. Obraz pomaga w znaczeniu: object/action, a kolor/liczba/sekwencja korzystają z renderowania deterministycznego.
- Nauka bez mikrofonu jest pełnoprawną ścieżką. Odmowa uprawnienia nie blokuje sesji. PWA nie obiecuje nauki offline; utrata sieci nie może tworzyć lokalnie fałszywego sukcesu.

## Sposób implementacji i sprawdzania

- Realizuj uzgodniony plan małymi zadaniami z działającym, sprawdzalnym rezultatem. Nie traktuj odczytania tego pliku jako polecenia zbudowania całego MVP.
- Próbę mowy i mediów wykonaj zgodnie z zadaniem 0. Bez kluczy lub docelowego urządzenia opisz brakujące dowody; tekstowy fundament może powstawać dalej. Nie deklaruj gotowej oceny wymowy bez tej próby.
- Dla reguł oceny, historii, współbieżności i danych dodawaj znaczące testy. Testy domeny używają kontrolowanego zegara, integracyjne docelowego PostgreSQL, a providerów w testach zastępują fake-adaptery.
- Pokryj odpowiednie regresje R01–R07 z planu; weryfikuj awarie, retry, dwie przeglądarki i usuwanie profilu, nie tylko poprawny przebieg.
- Uruchamiaj istniejące skrypty adekwatne do zmiany: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm build`. Przed wykonaniem sprawdź aktualne definicje w `package.json`.
- Początkowy SQL jest projektem do odwzorowania. Po wdrożeniu Drizzle utrzymuj autorytatywny schemat TypeScript i przeglądane migracje SQL, w tym wymagane triggery; nie rozwijaj niezależnie dwóch definicji.
- Aktualizuj dokumentację, gdy zmienia się uzgodniony kontrakt lub decyzja. Raportuj co zmieniono, co rzeczywiście sprawdzono i co pozostaje niezweryfikowane. Sprawdzenia SQL w PGlite nie są testami gotowej aplikacji.
- Lokalnie dostępne jest narzędzie GitHub CLI (`gh`, w razie braku w `PATH` bieżącej powłoki: `C:\Program Files\GitHub CLI\gh.exe`) z aktywnym uwierzytelnieniem. Agenci mogą z niego korzystać do sprawdzania stanu repozytorium i PR oraz do tworzenia PR w ramach autoryzowanego zadania. Samo istnienie narzędzia nie uprawnia do push do `main` ani scalania PR; stosuj zasady z bloku Policy.

## Poza zakresem MVP

OCR/PDF i nauka z podręczników, chat/awatar AI, rozmowy realtime, OAuth, social/rankingi, marketplace, płatności, rozbudowana gamifikacja, CEFR, natywna aplikacja Android/iOS oraz pełna synchronizacja offline. Zachowuj możliwość rozbudowy przez uzgodnione granice; nie implementuj tych modułów z wyprzedzeniem.
