# Etap 5: operacje dostępu do raportów kartkówek — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przenieść trzy rozgałęzienia obsługi raportów kartkówek z routerów oRPC do małego publicznego API serwera.

**Architecture:** Nowy `modules/mock-test-reports.ts` wybiera istniejącą obsługę lekcji albo słówek. Routery przekazują parametry i opakowują wynik przez obecne `noStore`. Wyspecjalizowane operacje zachowują własne transakcje, blokady, zamykanie sesji i zapis ekspozycji; fasada nie otwiera dodatkowej transakcji.

**Tech Stack:** Obecne TypeScript, Next.js/oRPC, Drizzle/PostgreSQL 17 i Vitest; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, sekcje „Organizacja kodu i publiczne granice”, „Reguły i infrastruktura”, „Granice transakcji i gwarancje”; `AGENTS.md`; `docs/architecture.md` §9.2 i §12 oraz §19 (kartkówki lekcji); `docs/folder-structure.md` §5. Rozpoznany stan: `1eb1bac`, `feature/task-completion-refactor`.

## Global Constraints

- „Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji, zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.”
- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst wykonania i nie otwiera własnego niezależnego commitu.”
- Zachowaj HTTP, DTO, unie wyników, koperty błędów, walidację wejścia oraz `cache-control: no-store`.
- Autoryzacja rodzica pozostaje przed wywołaniem operacji serwera. Nie dodawaj autoryzacji rodzica do omówienia Kid API ani nowego modelu dostępu.
- Odczyt omówienia nadal zapisuje kompletną zapieczętowaną ekspozycję przed odpowiedzią; raport rodzica nie ujawnia rozwiązań i nie dopisuje takich ekspozycji.
- Zachowaj niezmienność zakończonego raportu oraz istniejące zamykanie wygasłych sesji. Nie przenoś SQL ani kodu zamykania sesji do nowego pliku.
- Bez zmian schematu, kontraktów, algorytmu oceniania, `SubjectModule`, UI i providerów. Bez push, PR i merge.

## Review Focus

1. Funkcje raportujące mogą zamykać wygasłą sesję: zachowaj istniejącą transakcję operacji, próg `600_000` ms i błąd `conflict` dla jeszcze aktywnej kartkówki — przypadki graniczne w kroku 2.
2. Omówienie przy ponownym odczycie nadal dopisuje ekspozycje tylko wydanych zadań, z kompletem target keys i pieczęcią — test HTTP na PostgreSQL w kroku 2.
3. Nieautoryzowany rodzic nie uruchamia ani klasyfikacji, ani zamykania sesji przez fasadę — test routera w kroku 4.
4. Nieznana sesja oraz sesja treningowa zachowują `not_found`; pusta lista dla istniejącego zestawu zachowuje `[]` — testy w kroku 2.
5. Obie odmiany DTO przechodzą rzeczywistą serializację oRPC wraz z `no-store` — testy obu routerów w kroku 4.

---

## Rozpoznanie

`kid-router.ts:147` klasyfikuje sesję przez `mockTestKindOfSession`, po czym wybiera `readLessonMockTestSummary` albo `readMockTestSummary`. `parent-router.ts:335` wybiera listę po `readDeckKind`, a `:344` raport po rodzaju sesji. To cały zakres etapu: trzy miejsca podejmują tę samą decyzję biznesową poza modułem nauki.

`modules/mock-tests.ts` i `modules/lessons/lesson-mock-tests.ts` już implementują właściwe zachowania. `get*Report` i `read*Summary` otwierają transakcje; omówienie zapisuje ekspozycje, a raport/lista mogą zamknąć wygasłą kartkówkę. Lista zachowuje limit 20 i sortowanie malejąco po starcie i ID. Nowa fasada przenosi istniejący dispatch, bez zmiany tych operacji ani scalania ich transakcji. Klasyfikacja pozostaje przed delegacją, jak dzisiaj.

## Pliki i publiczne API

| Operacja | Plik | Zakres |
| --- | --- | --- |
| Utwórz | `packages/server/src/modules/mock-test-reports.ts` | Trzy operacje wybierające obsługę raportów |
| Utwórz | `packages/server/src/modules/mock-test-reports.architecture.test.ts` | Kierunek zależności i granica routerów |
| Zmień | `packages/server/src/index.ts` | Eksport nowych operacji; zachowanie istniejących eksportów dla klientów |
| Zmień | `apps/web/src/orpc/kid-router.ts` | Omówienie deleguje do jednej operacji |
| Zmień | `apps/web/src/orpc/parent-router.ts` | Raport i lista delegują do jednej operacji każdy |
| Zmień | `apps/web/src/orpc/kid-router.test.ts`, `parent-router.test.ts` | Testowanie transportu względem nowej granicy |
| Zmień | `apps/web/src/parent/orpc-contract.ts` | Wyłącznie komentarz opisujący wybór wyniku po stronie serwera |
| Utwórz | `tests/integration/mock-test-report-access.test.ts` | Rzeczywisty dispatch, cykl życia i ekspozycje obu rodzajów kartkówek |
| Zmień | `docs/folder-structure.md` §5 | Odpowiedzialność fasady i istniejących implementacji |

```ts
// modules/mock-test-reports.ts
import type { Services } from "../config";
import type {
  MockTestReportDto, LessonMockTestReportDto,
  MockTestSummaryDto, LessonMockTestSummaryDto,
} from "@learning/contracts";

export function getMockTestReportForSession(
  services: Services, sessionId: string,
): Promise<MockTestReportDto | LessonMockTestReportDto>;

export function listMockTestReportsForDeck(
  services: Services, childId: string, deckId: string,
): Promise<MockTestReportDto[] | LessonMockTestReportDto[]>;

export function readMockTestSummaryForSession(
  services: Services, sessionId: string,
): Promise<MockTestSummaryDto | LessonMockTestSummaryDto>;
```

Zależności runtime wyłącznie do `./deck-kind`, `./mock-tests` i `./lessons/lesson-mock-tests`; typy z kontraktów i `../config`. Nie importuj `../index`, routerów ani modeli ORM. Każda operacja klasyfikuje raz i deleguje do jednej istniejącej funkcji, przekazując te same argumenty. Nie dodawaj cache, własnej walidacji, obsługi błędów ani nowego zamykania sesji. Niezmienione niskopoziomowe eksporty pozostają dostępne dotychczasowym konsumentom.

### Task 1: Przenieś dispatch raportów do serwera i podepnij routery

- [ ] **Step 1: Sprawdź worktree i wykonaj mały baseline.**

Sprawdź stan/HEAD, istniejące skrypty, `.env` i `node_modules`; użyj obecnego izolowanego worktree i zachowaj cudze zmiany. Czytaj wskazane fragmenty dokumentacji i trzy handlery. Przy istniejących zależnościach pomiń instalację; brak `.env` uzupełnij przez `node scripts/setup-worktree.cjs --skip-install` bez drukowania wartości.

Run: `corepack pnpm test:unit apps/web/src/orpc/kid-router.test.ts apps/web/src/orpc/parent-router.test.ts`.
Expected: PASS. Nie uruchamiaj pełnego monorepo/e2e jako baseline.

- [ ] **Step 2: Dodaj testy publicznych operacji z prawdziwym PostgreSQL i obejrzyj RED.**

W nowym `mock-test-report-access.test.ts` użyj `buildTestServices`, `ManualClock`, `mockTestDeck` i `lessonWorld(..., { richPool: true, testDate: "2026-10-20", childId })`. Korzystaj z istniejącego sprzątania fixture lekcji i tabel profili. Testy parametryzuj rodzajem materiału; startuj prawdziwe sesje, wydawaj zadanie i kończ je przez istniejące operacje, bez ręcznego zmieniania historii.

Oczekiwania:

- Dla obu rodzajów wydaj jeden slot, pomiń odpowiedź, zakończ sesję. `getMockTestReportForSession` zwraca właściwy kształt raportu i tę samą utrwaloną treść przy ponowieniu; `listMockTestReportsForDeck` zawiera ten raport. Odczyty rodzica nie zwiększają liczby `feedback_issued`.
- Przez `handleKidApi` wywołaj dwukrotnie `GET /api/v1/kid/sessions/{sessionId}/mock-test-summary`, przesuwając zegar o sekundę. Odpowiedzi: 200, `no-store`, ten sam właściwy DTO i wyłącznie wydany task w rozwiązaniach. Każdy odczyt tworzy osobne zapieczętowane `feedback_issued` dla tego taska, z dokładnym target key z przypiętego planu; sprawdź `event_exposures` i projekcję `child_target_exposures`, w tym czas drugiego ujawnienia. Brak ekspozycji dla niewydanych slotów.
- Aktywna kartkówka obu rodzajów: raport i omówienie zwracają `conflict` przy upływie dokładnie `600_000` ms; lista jej wtedy nie zawiera. Po `600_001` ms odczyt raportu lub listy zamyka ją jako niepełną i kolejne odczyty zachowują utrwalony wynik. Nie zmieniaj tego istniejącego progu przy okazji refaktoryzacji.
- Nieistniejący session ID i ID sesji treningowej: raport/omówienie → `not_found`. Nieistniejący deck ID: lista → `not_found`. Istniejący zestaw bez kartkówek wskazanego dziecka: `[]`, bez zmiany kontraktu na `not_found`.

Run z `$env:UMIEM_TEST_RUN_ID='mock-test-report-access-7be8'`: `corepack pnpm test:integration tests/integration/mock-test-report-access.test.ts`.
Expected RED: brak nowych eksportów/funkcji serwera. Problem środowiska lub fixture nie jest prawidłowym RED.

- [ ] **Step 3: Zaimplementuj fasadę i eksporty.**

Utwórz podany moduł i trzy funkcje. Raport/omówienie używają `mockTestKindOfSession(services.db, sessionId)`; lista używa `readDeckKind(services.db, deckId)`. Przenieś dokładne gałęzie istniejących handlerów. Wyeksportuj nowe funkcje z `packages/server/src/index.ts`, zachowując dotychczasowe eksporty. Produkcyjne moduły źródłowe nie importują fasady; zależność biegnie wyłącznie od fasady do implementacji.

Przed podłączeniem Kid routera testy nowych bezpośrednich operacji mają przejść; Kid HTTP nadal sprawdza istniejący dispatch i te same gwarancje. Run: polecenie z kroku 2. Expected: PASS.

- [ ] **Step 4: Odchudź handlery i dostosuj testy transportu.**

Zastąp trzy handlery wywołaniem odpowiedniej fasady i istniejącym `noStore`. Usuń z obu routerów importy sześciu wyspecjalizowanych operacji oraz klasyfikatorów używanych wyłącznie przez te handlery. Zachowaj middleware autoryzacji, schematy, metody, ścieżki i pozostałe handlery. W komentarzu `parent/orpc-contract.ts` opisz wybór przez operacje serwera bez zmiany schematu Zod.

Testy routerów mockują nowe publiczne operacje. Dla obu wariantów DTO sprawdzają status 200, dokładny JSON i nagłówek `no-store`. Zachowaj testy walidacji UUID i parametrów. Dla Parent API sprawdź 401 i brak wywołania fasady przy braku autoryzacji; mapowanie `not_found` na 404 i `conflict` na 409 sprawdź przez handler HTTP. Wybór lekcja/słówka jest teraz dowodzony testem PostgreSQL, nie kopią routerowego dispatchu w mockach.

Dodaj małą kontrolę AST w `mock-test-reports.architecture.test.ts`: dozwolone zależności fasady są wymienione przy interfejsie; brak własnej `.transaction(...)`, dynamicznych importów i importu `../index`. Sprawdź czułość na zakazane importy. W rzeczywistych routerach odrzuć named import z `@learning/server` sześciu wyspecjalizowanych operacji oraz `mockTestKindOfSession`/`readDeckKind`; nowe fasady są dozwolone. Nie twórz globalnego systemu reguł importów.

Run: `corepack pnpm test:unit packages/server/src/modules/mock-test-reports.architecture.test.ts apps/web/src/orpc/kid-router.test.ts apps/web/src/orpc/parent-router.test.ts packages/contracts/src/kid-api-contract.test.ts`.
Expected: PASS. Następnie test integracyjny z kroku 2: PASS również po przejściu Kid HTTP przez fasadę.

- [ ] **Step 5: Sprawdź regresje i udokumentuj granicę.**

Dodaj wpis w `docs/folder-structure.md`: publiczne operacje raportowania kartkówek kierują do istniejących implementacji. Wyraźnie zachowaj własność transakcji po stronie obecnych operacji, zamiast opisywać te odczyty jako czyste funkcje.

Końcowy PostgreSQL z tym samym run ID: `corepack pnpm test:integration tests/integration/mock-test-report-access.test.ts tests/integration/mock-test-reporting.test.ts tests/integration/lesson-mock-tests.test.ts`.
Expected: PASS. Istniejące pliki obejmują utrwalanie raportu, wygasanie, omówienia, wyścig końca/odpowiedzi i usuwanie profilu. Uruchom końcową serię przez `task-done` jako pojedynczy finałowy przebieg, zamiast powtarzać ją dla księgowania workflow.

Następnie `corepack pnpm typecheck`, `corepack pnpm build`, `git diff --check`: exit 0. Bez potrzeby e2e przy braku zmian UI; poszerz sprawdzenia wyłącznie przy nowym ustaleniu o wpływie.

API → MCP → skill: implementacja istniejących endpointów zmienia miejsce dispatchu, lecz zachowuje kontrakt i znaczenie danych. `getLearningOverview`, kontrakty MCP oraz filtr wykluczający lekcje są nietknięte; nie regeneruj schematów ani skilla. Zapisz to uzasadnienie w raporcie wykonania. Zmiana zachowania wykryta podczas pracy wymaga osobnej propozycji, nie poprawki ukrytej w refaktoryzacji.

- [ ] **Step 6: Przejrzyj i zapisz etap lokalnie.**

Wykonaj jeden końcowy niezależny przegląd zgodnie z `executing-plans`, z naciskiem na autoryzację przed odczytem mogącym zapisywać, zachowanie ekspozycji oraz brak nowej transakcji. Sprawdź, że routery mają trzy wywołania fasady i nie zawierają już trzech przeniesionych rozgałęzień. Dodaj konkretne pliki zakresu; sugerowany commit: `refactor: move mock test report dispatch into server`.

Zachowaj gałąź/worktree. Raport końcowy: odpowiedzialności, wykonane kontrole, brak wpływu na API → MCP → skill, pozostające zależności wykonawcze i ewentualne ograniczenia dowodów. Bez push, PR i merge.

## Samodzielny przegląd planu i przekazanie

Jeden etap obejmuje trzy powiązane operacje tego samego obszaru produktu. Wszystkie nazwy i unie wyników odpowiadają istniejącym kontraktom; źródłowe operacje zachowują własne transakcje i eksporty. Review Focus ma konkretne przypadki testowe. Fasada poprawia granicę transportu, lecz nadal korzysta z adapterów Drizzle i nie daje samodzielnie przenośności backendu. Wykonanie bezpośrednie przez `superpowers:executing-plans` po przeglądzie konkretnego planu przez właściciela.
