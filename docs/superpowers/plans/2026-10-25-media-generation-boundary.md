# Etap 7: wykonanie generowania mediów — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Oddzielić wykonanie generowania zasobów od generowania treści słówek, zachowując istniejące wejścia, transakcje i zachowanie.

**Architecture:** Przenieść wykonawcę zasobu wraz z jego prywatnymi pomocnikami do `modules/media-generation.ts`. Trzy współdzielone elementy umieścić w `modules/generation-runtime.ts`, aby zachowana delegacja z `executeGeneration` do mediów nie utworzyła cyklu. To wewnętrzny podział obszaru materiałów, bez nowego modułu produktu, portu ani pakietu.

**Tech Stack:** TypeScript strict, Drizzle, PostgreSQL, istniejące porty providerów i MediaStore, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`; gwarancje mediów: `docs/architecture.md`, sekcje 7–8. Zakres etapu wynika z polecenia przygotowania kolejnego planu; implementacja wymaga osobnego polecenia.

## Global Constraints

- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst wykonania i nie otwiera własnego niezależnego commitu.”
- Zachowaj maksymalnie trzy automatyczne próby oraz lease mediów `5 * 60_000` ms. Nie zmieniaj momentu pobrania zegara, UUID, kolejności zapytań, predykatów SQL, obsługi błędów ani logów.
- Zachowaj `executeGeneration(services, runId, signal?)`, w tym delegację runów mediów i obecny błąd dla runu lekcji. Zachowaj wszystkie eksportowane nazwy `@learning/server`.
- Bez zmian schematu, kontraktów, providerów, UI, SubjectModule, polityki retry lekcji, wdrożenia i instalowania zależności. Bez event busa, osobnych repozytoriów tabel i nowych transakcji.
- Bez push, PR i merge. Nie nadpisuj niezwiązanych zmian.

## Review Focus

1. Wywołanie `executeGeneration` dla runu TTS nadal kończy ten sam asset/run; powtórka nie wywołuje providera ponownie — nowa charakterystyka w zadaniu 1.
2. Równoległe workery oraz utrata lease przy anulowaniu zachowują ochronę zasobu — istniejące testy `media.test.ts` i `generation.test.ts`, zadania 1–2.
3. Zmiana szkicu i ręczna regeneracja nie podmieniają opublikowanych mediów — istniejące testy `media.test.ts`, zadanie 2.
4. Wyłączone TTS gramatyki, współdzielone audio słówek i audio UI zachowują własne reguły — istniejące testy `grammar-without-tts.test.ts` i `ui-audio.test.ts`, zadanie 2.
5. Nowy plik mediów nie importuje wykonawcy treści ani koordynatora, także przez reeksport lub alias — rozszerzona kontrola AST, zadanie 1.

---

## Rozpoznanie i wybór

Stan rozpoznania: czyste drzewo, gałąź `feature/task-completion-refactor`, po etapie 6 (`0bdbe1d`). Przed implementacją sprawdź aktualny stan ponownie.

- `modules/generation.ts:297` zawiera `executeGeneration`: wykonuje deck, odrzuca run lekcji i dla pozostałych rodzajów deleguje do `executeMediaAsset`.
- `modules/generation.ts:409–643` zawiera spójny fragment wykonania mediów: claim runu, lease zasobu, wyłączenie TTS nieaktywnych przedmiotów, wywołanie providera, immutable store, finalizację, błędy i anulowanie. Ma inne dane wejściowe oraz warunki zapisu niż generacja treści.
- `modules/generation-worker.ts` już koordynuje wykonawców; powinien importować wykonawcę mediów bezpośrednio z jego pliku.
- `modules/lessons/lesson-drafts.ts` używa `requireGeneration`, limitu prób oraz trzech pomocników runów z `generation.ts`. Nie należy przenosić przy okazji całej obsługi runów ani lekcji.
- Wykonawca mediów potrzebuje z obecnego pliku tylko `requireGeneration`, `MAX_AUTOMATIC_ATTEMPTS` i `errorCodeOf`. Pozostawienie ich w `generation.ts` przy zachowanej delegacji utworzyłoby cykl `generation → media-generation → generation`.

Rozważone warianty:

| Wariant | Ocena |
| --- | --- |
| Przenieść same media i importować pomocniki z `generation.ts` | Odtwarza cykl; odrzucony |
| Przenieść media oraz trzy wspólne elementy do małego pliku wsparcia | Rekomendacja autora planu: rozdziela rzeczywiste odpowiedzialności i zachowuje wejścia |
| Przebudować obsługę wszystkich runów, retry i dostępu do bazy | Większy zakres bez potrzeby tego etapu; odłożony |

`generation-runtime.ts` ma dokładnie trzy wymienione eksporty. Nie jest miejscem na dowolne helpery. Nie wprowadzamy kolejnej fasady `index.ts` ani katalogu `shared`.

## Własność i transakcje

Obszarem produktu pozostają materiały. `generation.ts` zachowuje zlecanie, odczyt i ręczne retry runów oraz wykonanie treści słówek. `media-generation.ts` odpowiada za wykonanie jednego zasobu po `assetId`; nie zarządza powiązaniami szkicu. `media-reconciliation.ts` nadal uzgadnia i zleca zasoby w transakcji edycji materiału.

Przenosimy istniejące granice transakcji bez zmian: finalizacja asset/run po CAS pozostaje jedną transakcją; wywołanie providera i `putImmutable` pozostają poza nią. Transakcje wygaszania niepotrzebnego TTS, obsługi terminalnej porażki i anulowania pozostają w swoich dotychczasowych miejscach. Nie łączymy obecnych osobnych zapisów błędu w nową transakcję pod pretekstem porządkowania. Potencjalne zmiany ochrony błędnych/starych zapisów wymagają osobnej propozycji i testu.

Dozwolone zależności:

```text
generation-worker → generation, media-generation, lesson-drafts, worker-schedule
generation → media-generation, generation-runtime, dotychczasowe zależności treści
media-generation → generation-runtime, db, config (typ), istniejące porty przez Services
lesson-drafts → generation-runtime, istniejące pomocniki runów w generation
generation-runtime → config (wyłącznie typy), errors, zod
```

`media-generation` zachowuje istniejące zależności od katalogu audio UI i helpera czasu MP3. Nie importuje `generation`, `generation-worker` ani `lesson-drafts`. `generation-runtime` nie importuje żadnego wykonawcy ani koordynatora. Podział nie usuwa pozostałych, pośrednich zależności całej aplikacji.

## Mapa plików

| Operacja | Plik | Odpowiedzialność |
| --- | --- | --- |
| Utwórz | `packages/server/src/modules/media-generation.ts` | `executeMediaAsset`, lease i wszystkie prywatne pomocniki wykonawcy mediów |
| Utwórz | `packages/server/src/modules/generation-runtime.ts` | Istniejące: `requireGeneration`, `errorCodeOf`, `MAX_AUTOMATIC_ATTEMPTS` |
| Zmień | `packages/server/src/modules/generation.ts` | Usuń przeniesione definicje; importuj wspólne elementy i wykonawcę mediów |
| Zmień | `packages/server/src/modules/generation-worker.ts` | Bezpośrednie importy właściwych wykonawców i wsparcia |
| Zmień | `packages/server/src/modules/lessons/lesson-drafts.ts` | Dwa importy: wsparcie z runtime, pozostałe pomocniki z generation |
| Zmień | `packages/server/src/index.ts` | Zachowaj nazwy i typy eksportów, zmień wyłącznie źródła |
| Zmień | `packages/server/src/modules/generation-worker.architecture.test.ts` | Rozszerz obecną kontrolę AST; nie duplikuj parsera |
| Zmień | `tests/integration/media.test.ts` | Charakterystyka wejścia przez `executeGeneration` |
| Zmień | `docs/folder-structure.md` | Rozróżnij treść, media, wspólne wsparcie i koordynację |

## Task 1: Wydziel wykonawcę mediów bez cyklu i bez zmiany zachowania

**Interfaces:**

- Zachowaj `executeMediaAsset(services: Services, assetId: string, signal?: AbortSignal): Promise<void>`; nowa lokalizacja: `media-generation.ts`.
- Zachowaj `requireGeneration(services: Services): GenerationDeps`, `errorCodeOf(error: unknown): string` i `MAX_AUTOMATIC_ATTEMPTS = 3`; nowa lokalizacja: `generation-runtime.ts`.
- Zachowaj `executeGeneration(services: Services, runId: string, signal?: AbortSignal): Promise<void>` w `generation.ts`, łącznie z wejściem dla mediów.
- Prywatne w `media-generation.ts`: `MEDIA_LEASE_MS`, `claimMediaRun`, `failMediaAsset`, `requeueAbortedMediaAsset`, `supersedeDisabledLessonTts`, `assetReady`. Sygnatury i ciała przenieś bez zmian.
- `@learning/server` eksportuje `executeMediaAsset` bezpośrednio z nowego pliku i trzy wspólne nazwy bezpośrednio z runtime. Przed usunięciem starych lokalizacji wyszukaj wszystkie importy; znalezionych konsumentów wewnętrznych przełącz w tym samym zadaniu.

- [x] **Step 1: Sprawdź stan i środowisko.** Przeczytaj AGENTS.md i wskazane fragmenty dokumentacji. Potwierdź istniejący worktree, `git status --short`, definicje skryptów, `node_modules` i `.env`. Nie instaluj zależności, jeśli istnieją; brakujący `.env` uzupełnij przez `node scripts/setup-worktree.cjs --skip-install`. Nie przełączaj współdzielonego checkoutu.
- [x] **Step 2: Dodaj test charakterystyki „wejście executeGeneration wykonuje run TTS i zachowuje idempotencję”.** W `media.test.ts` wykorzystaj `createDraft`, `reconcileDraftAssets`, `assetLink`, `runOfAsset` i istniejące fake-adaptery. Pobierz run `target_audio`, wykonaj `executeGeneration(services, run.id)` i sprawdź `asset.state === "ready"`, `run.state === "succeeded"`, `attempts === 1`, `callsFor("Thursday") === 1`. Powtórz wywołanie i potwierdź te same wartości oraz niezmienione `storage_key`/`content_sha256`. Nie oczekuj niezmienności `finishedAt`: istniejąca ścieżka może je aktualizować.
- [x] **Step 3: Uruchom charakterystykę przed refaktoryzacją.** `corepack pnpm test:integration tests/integration/media.test.ts` na docelowym PostgreSQL przez istniejący setup. Oczekiwane PASS; jest to charakterystyka istniejącego zachowania, więc nie wymuszaj sztucznego RED. Zapisz wynik, nie deklaruj pokrycia całej aplikacji.
- [x] **Step 4: Rozszerz test granic przed przeniesieniem.** Użyj istniejącego parsera AST i normalizacji względnych ścieżek. Dodaj mapę zabronionych krawędzi dla media/runtime; zachowaj dotychczasowe zakazy etapu 6. Dodaj sprawdzenie, że `index.ts` eksportuje `executeMediaAsset` z `media-generation`, a trzy wspólne nazwy z runtime, bez zmiany nazw publicznych. Próby kontrolne obejmują import pod aliasem, pojedyncze cudzysłowy, reeksport, ścieżkę z `../`, literalne `import()` i `require()`. Sprawdź też brak tych czterech definicji w `generation.ts`, aby nie zostawić drugiej implementacji. Test kontroluje te pliki, nie cały graf pośrednich zależności.
- [x] **Step 5: Potwierdź RED kontroli granic.** `corepack pnpm test:unit packages/server/src/modules/generation-worker.architecture.test.ts`. Oczekiwane naruszenie nowej lokalizacji eksportów/definicji; brakujący plik także jest dopuszczalnym powodem, jeśli wskazuje planowaną granicę. Dotychczasowe przypadki parsera mają nadal przechodzić.
- [x] **Step 6: Przenieś definicje i przełącz importy według mapy.** Przenieś blok mediów i stałą lease bez zmiany ciał. Trzy wspólne elementy przenieś bez zmiany ich klasyfikacji błędów i komunikatów. Wyczyść wyłącznie nieużywane importy. Nie dodawaj eksportu wykonawcy treści przez plik mediów ani odwrotnej zależności runtime. `executeGeneration` nadal importuje i wywołuje wykonawcę mediów.
- [x] **Step 7: Potwierdź GREEN oraz zgodność przeniesionego kodu.** Uruchom `corepack pnpm test:unit packages/server/src/modules/generation-worker.architecture.test.ts packages/server/src/modules/worker-schedule.test.ts apps/worker/src/tasks.test.ts packages/server/src/domain/lessons/architecture.test.ts`. Porównaj przeniesione ciała z bazowym commitem; różnice semantyczne wycofaj lub zgłoś jako osobny zakres. Integracyjną charakterystykę po przeniesieniu uruchomi zbiorcze sprawdzenie zadania 2.
- [x] **Step 8: Zapisz lokalny commit.** Dodaj wyłącznie pliki zadania, po `git diff --check`. Proponowany komunikat: `refactor: separate media generation execution`. Bez push i PR.

## Task 2: Zweryfikuj połączony przepływ i opisz nową odpowiedzialność

**Interfaces:** Korzysta z niezmienionych eksportów zadania 1. Nie dodaje nowych operacji ani zmian produktu.

- [x] **Step 1: Uruchom wybrane testy integracyjne na PostgreSQL.** Ustaw unikalny dla worktree `UMIEM_TEST_RUN_ID` zgodnie z istniejącym setupem i wykonaj:

```powershell
$env:UMIEM_TEST_RUN_ID = 'media-boundary-7be8'
corepack pnpm test:integration tests/integration/generation.test.ts tests/integration/media.test.ts tests/integration/lesson-generation.test.ts tests/integration/grammar-without-tts.test.ts tests/integration/ui-audio.test.ts
```

Oczekiwane: wszystkie testy PASS i kod wyjścia 0. W tej paczce muszą wykonać się nowa charakterystyka oraz istniejące przypadki równoległego wykonania, utraty lease przy anulowaniu, odzyskania po awarii, starej edycji, ręcznej regeneracji, wyłączonej gramatyki i wspólnego audio/UI. Nie zastępuj tych dowodów SQLite/PGlite ani testem samego mocka bazy.

- [x] **Step 2: Sprawdź typy i kompilację konsumentów.** `corepack pnpm typecheck`, następnie `corepack pnpm build`; oba z kodem 0. Nie powtarzaj pełnych kontroli bez nowej zmiany lub nierozstrzygniętego błędu.
- [x] **Step 3: Uaktualnij dokumentację i oceń API → MCP → skill.** W `folder-structure.md` opisz trzy pliki i pozostającą delegację kompatybilności w `generation.ts`. Potwierdź diffem brak zmian endpointów, kontraktów, autoryzacji i semantyki raportu. Zapisz uzasadnienie braku aktualizacji MCP/skilla: zmieniły się wyłącznie wewnętrzne źródła eksportów, `getLearningOverview` i wyłączenie lekcji pozostały bez zmian. Nie regeneruj niezmienionego schematu.
- [x] **Step 4: Przejrzyj końcowy zakres.** Sprawdź `git diff --check`, stan repozytorium oraz porównanie z bazowym commitem. Zleć jeden świeży przegląd etapu zgodnie z `superpowers:requesting-code-review`; uwzględnij zachowaną delegację, kierunek importów, fazy transakcji i pięć Review Focus. Napraw istotne uwagi i uruchom tylko dotknięte sprawdzenia.
- [x] **Step 5: Zapisz rzeczywiste wyniki i lokalny commit dokumentacji.** Uzupełnij ten plan o wykonane polecenia, wyniki, uwagi przeglądu i brakujące dowody; zaznacz tylko wykonane kroki. Proponowany komunikat: `docs: record media generation boundary verification`. Pozostaw branch/worktree lokalnie.

## Kryterium zakończenia i ograniczenia

Wykonawca mediów jest czytelny osobno, ma jedno źródło implementacji i nie importuje wykonawcy treści. Oba wejścia (`executeMediaAsset` oraz delegacja z `executeGeneration`) działają zgodnie z dotychczasowym kontraktem. Kontrola granic i wybrane testy zachowania przechodzą; nie zmieniły się transakcje ani liczba wywołań providerów.

Drizzle, zapytania PostgreSQL, CAS/lease, `Services` i powiązania z tabelami pozostają w wykonawcach. `generation-runtime.ts` zawiera także dostęp do konfiguracji usług i nie jest czystą domeną. Przenośność istniejących portów mediów/providerów nie oznacza przenośności całej obsługi zasobów.

E2E, fizyczne urządzenia i prawdziwi providerzy nie są wymaganymi dowodami tego wewnętrznego przeniesienia; nie deklaruj ich wykonania. Dalsze wydzielanie obsługi runów albo domykanie szerokiej fasady materiałów jest osobną decyzją po ocenie korzyści, a nie automatycznym etapem 8.

## Wyniki wykonania

- Charakterystyka przed przeniesieniem: `corepack pnpm test:integration tests/integration/media.test.ts` — 1 plik, 11 testów PASS na PostgreSQL.
- Kontrola granic RED: 14 testów, 3 oczekiwane niepowodzenia (brak nowych modułów/właścicielskich reeksportów); GREEN: 14/14.
- Testy jednostkowe: 4 pliki, 25 testów PASS.
- Testy integracyjne na PostgreSQL 17: 5 plików, 70 testów PASS; obejmują generation, media, lesson-generation, grammar-without-tts i ui-audio.
- `corepack pnpm typecheck` i `corepack pnpm build` — kod wyjścia 0.
- Porównanie przeniesionych ciał: blok mediów oraz `requireGeneration` i `errorCodeOf` identyczne względem commitu bazowego po normalizacji końców linii.
- API → MCP → skill: endpointy, DTO, autoryzacja i znaczenie raportu nie zmieniły się; `getLearningOverview` oraz nota o wyłączeniu lekcji są nietknięte. Aktualizacja MCP/skilla i regeneracja schematu nie były wymagane.
- Commit implementacji: `37600f4 refactor: separate media generation execution`.

- Niezależny przegląd całego zakresu `0bdbe1d..37600f4` oraz staged dokumentacji: bez uwag Critical/Important/Minor; zgodność z planem potwierdzona. Reviewer nie uruchamiał testów ani nie zmieniał drzewa roboczego.
- Ograniczenia dowodów: nie testowano prawdziwych providerów, E2E/fizycznych urządzeń/produkcji ani pełnego grafu pośrednich importów. Nie są to cele tego refaktoru; rzeczywiste zachowanie zewnętrznych providerów i pozostałe krawędzie pośrednie pozostają poza zweryfikowanym zakresem.