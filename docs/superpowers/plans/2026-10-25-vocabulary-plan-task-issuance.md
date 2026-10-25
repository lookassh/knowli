# Etap 3: wydawanie zadań z planu treningu słówek — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skrócić koordynator `nextTask` przez wydzielenie kompletnej operacji wydania zadania z zapisanego planu treningu słówek.

**Architecture:** `sessions.ts` nadal otwiera transakcję, blokuje sesję, sprawdza jej cykl życia i wybiera ścieżkę wykonania. Nowy `vocabulary-plan-tasks.ts` uczestniczy w przekazanej transakcji: pomija niedostępne sloty głosowe, zapisuje zadanie, fakty umiejętności, zapieczętowaną ekspozycję i rezerwacje. Mapowanie na publiczny DTO pozostaje w koordynatorze.

**Tech Stack:** TypeScript strict, istniejące Drizzle/PostgreSQL 17, Vitest; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, sekcje „Organizacja kodu i publiczne granice”, „Reguły i infrastruktura” oraz „Granice transakcji i gwarancje”. Punkt wyjścia: `bdc73a9` na `feature/task-completion-refactor`. Dokumentacja zakresu: `AGENTS.md`, `docs/architecture.md` §9.1–9.2 i `docs/folder-structure.md` §4–5.

## Global Constraints

- „Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji, zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.”
- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Podział katalogów nie zmienia istniejących commitów, kolejności blokad ani faz wywołań zewnętrznych. Nie tworzymy event busa ani eventual consistency.” Tutaj „commity” oznaczają zatwierdzenia transakcji.
- „Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst wykonania i nie otwiera własnego niezależnego commitu.”
- Zachowaj format i niezmienność `training_plan`, promptu, klucza i kontekstu zadania; publiczne DTO nie zawiera klucza.
- Zachowaj kolejność: zapis zadania → fakty umiejętności → zapieczętowana ekspozycja → aktualizacja rezerwacji → wynik. Odpowiedź klienta wychodzi po zatwierdzeniu transakcji `nextTask`.
- Zachowaj istniejące warunki pomijania, naliczanie budżetu, obsługę wersji planu i rozróżnienie `NULL` od nieobsługiwanego planu. Nie poprawiaj przy okazji zachowania produktu.
- Nie zmieniaj schematu, endpointów, routera oRPC, `SubjectModule`, Kid UI ani głównego eksportu serwera. Nie wydzielaj teraz całego modułu nauki.
- Bez push, PR i merge. Ten dokument obejmuje plan; implementacja następuje po jego przeglądzie przez właściciela.

## Review Focus

1. Pominięte sloty głosowe zajmują ordinal i dotychczasowy budżet, ale nie tworzą prób, ocen, faktów pierwszego wydania ani ekspozycji — test tabelaryczny w kroku 2.
2. Błąd po wykonaniu pomocnika wycofuje zadanie, zdarzenie, ekspozycje, fakty/projekcje i rezerwacje w jednej transakcji — test rollback w kroku 2.
3. Dwa równoległe `next` i odczyt po restarcie zachowują ten sam prompt, klucz i ID — istniejący test etapu 2 oraz pełny przebieg kroku 6.
4. Wyzerowanie budżetu przez pominięte zadania nie wydaje kolejnego slotu, nawet jeśli jest nieocenianą prezentacją — test graniczny w kroku 2 zachowuje faktyczne zachowanie.
5. `statusAtIssue: null`, `assessmentSkills`, powód wsparcia i rezerwacje zachowują znaczenie oraz kształt JSON — test zapisu metadanych w kroku 2.

---

## Rozpoznanie i wybór granicy

`apps/web/src/orpc/kid-router.ts:172` już deleguje `next` do `nextTask` i mapuje wynik na HTTP 200/204. Nie znaleziono tam logiki wydawania zadania wymagającej przeniesienia. Wcześniejszą ogólną propozycję „oddzielenia obsługi żądań” doprecyzowujemy do rzeczywistej odpowiedzialności w kodzie.

W `packages/server/src/modules/sessions.ts:1100` gałąź `storedPlan !== null` zawiera około 60 linii zapisu i pomijania slotów. Otaczają ją odrębne ścieżki lekcji, kartkówki i starszego treningu. W lekcjach istnieje analogiczne wydzielenie `issueNextLessonPlanTask` w `modules/lessons/lesson-sessions.ts:622`; zachowujemy ten kierunek bez tworzenia wspólnego frameworka wszystkich rodzajów sesji.

Nowy pomocnik ma jednego produkcyjnego wywołującego. Nie importuje `sessions.ts`, nie odczytuje zegara ani konfiguracji, nie losuje i nie składa ponownie promptu. Jest fragmentem wykonawczym modułu nauki, więc świadomie używa Drizzle i typu `Tx`; nie przedstawiamy go jako przenośnej domeny.

## Zakres plików i interfejs

| Operacja | Plik | Odpowiedzialność |
| --- | --- | --- |
| Utwórz | `packages/server/src/modules/vocabulary-plan-tasks.ts` | Wydanie slotu słownictwa w przekazanej transakcji |
| Utwórz | `packages/server/src/modules/vocabulary-plan-tasks.architecture.test.ts` | Jednokierunkowy import i zakaz otwierania własnej transakcji |
| Zmień | `packages/server/src/modules/sessions.ts` | Zastąpienie gałęzi wywołaniem pomocnika i istniejącym mapperem DTO |
| Zmień | `tests/integration/training-session-plan.test.ts` | Testy zapisu, pomijania i rollback na prawdziwej bazie; zachowanie wcześniejszych regresji |
| Zmień | `docs/folder-structure.md` §5 | Jeden wpis opisujący nową odpowiedzialność |

### Task 1: Wydziel operację wydania slotu bez zmiany transakcji

**Interfaces — `modules/vocabulary-plan-tasks.ts`:**

```ts
import type { Tx } from "../db/client";
import { learningSessions } from "../db/schema";
import type { TrainingSessionPlanSnapshot, TrainingSessionSlot } from "../domain/training-session-plan";

export type VocabularyPlanSession = Readonly<Pick<
  typeof learningSessions.$inferSelect,
  "id" | "childId" | "deckVersionId" | "policyId" | "microphoneEnabled" | "context"
>>;
export interface IssuedVocabularyPlanSlot {
  readonly slot: TrainingSessionSlot;
  readonly assessedBefore: number;
}
export function issueNextVocabularyPlanTask(
  tx: Tx,
  session: VocabularyPlanSession,
  plan: TrainingSessionPlanSnapshot,
  now: Date,
  nextOrdinal: number,
  assessedBefore: number,
): Promise<IssuedVocabularyPlanSlot | null>;
```

Wywołujący posiada już blokadę sesji i przekazuje zwalidowany plan oraz liczniki z tej samej transakcji. `null` oznacza brak slotu do wydania, również po pominięciach. Wynik zawiera istniejący slot, nie rekord bazy ani DTO. `slot.ordinal` odpowiada indeksowi — wymusza to obecny `readTrainingSessionPlan`.

- [ ] **Step 1: Potwierdź bazę i wykonaj mały baseline.**

Sprawdź stan, gałąź i HEAD. Użyj obecnego izolowanego worktree; zachowaj niezwiązane zmiany. Przeczytaj wymienione sekcje dokumentacji i aktualną gałąź `storedPlan` w `nextTask`. Sprawdź `node_modules` oraz `.env`; przy istniejących zależnościach pomiń instalację. Brak `.env`: `node scripts/setup-worktree.cjs --skip-install`, bez drukowania sekretów.

Run: `corepack pnpm test:unit packages/server/src/modules/sessions.test.ts packages/server/src/domain/training-session-plan.test.ts`.
Expected: PASS. Nie wykonuj pełnych integracji ani e2e jako baseline.

- [ ] **Step 2: Dodaj znaczące testy nowego pomocnika na PostgreSQL.**

Rozszerz istniejący plik `training-session-plan.test.ts` i jego fixture materiału, dziecka oraz sesji. Importuj nowe API bezpośrednio z pliku serwera — nie dodawaj go do `src/index.ts`. Kontrolowane plany buduj w testach ze slotów i rzeczywistych rewizji fixture; nadaj świeże UUID, poprawne ordinale i przepuść dane przez `readTrainingSessionPlan`. Są to jawne wejścia pomocnika, nie aktualizacja utrwalonego `training_plan`. Nie wyłączaj triggerów niezmienności.

Każde bezpośrednie wywołanie działa w `services.db.transaction`: blokada profilu `FOR KEY SHARE`, następnie sesji `FOR UPDATE`, w tej samej kolejności co `lockSession`. Pobierz świeży wiersz sesji. Ustawienia mikrofonu/kontekstu dla kontrolowanego scenariusza przygotuj w tej transakcji jako fixture. Wszystkie odczyty niezatwierdzonych zapisów wykonuj przez ten sam `tx`, nie przez osobne `pool.query`.

Dodaj następujące przypadki z literalnymi oczekiwaniami:

| Nazwa testu | Wejście i oczekiwania |
| --- | --- |
| `skips unavailable voice slots without recording learning evidence` | Plan: speech ordinal 0, recall ordinal 1, listening ordinal 2; trzy oceniane sloty, budżet 3, początkowe liczniki 0/0. Dla mikrofonu wyłączonego i `canRead=false`: stany `skipped, skipped, issued`, wynik ordinal 2 i `assessedBefore=2`. Dla `canRead=true`: `skipped, issued`, wynik ordinal 1 i `assessedBefore=1`. Tylko wydany slot ma `prompt_issued`/ekspozycje; pominięte nie mają prób, ocen ani faktów pierwszego wydania. Porównaj fakty dla właściwych rewizji przed/po, nie licz dowolnych wierszy całej tabeli. |
| `honors explicitly disabled slot IDs` | Mikrofon włączony, `canRead=true`, ale ID slotu speech jest w `microphoneDisabledTaskIds`: pomiń ten slot i wydaj następny. Samo sprawdzenie `microphoneEnabled` nie wystarcza. |
| `does not issue an exposure after skips exhaust the budget` | Zwalidowany plan: speech i recall oceniane, potem exposure nieoceniane, budżet 2; mikrofon wyłączony, `canRead=false`. Wynik `null`; dwa wiersze `skipped`; brak wiersza/ekspozycji trzeciego slotu. Osobno wejście `nextOrdinal=plan.slots.length` zwraca `null` bez zapisów. |
| `persists slot metadata and reservations without rewriting the snapshot` | Jeden slot recall dla rzeczywistej rewizji, z `supportCycleId`, `skillAtIssue`, `statusAtIssue:null`, `assessmentSkills` i kontrolowanymi listami ujawnień/rezerwacji. Sprawdź dokładny `public_prompt`, `answer_key`, kontekst zadania, `first_issued_at` Recall/pisowni, kompletną listę target keys zapieczętowanego zdarzenia i nowe rezerwacje. Zachowaj inne znane pola kontekstu sesji; wejściowy plan pozostaje równy migawce sprzed wywołania. |
| `rolls back the complete issuance when the caller aborts` | Wykonaj poprzedni scenariusz i potwierdź zapisy wewnątrz `tx`, potem rzuć `Error("abort-issued-slot")`. Po odrzuceniu transakcji porównaj migawki zadania, zdarzeń, ekspozycji, postępu i kontekstu z wartościami sprzed operacji. Nic nie może zostać zatwierdzone przez pomocnika. |

Nie dodawaj mocków łańcucha Drizzle ani testów odtwarzających każdą instrukcję SQL. Test rollback steruje transakcją w kodzie testu; produkcja nie dostaje przełącznika awarii.

Run z `$env:UMIEM_TEST_RUN_ID='vocabulary-plan-issuance-7be8'`:
`corepack pnpm test:integration tests/integration/training-session-plan.test.ts`.
Expected RED: brak importowanego modułu/funkcji. Błąd środowiska nie jest oczekiwanym RED.

- [ ] **Step 3: Przenieś istniejącą operację do nowego pomocnika i potwierdź GREEN.**

Przenieś pętlę pomijania i sekwencję zapisu gałęzi `storedPlan !== null` do `issueNextVocabularyPlanTask` z powyższą sygnaturą. Użyj istniejących `contextOf`, `recordTaskSkillFacts` oraz `writeSealedEvent`. Zachowaj kolejność i warunki oryginału, w tym zwiększanie liczników po pominięciach, warunek budżetu po pętli i obecne opcjonalne pola kontekstu. Na końcu zwróć slot i licznik, zamiast budować DTO. Wszystkie zapisy korzystają wyłącznie z przekazanego `tx`.

Run: polecenie integracyjne z kroku 2. Expected: PASS nowych przypadków i wcześniejszych testów pliku.

- [ ] **Step 4: Podłącz pomocnik w `nextTask`.**

Walidacja `readTrainingSessionPlan` i mapowanie błędu na `AppError("conflict", { message: "Ta sesja wymaga nowszej wersji aplikacji." })` pozostają w tym samym miejscu. W gałęzi poprawnego planu wywołaj pomocnik z istniejącymi `tx`, `session`, `storedPlan`, `now`, `counts.total`, `counts.assessed`. Dla wyniku mapuj `slot.taskId`, `slot.ordinal`, `slot.exerciseType`, `slot.direction` i `slot.prompt` przez istniejący `issuedTaskDto`; dla `null` zwróć `null`.

Usuń przeniesioną kopię zapisu i martwe wewnętrzne `if (storedPlan === null)` w gałęzi, która już gwarantuje nie-null. Nie zmieniaj poprzedzających warunków aktywności, odczytu `issued`, obsługi oczekującej analizy mowy, limitów, lekcji i kartkówek. `training_plan IS NULL` nadal idzie do starszego planera. Builder etapu 2 i moment materializacji pozostają na swoich miejscach.

Run: `corepack pnpm test:integration tests/integration/training-session-plan.test.ts`.
Expected: PASS, w tym istniejąca regresja równoległego `next`, restartu i poprawnej odpowiedzi. Nie dodawaj drugiej kopii tej regresji.

- [ ] **Step 5: Dodaj wąską kontrolę granicy wykonawczej.**

W `vocabulary-plan-tasks.architecture.test.ts` użyj małego skanera AST TypeScript, zgodnie z dotychczasowymi kontrolami w repo. Dozwolone importy: runtime `drizzle-orm`, `../db/schema`, `./events`, `./skill-projections`; type-only `../db/client` i `../domain/training-session-plan`. Odrzuć re-eksporty modułów, importy dynamiczne i `require`. Dodatkowo odrzuć wywołanie `.transaction(...)` — pomocnik uczestniczy w transakcji wywołującego.

Sprawdź realny plik oraz próbki: type-only `Tx` dozwolony, runtime klient bazy zabroniony, import `./sessions` zabroniony, import `../config` zabroniony, wywołanie `tx.transaction(...)` wewnątrz funkcji zabronione. Test chroni jedną konkretną decyzję; nie buduj globalnego frameworka architektury.

Run: `corepack pnpm test:unit packages/server/src/modules/vocabulary-plan-tasks.architecture.test.ts packages/server/src/modules/sessions.test.ts packages/server/src/domain/training-session-plan.test.ts`.
Expected: PASS granicy, czułości skanera i istniejących testów.

- [ ] **Step 6: Sprawdź integrację i udokumentuj wynik.**

Dodaj jeden wpis w `docs/folder-structure.md`: `sessions.ts` koordynuje cykl życia, a `vocabulary-plan-tasks.ts` wydaje slot z zapisanego planu we wspólnym `Tx`.

Uruchom jeden końcowy przebieg PostgreSQL z podanym wyżej run ID, z sekwencyjnym wykonywaniem plików:

`corepack pnpm test:integration tests/integration/training-session-plan.test.ts tests/integration/sessions.test.ts tests/integration/picture-vocabulary.test.ts tests/integration/lesson-sessions.test.ts tests/integration/mock-tests.test.ts tests/integration/lesson-mock-tests.test.ts`.

Expected: PASS. Pierwsze trzy pliki obejmują dotkniętą ścieżkę, starszy trening i mikrofon; pozostałe potwierdzają zachowanie delegacji w koordynatorze. Następnie `corepack pnpm typecheck`, `corepack pnpm build`, `git diff --check` — exit code 0. E2E nie jest potrzebne przy zachowanym DTO i nietkniętym UI/HTTP. Po zielonym wyniku nie powtarzaj całych przebiegów bez nowych zmian lub ustaleń; końcowy zapis wykonania może użyć tych samych komend jako ostatniej weryfikacji zamiast osobnego powtórzenia.

API → MCP → skill: nie zmieniamy endpointów, DTO, autoryzacji, czasu/ocen ani danych raportu `getLearningOverview`. MCP i skill nie wymagają aktualizacji ani regeneracji schematów. Zapisz to uzasadnienie w raporcie wykonania.

- [ ] **Step 7: Przejrzyj i zapisz kompletny etap lokalnie.**

Sprawdź diff wobec `bdc73a9`: jeden produkcyjny caller pomocnika, brak importu wstecznego, brak nowej transakcji i brak zmian poza tabelą zakresu. Wykonaj jeden końcowy przegląd zgodnie z `executing-plans`. Uzupełnienia testów po przeglądzie mogą stanowić osobny commit.

Dodaj konkretne pliki. Suggested commit: `refactor: extract vocabulary plan task issuance`. Zostaw gałąź i istniejące worktree do dalszej pracy; bez push/PR/merge. Raportuj rzeczywiste wyniki kontroli i pozostałą zależność pomocnika od Drizzle — wydzielenie poprawia organizację wykonania, a nie przenośność tej operacji na inną bazę.

## Przegląd planu i przekazanie

Plan obejmuje jedno wydzielenie w istniejącym module nauki. Typ wyniku korzysta z obecnego `TrainingSessionSlot`; nie powstaje drugi model promptu, osobne repozytorium ani nowy punkt rozszerzania przedmiotów. Reguły z etapów 1–2, wspólne blokady i publiczny mapper pozostają w swoich odpowiedzialnościach.

Wykonanie bezpośrednie przez `superpowers:executing-plans`, jak poprzednio, z jednym końcowym przeglądem. Następne możliwe porządki — wspólny zapis zadań starszego treningu, dispatch omówień kartkówek w routerze i cykl generowania lekcji — pozostają osobnymi zakresami.
