<!-- bmad:context -->
<!-- Verified 2026-11-09 against 75e4b6f5. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Knowli / Umiem!

Prywatna, self-hostowana aplikacja rodzinna: rodzic określa materiał, AI przygotowuje zestaw, rodzic sprawdza i zatwierdza wynik, a dziecko uczy się w krótkich sesjach; system pamięta próby i trudności konkretnego dziecka. Pierwszy moduł: angielskie słownictwo dla ok. 8-latka; MVP obejmuje też przygotowanie do sprawdzianów, profile dzieci i naukę bez mikrofonu — priorytetem jest prostota i wiarygodne rozróżnienie nauki ze wsparciem od samodzielnego przypominania. Modularny monolit: Next.js 16 App Router (web), proces worker, jeden PostgreSQL (Drizzle), TypeScript strict, Zod, Tailwind, PWA, pnpm workspaces, Vitest, Playwright, Docker Compose/Coolify z prywatnym wolumenem mediów. Wymagania i decyzje: `docs/SPEC.md` (1.1), `docs/architecture.md` (1.4), `docs/schema.sql`, `docs/folder-structure.md`, `docs/implementation-plan.md` (regresje R01–R07); specy i plany w `docs/superpowers/`.

## Policy

- Nie wypychaj zmian bezpośrednio do `main` i nie scalaj PR bez polecenia właściciela — ruleset wymaga PR (squash) i zielonych checków. Osobny PR dokumentacyjny wymaga wyraźnego polecenia; sposób zakończenia implementacji uzgodnij w ramach zadania.
- `gh` jest uwierzytelniony (poza `PATH`: `C:\Program Files\GitHub CLI\gh.exe`); używaj go do stanu repo i PR oraz tworzenia PR w autoryzowanym zadaniu — nie uprawnia do push do `main` ani scalania.
- Aktualne polecenia właściciela mają pierwszeństwo przed `docs/`; istotne nowe ustalenia odzwierciedlaj w dokumentacji. Sprzeczność wpływającą na model danych, prywatność lub publiczny kontrakt wyjaśnij przed implementacją zależnego fragmentu; rutynowe wybory rozstrzygaj sam.
- Na początku sprawdź stan repo, skrypty i zakres zmian użytkownika; nie nadpisuj jego niezwiązanych zmian.
- Szczegóły, pomiary i opisy dopisuj do `docs/agents/*.md`, nie do `AGENTS.md` — Codex po cichu obcina instrukcje projektu powyżej 32 KiB (pilnuje `tests/docs-architecture-drift.test.ts`).
- Sekrety tylko w `.env` po stronie serwera; nigdy w `config-defaults.ts`, logach, DTO, promptach ani fixture.

## Where things are

| Ścieżka | Odpowiedzialność |
| --- | --- |
| `apps/web` | Next.js: panel rodzica, host Kid UI, cienkie endpointy API, MCP (`src/integrations/`, `/api/mcp`) |
| `apps/worker` | Długie zadania przygotowania materiałów (polling `generation_runs`/`media_assets`) |
| `packages/contracts` | Publiczne DTO, schematy Zod, typy bez sekretów — źródło kontraktu API i MCP |
| `packages/kid-ui` | Przenośny interfejs dziecka w React |
| `packages/server` | Domena (`src/domain`), przypadki użycia (`src/modules/{materials,learning,family,reporting}`), baza, adaptery providerów |
| `integrations/umiem-mcp/` | Walidator, wygenerowany schemat, manifest kontraktu, skill `skills/umiem-learning/SKILL.md` |

- Przed pracą w `tests/e2e/`, `tests/integration/`, `scripts/run-e2e-shards.cjs`, `scripts/typecheck.cjs` albo przy zmianie liczby workerów/koszy przeczytaj `docs/agents/testing.md`.
- Przed zmianą w `packages/kid-ui/` lub w specach `tests/e2e/kid-*` przeczytaj `docs/agents/kid-ui.md`.
- Przed zmianą w `packages/server/src/domain/lessons/`, `modules/*/lessons/` lub przy nowym przedmiocie przeczytaj `docs/agents/lessons.md`.
- Przed zmianą w `packages/server/src/providers/`, promptach, `config-defaults.ts` albo danych wysyłanych do usług AI przeczytaj `docs/agents/providers-privacy.md`.
- Przed specyfikacją, planem lub implementacją funkcji przeczytaj `docs/agents/workflow.md` (BMAD: odkrywanie i historyjki z AC; Superpowers: plan i implementacja; `bmad-build` i dodatkowe narzędzia review tylko na wyraźne polecenie).
- Czytaj z `docs/` tylko sekcje związane z zadaniem (np. `schema.sql` przy bazie, `architecture.md` §19 przy lekcjach), nie wszystkie pięć plików od deski do deski.

## Running and verifying

- Worktree: raz na klon `pnpm hooks:install` — potem każdy `git worktree add` (Claude, Codex, Muse) sam dostaje `.env` (wzorzec `~/.config/umiem/.env`, inaczej z głównego repo) i zależności; bez hooka albo po zmianie kluczy `pnpm wt:setup` (`--refresh-env`). Sprzątanie: `pnpm wt:clean` (raport), `pnpm wt:clean --remove` (tylko czyste i scalone). Dokumenty powstałe w worktree commituj na jego gałąź.
- Gdy `node_modules` istnieje, a zadanie nie zmienia `package.json` ani `pnpm-lock.yaml`, pomiń instalację. Instaluj wyłącznie `corepack pnpm install --prefer-offline --frozen-lockfile`; nigdy `npm install` (niszczy dowiązania pnpm i tworzy `package-lock.json`).
- Baseline na starcie: tylko szybki test zmienianego modułu (`corepack pnpm vitest run <ścieżka>`), bez pełnego monorepo i bez E2E.
- Lokalny odpowiednik joba CI `check` to `pnpm check` (typecheck, unit, build równolegle). `pnpm typecheck` używa TS 7 z aliasu `typescript-native`; pakiet `typescript` zostaje na 5.x, bo `next build` i testy `*.architecture.test.ts` potrzebują API kompilatora. Skrypty wołają `tsc` po ścieżce — gołe `tsc` w root może wskazać TS 7. TS 7 nie obsługuje `baseUrl`: `paths` w `tsconfig*.json` pisz względnie (`./…`).
- Pełne E2E: `pnpm test:e2e:shards` (jeden build, projekt `mocked` + kosze `real`); drugi równoległy przebieg na tej maszynie tylko z innym `--base-port` (np. `--base-port=25600`). Nie podnoś domyślnych 4 workerów `mocked` — przy 6–8 padały testy pod obciążeniem.
- Pojedynczy spec bez buildu: `UMIEM_E2E_WEB_MODE=dev` albo po `pnpm build` — `UMIEM_E2E_SKIP_BUILD=1`; przed PR i tak pełny `pnpm test:e2e:shards` na buildzie produkcyjnym. Gdy serwer dev wpada w pętlę „Compiled” i przeładowań, usuń `apps/web/.next/dev`.
- `net::ERR_NO_BUFFER_SPACE` pod pełnym obciążeniem Windows to brak buforów gniazd, nie błąd aplikacji: tylko przy dokładnie tym kodzie powtórz dany spec osobno i odnotuj to w PR.
- Nowy spec E2E dopisz do partycji w `tests/e2e/spec-projects.ts`: do `mocked` tylko gdy całe API jest zaślepione w przeglądarce i spec nie dotyka bazy, workera ani API spoza przeglądarki; inaczej do najlżejszego kosza `REAL_BUCKETS`.
- Spec `real` sprawdzający stan „generowanie” wstrzymuje fake'i `holdFakeGeneration()` PRZED akcją zlecającą generowanie i `releaseFakeGeneration()` po asercji (`test.afterEach(releaseFakeGeneration)`); nie ścigaj się z zegarem.
- Zrzuty z `kid-large-screen.spec.ts` wymagają `UMIEM_E2E_SCREENSHOTS=1` i reportera `html` lub `json` (`list` i `github` nie zapisują PNG).
- Integracja: `pnpm test:integration [plik]`; liczbę workerów zmieniaj wyłącznie `UMIEM_INTEGRATION_WORKERS` (1–16). Nie podawaj w CLI `--pool` (global setup przerwie przebieg) ani `--maxWorkers`. Nowy plik integracyjny dopisz do najlżejszego kosza `tests/integration-buckets.ts`.
- Test integracyjny biegnie równolegle z innymi plikami i sesjami: z bazą łącz się wyłącznie przez `testDatabaseUrl()`/`testDatabase()`, dodatkowe bazy twórz pod losową nazwą i sprzątaj, `pg_stat_activity` filtruj po `current_database()`, synchronizuj bramkami i `expect.poll`, nie stałym `setTimeout`.
- Ustawienia Postgresa testów (`tmpfs`, wyłączone `fsync`/`synchronous_commit`/`full_page_writes`) nie wychodzą poza kontenery testowe.
- Przykłady `VAR=x pnpm …` to składnia POSIX; w PowerShell: `$env:VAR='x'; pnpm …`.
- Ocena modelu lekcji lub strojenie promptu paczki: `pnpm bench run` (`tests/probes/README.md`); płatne kroki wymagają `--cap-usd`, wyników różnych sędziów nie porównuj.
- Uruchamiaj skrypty adekwatne do zmiany (sprawdź definicje w `package.json`); w raporcie podaj, co zmieniono, co rzeczywiście sprawdzono i co pozostaje niezweryfikowane. Sprawdzenia SQL w PGlite nie są testami gotowej aplikacji.

## Conventions that differ from defaults

Język i nazwy
- Repozytorium i projekt techniczny: **Knowli** (`knowli`); nazwa widoczna dla użytkownika: Umiem! — zachowuj wykrzyknik, także w manifeście PWA. Pakiety techniczne zostają `@learning/*`.
- Interfejs (panel rodzica i dziecka, komunikaty, błędy, onboarding, manifest) po polsku, `pl-PL`; angielski to język materiału pierwszego modułu (`pl-PL` → `en-GB`), nie interfejsu. Locale treści, wymowy i UI to osobne wartości.
- Kod, nazwy plików, identyfikatory, DTO, klucze API i tabel po angielsku; dokumentacja i komunikacja z właścicielem po polsku.
- Teksty UI w jednym prostym katalogu komunikatów współdzielonym przez klientów; nie buduj przełącznika języka ani systemu tłumaczeń.

Architektura
- Nie dodawaj mikroserwisów, Redis, kolejki/brokera, osobnego backendu, event busa, frameworka pluginów ani repozytorium dla każdej tabeli; praca w tle to polling workera po tabelach tej samej bazy (claim CAS, lease).
- Kid UI woła jawne `/api/v1/kid` z konfigurowalnym `baseUrl` i nie importuje Next.js, Server Actions, bazy ani kodu serwera; mikrofon, odtwarzanie i ustawienia lokalne przez adaptery platformowe. Kid UI nie zależy od Mantine; Mantine 9 (+ TanStack Query przez `@orpc/tanstack-query`) i jego providery żyją tylko w `apps/web/src/parent` i layoucie `app/parent`. Mantine 9 wymaga Reacta 19.2+ także w kopii wbudowanej w Next.js — stąd Next 16; nie cofaj wersji Next.
- Ekrany dziecka składaj wyłącznie ze wspólnych komponentów (`KidPage`, `KidScreen`, `ExerciseFrame`, `ActionButton`, `AnswerGrid`, …); bez surowych `<button>/<input>/<textarea>/<select>` poza ich wnętrzem, bez literałów koloru/rozmiaru/promienia poza blokiem tokenów, ruch tylko przez Motion (`transform`/`opacity`), viewport jako `calc(N * var(--kid-vh))`. Zmianę layoutu pokrywaj testami geometrii Playwright (prostokąty, brak przepełnienia, cele ≥ 48 px) — szczegóły `docs/agents/kid-ui.md`.
- Nową funkcję umieszczaj w module właściciela obszaru: najpierw sprawdź istniejące granice i rozbuduj właściwy moduł zamiast równoległej implementacji; zależności kierunkowe, bez cykli; dane innego modułu zmieniaj przez jego operację; kod współdzielony wydzielaj dopiero przy wspólnym znaczeniu, bez worków `utils`/`common`/`shared`. Nowy moduł nie wymaga osobnego pakietu, procesu ani usługi.
- Przypadki użycia serwera w obszarach `materials`, `learning`, `family`, `reporting`; kierunki `reporting` → `learning` → `materials`, każdy → `family`. Inny obszar importuje tylko z barrela właściciela (`../materials`), wewnątrz obszaru importy bezpośrednie, własny barrel zakazany; web i worker importują wyłącznie `@learning/server`. Po zmianie w `modules/` uruchom najpierw `*.architecture.test.ts`.
- Własność jest semantyczna, nie tabelowa (np. pole polityki nauki w profilu należy do `learning`); raportowanie czyta tabele źródłowe, ale nie modyfikuje ocen ani postępu.
- Nazwane wyjątki granic — nie kopiuj ich ani nie „naprawiaj” przy okazji: `config.ts` i adaptery importują `materials/lessons/lesson-generation-policy` wprost; testy integracyjne importują pliki wewnętrzne; root `index.ts` eksportuje infrastrukturę; `providers/usage` zapisuje koszty osobnym `INSERT` poza transakcją, `flush()` nigdy w transakcji.
- Reguły oceniania, samodzielności, planowania, powtórek i postępu to funkcje domenowe nad jawnie przekazanymi danymi (czas, losowość, id przekazane). `src/domain` nie importuje Next.js, oRPC, Drizzle, klientów bazy, SDK providerów ani env (test granic sprawdza tylko importy względne — pilnuj gołych importów npm sam).
- Kontrolery HTTP, procedury oRPC, MCP i zadania workera wołają przypadki użycia, bez własnych kopii reguł. Porty definiuj według operacji biznesowej, nie jako kopię API biblioteki. Abstrakcje tylko z konkretnej potrzeby; nie przebudowuj całego obszaru przy jednej funkcji.
- Koordynator przypadku użycia ustala granicę transakcji; powiązane zapisy prób, ocen, ekspozycji i projekcji w jednej transakcji, bez ukrytych commitów. Zachowuj blokady, idempotencję, kolejność ujawnień, wersjonowanie i niezmienność historii.
- Przed implementacją wskaż moduł, zależności i granicę transakcji; w raporcie końcowym — gdzie są reguły, jakie zależności dodano, jakie gwarancje zweryfikowano.
- SDK dostawców tylko w adapterach za portami (LLM, TTS, STT, pronunciation, images, media); domena nie zna Azure/OpenAI. LLM generuje materiał; sesję prowadzą jawne reguły serwera — wyjątek: model oceniający lekcji (`docs/agents/lessons.md`).
- Treść językową tworzy i ocenia model, kod pilnuje struktury, porównań, obliczeń i przebiegu nauki: nie dodawaj reguł rozumiejących język naturalny ani nie poprawiaj istniejących heurystyk (zamrożone do usunięcia). Nowy przedmiot przez `SubjectModule` + rejestr, bez logiki przedmiotu w silniku; nowa reguła walidacji lekcji jako wpis katalogu z przypadkiem w `*.rule-cases.ts`, zgłaszana tylko `issueFrom`.
- Domyślne wartości env w `packages/server/src/config-defaults.ts` (`.env` tylko nadpisuje); nowe miejsce składania zależności z env buduj na `withConfigDefaults(process.env)`. `OPENROUTER_API_KEY` tylko po https do OpenRouter; dyktowanie nigdy go nie używa.
- Schemat bazy: autorytatywny Drizzle TS + przeglądane migracje SQL (z triggerami); `docs/schema.sql` to projekt początkowy, nie druga definicja.

MCP i skill
- Przy każdej zmianie API (endpointy, DTO, parametry, domyślne wartości, autoryzacja, kody błędów, znaczenie danych) sprawdź wpływ na MCP i `SKILL.md` i zaktualizuj w tym samym PR adapter, walidację i skill. Regeneruj JSON Schema z `packages/contracts` i kopię u konsumenta; nie rozwijaj ręcznie rozbieżnych definicji; sprawdź `schemaVersion` i zgodność z wdrożonymi wersjami.
- W opisie PR podaj wpływ API → MCP → skill, wykonane sprawdzenia (endpoint HTTP, walidacja kontraktu, klient Streamable HTTP na fikcyjnych danych) i wymagane wdrożenia u konsumentów; brak wpływu uzasadnij. Hermes łączy się jako zwykły klient MCP (`url` + Bearer); nie trzymaj tu klienta REST, serwera stdio ani forka schematu.
- Token `lessons:write` (jeden zakres na token) daje na `/api/mcp` narzędzia pisania szkiców lekcji (`docs/integrations/lesson-authoring.md`, publiczne `/api/mcp` wg `docs/architecture.md` §13); ich skill `skills/umiem-lesson-authoring` leży poza archiwum Hermesa, bez schematu konsumenta i zmiany manifestu, bo kontrakt niosą `inputSchema`/`outputSchema` z `tools/list`.
- `SKILL.md`: prawdziwe nazwy narzędzi i parametrów, ograniczenia, interpretacja, błędy, prywatność; bez tokenów, danych dzieci i twierdzeń, że poprawne odpowiedzi to trwałe opanowanie albo brak zapisu to brak nauki; czas szacowany jawnie oznaczony. `learning-overview` świadomie nie obejmuje lekcji — utrzymaj filtr i notę.

Dane i nauka
- Opublikowana treść jest niezmienna: edycja tworzy nowy szkic, sesja przypina wersję zestawu i polityki. Oddzielaj `learning_item`, `item_revision` i `skill_version`; postęp osobno per dziecko i umiejętność (listening, reading, recall, pronunciation, spelling); stara próba nie awansuje nowych kryteriów.
- Historia prób, ocen i ekspozycji jest źródłem; liczniki postępu to odtwarzalna projekcja. Nie przepisuj zakończonych ocen. Usunięcie profilu usuwa jego historię i transkrypcje, zachowując wspólny materiał.
- Serwer zapisuje i zamyka komplet ekspozycji PRZED wysłaniem ujawnianej treści (podpowiedzi, dystraktory, feedback, retry, ponowny odsłuch z cache); ACK klienta to tylko obserwacja.
- Operacje sesji wszystkich klientów pod tą samą blokadą; kontekst kwalifikacji próby zamraża się przy `received_at`, przed analizą mowy. Wydane zadanie ma niezmienny prompt, klucz i kontekst; exposure kończy idempotentne `complete-presentation`, bez próby, oceny i zużycia budżetu.
- Scheduler chroni cele należnych samodzielnych sprawdzeń przed wcześniejszym ujawnieniem, także jako dystraktory. Jedna samodzielna odpowiedź pisemna może oceniać Recall i pisownię oddzielnie.
- Zwykłe STT sprawdza treść, osobny provider ocenia wymowę; zatwierdzone warianty są poprawne także w mowie; wyniku wymowy dla innego wariantu nie przenoś na wypowiedziany tekst.
- Parametry startowe polityki (`packages/server/src/policies/learning-v1.ts`): 300 s od ujawnienia dla samodzielnego Recall/pisowni, trzy ostatnie kwalifikujące sukcesy, potwierdzenie innego dnia po min. 12 h, wsparcie po dwóch błędach; wyjątki wg SPEC i architektury.
- „Nie pamiętam” jest trudnością; „Pomiń”, cisza, niepewne rozpoznanie i awaria techniczna nie są dowodem błędnej wiedzy; niepewny STT nie tworzy pomyłki między słowami.
- Testy reguł oceny, historii, współbieżności i danych: domena z kontrolowanym zegarem, integracja na docelowym PostgreSQL, providerzy jako fake-adaptery; pokryj odpowiednie R01–R07 (awarie, retry, dwie przeglądarki, usuwanie profilu).

Generowanie, media, prywatność
- Waliduj structured output AI na serwerze; materiał dostępny dziecku wymaga zatwierdzenia rodzica.
- TTS generuj i cache'uj przy przygotowaniu materiału; gotowy zasób i jego bajty są niezmienne, regeneracja tworzy nowy zasób. Media job wiąże się z `asset_id`, lease należy do zasobu; każda edycja uzgadnia fingerprinty i zleca brakujące media w tej samej transakcji. `MediaStore.putImmutable` nie nadpisuje blobu; spóźniony worker nie zmienia gotowych mediów ani powiązań szkicu.
- Nagranie dziecka tylko krótkotrwale w pamięci — nigdy w bazie, kolejce, plikach tymczasowych, logach, fixture ani backupie; zwolnij mikrofon i bufory także po błędzie i anulowaniu.
- Kid DTO nie zawiera klucza odpowiedzi, kryteriów oceny ani technicznych score'ów; nie serializuj rekordów bazy wprost.
- Do usług AI nigdy imię, rok urodzenia, identyfikatory ani nagrania dziecka; token tylko w adapterze. Co dokładnie trafia do gradera, generatora paczek, kontroli zamkniętych, oceny aktywności i tematów zdań — `docs/agents/providers-privacy.md`.
- Nowy płatny adapter przyjmuje `usage?: UsageRecorder`, woła `record` raz na żądanie HTTP przed walidacją wyniku i trafia do `PAID_ADAPTERS`; `withUsageScope` tylko w przypadkach użycia. Koszty nie trafiają do MCP, `learning-overview` ani `SKILL.md`.
- Parent Mode wymaga PIN-u/hasła, sesji i serwerowej autoryzacji każdej operacji; wybór profilu dziecka nie jest zabezpieczeniem. Pierwsze ustawienie PIN-u wymaga `UMIEM_SETUP_TOKEN` (bez wartości domyślnej). Dostęp spoza domu wymaga osobnego ustalenia; nie buduj platformy wielorodzinnej.

UX
- Polski tekst krótki, naturalny, zrozumiały dla dziecka; duże pola dotykowe, jeden jasny krok, mobile first, tablet friendly. Feedback odpowiada rzeczywistemu wynikowi („Świetnie!”, „Prawie! Posłuchaj jeszcze raz”, „Spróbuj jeszcze raz”) — nie chwal błędnej odpowiedzi.
- Sesje ok. 5–10 minut; po „Jeszcze 3 i koniec!” nie dokładaj zadań ponad budżet (wyjątek: zapowiedziana historyjka lekcji z 1–2 pytaniami, które nie liczą się do postępu).
- Dziecko nie widzi modeli, promptów, procentowych ocen, konfiguracji powtórek ani administracji. Rodzic ma prosty podgląd, edycję, przypisania i postęp per umiejętność. Obraz pomaga w znaczeniu (object/action); kolor, liczba i sekwencja renderowane deterministycznie.
- Nauka bez mikrofonu jest pełnoprawna; odmowa uprawnienia nie blokuje sesji. PWA nie obiecuje offline; utrata sieci nie tworzy lokalnie fałszywego sukcesu.
- Nie deklaruj gotowej oceny wymowy, layoutu ani zachowania na urządzeniu bez dowodu z prawdziwego providera lub urządzenia; symulacja to nie odbiór — brak dowodu raportuj jawnie.

Poza zakresem MVP — nie implementuj z wyprzedzeniem: OCR/PDF i podręczniki, chat/awatar AI, rozmowy realtime, OAuth, social/rankingi, marketplace, płatności, rozbudowana gamifikacja, CEFR, natywna aplikacja Android/iOS (Capacitor tylko jako przyszły host Kid UI), pełna synchronizacja offline.

<!-- /bmad:context -->
