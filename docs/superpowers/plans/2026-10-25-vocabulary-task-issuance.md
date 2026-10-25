# Etap 4: wspólny zapis wydawanego zadania słownictwa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usunąć zapis wydawanego zadania ze starszej ścieżki `nextTask` i utrzymywać jedną operację zapisu wspólną z przypiętym planem słówek.

**Architecture:** `sessions.ts` zachowuje koordynację, starszy planer i materializację. `vocabulary-plan-tasks.ts` zachowuje wybór i pomijanie slotów. Obie ścieżki przekazują gotowy snapshot do `vocabulary-task-issuance.ts`, który zapisuje zadanie, fakty umiejętności, zapieczętowane ekspozycje i rezerwacje w przekazanym `Tx`. Blokada, transakcja i publiczny DTO pozostają odpowiedzialnością `nextTask`.

**Tech Stack:** TypeScript strict, obecne Drizzle/PostgreSQL 17, pnpm i Vitest; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, sekcje „Organizacja kodu i publiczne granice”, „Reguły i infrastruktura” oraz „Granice transakcji i gwarancje”; `AGENTS.md`; `docs/architecture.md` §9.1–9.2; `docs/folder-structure.md` §5. Stan rozpoznania: `a502b42`, gałąź `feature/task-completion-refactor`.

## Global Constraints

- „Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji, zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.”
- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst wykonania i nie otwiera własnego niezależnego commitu.”
- Zachowaj kolejność: zadanie → fakty umiejętności → zapieczętowane zdarzenie i projekcje ekspozycji → rezerwacje → wynik koordynatora po commit.
- Nie zmieniaj zachowania, schematu, kontraktów, `SubjectModule`, routerów, klientów, planowania ani obsługi zakończenia sesji. Nie dodawaj eksportu w głównym `packages/server/src/index.ts`.
- `training_plan IS NULL` pozostaje starszą ścieżką. Pomijanie slotów i budżet przypiętego planu pozostają w `vocabulary-plan-tasks.ts`; pominięte sloty nie przechodzą przez wspólny zapis wydania.
- Nie dodawaj drugiego planera, repozytorium dla tabeli ani uniwersalnego mechanizmu zapisu wszystkich rodzajów sesji. Zakres dotyczy wyłącznie treningu słownictwa.
- Bez push, PR i merge; implementacja następuje po przeglądzie tego planu przez właściciela.

## Review Focus

1. Rollback musi cofać również aktualizacje istniejących projekcji, a nie tylko nowe wiersze — porównanie pełnych rekordów w kroku 2.
2. Zapis ekspozycji obejmuje wszystkie ujawnione cele, ich deduplikację i projekcję `child_target_exposures` — przypadek z dwoma kluczami i duplikatem w kroku 2.
3. Metadane wsparcia zachowują różnicę między `statusAtIssue: null` i brakiem pola — dwa warianty asercji w kroku 2.
4. Starsza sesja po równoległym `next` i restarcie zachowuje opcje, klucz i poprawne ocenianie — istniejący test w `sessions.test.ts`, uruchamiany w kroku 5.
5. Pominięte sloty nie zaczynają emitować faktów ani ekspozycji po wspólnym wydzieleniu — istniejące przypadki etapu 3 w `training-session-plan.test.ts`, uruchamiane w krokach 3–5.

---

## Rozpoznanie i wybór zakresu

W `sessions.ts`, po obsłudze `storedPlan`, starsza ścieżka wykonuje `planNextTask`, `materializeTask`, `randomUUID`, a następnie około 50 linii zapisu. Sekwencja zapisu odpowiada wydawaniu poprawnego slotu w `vocabulary-plan-tasks.ts`; różnią się źródła gotowych wartości. Wspólne wydzielenie usuwa tę rzeczywistą duplikację i skraca koordynator.

Nie przenosimy teraz dużego `planNextTask` ani nie dokładamy pliku będącego drugą kopią writera tylko dla starszej sesji. Dobór ćwiczenia, losowanie opcji i utworzenie task ID zachowują obecne miejsca oraz kolejność. Nowa funkcja ma dwa produkcyjne miejsca wywołania i otrzymuje gotowy snapshot. Nadal jest adapterem wykonawczym zależnym od Drizzle.

## Pliki i interfejs

| Operacja | Plik | Odpowiedzialność |
| --- | --- | --- |
| Utwórz | `packages/server/src/modules/vocabulary-task-issuance.ts` | Jeden zapis kompletnego wydania zadania w przekazanym Tx |
| Utwórz | `packages/server/src/modules/vocabulary-task-issuance.architecture.test.ts` | Kontrola importów i zakaz otwierania własnej transakcji |
| Zmień | `packages/server/src/modules/sessions.ts` | Delegacja starszego zapisu po dotychczasowej materializacji |
| Zmień | `packages/server/src/modules/vocabulary-plan-tasks.ts` | Delegacja wydania slotu; zachowanie pętli pomijania |
| Zmień | `packages/server/src/modules/vocabulary-plan-tasks.architecture.test.ts` | Dopuszczenie nowego writera i usunięcie niepotrzebnych zależności |
| Zmień | `tests/integration/training-session-plan.test.ts` | Dokładne asercje metadanych, ekspozycji i rollbacku istniejących projekcji |
| Zmień | `docs/folder-structure.md` | Odpowiedzialności trzech współpracujących plików |

```ts
// modules/vocabulary-task-issuance.ts
import type { Tx } from "../db/client";
import type { learningSessions } from "../db/schema";
import type { TrainingSessionSlot } from "../domain/training-session-plan";

export type VocabularyTaskSession = Readonly<Pick<
  typeof learningSessions.$inferSelect,
  "id" | "childId" | "deckVersionId" | "policyId" | "context"
>>;
export type VocabularyTaskSnapshot = Readonly<Omit<TrainingSessionSlot, "assessed">>;

export function issueVocabularyTask(
  tx: Tx,
  session: VocabularyTaskSession,
  task: VocabularyTaskSnapshot,
  now: Date,
): Promise<void>;
```

Snapshot wykorzystuje istniejący kształt gotowego zadania. Flaga `assessed` należy do planowania/budżetu i nie jest potrzebna writerowi. Przekazanie istniejącego slotu jest dozwolone strukturalnie. W starszej ścieżce snapshot składa się z `TaskPlan`, `item.itemId`, nowego task ID, `counts.total` i wyniku materializacji; `direction` nadal normalizuje się przez `?? null`.

`VocabularyPlanSession` zachowuje nazwę i dotychczasowy kształt, korzystając z `VocabularyTaskSession` oraz pola `microphoneEnabled`. Writer nie zwraca DTO, nie losuje, nie pobiera czasu, nie przyjmuje `Services` i nie próbuje zapewnić idempotencji poza istniejącym koordynatorem/blokadą.

### Task 1: Wydziel wspólną operację zapisu i podłącz obie ścieżki

- [ ] **Step 1: Potwierdź stan i wykonaj mały baseline.**

Sprawdź gałąź, HEAD, zmiany użytkownika, `node_modules`, `.env` oraz aktualne skrypty. Użyj obecnego worktree. Przeczytaj wskazane sekcje dokumentów i obie sekwencje zapisu. Pomijaj instalację przy istniejących zależnościach; brak `.env` uzupełnij przez `node scripts/setup-worktree.cjs --skip-install`, bez ujawniania wartości.

Run: `corepack pnpm test:unit packages/server/src/modules/sessions.test.ts packages/server/src/modules/vocabulary-plan-tasks.architecture.test.ts`.
Expected: PASS. Bez pełnego baseline monorepo ani e2e.

- [ ] **Step 2: Wzmocnij testy faktycznej granicy zapisu przed przeniesieniem kodu.**

Rozbuduj istniejące testy w `training-session-plan.test.ts`; wykorzystaj fixture i jawne plany oparte na rzeczywistych rewizjach. Nie zmieniaj utrwalonego `training_plan` i nie dodawaj nowych obejść triggerów. Sprawdzenia niezatwierdzonych zapisów wykonuj przez `tx`.

Dodaj lub uściślij następujące asercje:

- Wydany recall ma dokładnie oczekiwany prompt, klucz i kontekst: `{ reason, supportCycleId, skillAtIssue, statusAtIssue: null, assessmentSkills }`. Drugi wariant bez opcjonalnych pól nie zapisuje ich jako `null` ani pustych tablic. Oba przypadki zachowują wejściowy snapshot.
- Dla `revealsTargetKeys: [keyA, keyB, keyA]` jest jedno zdarzenie `prompt_issued`, `sealed=true`, step ID `${taskId}:prompt`, dokładnie dwa wiersze `event_exposures` oraz odpowiednie rekordy `child_target_exposures` z kontrolowanym czasem. Użyj prawidłowych kluczy z `computeTargetKey` i faktycznych celów fixture.
- Fakty wydania obejmują dokładnie recall i spelling dla rewizji i przypiętej polityki. Porównuj `skill_version_id`, `policy_id` oraz `first_issued_at`, zamiast samego `count > 0`.
- Przy zmianie rezerwacji zachowane zostają znane pola kontekstu: `canRead`, `timezone`, `previousContact` i `settledChecks`. Sprawdź też wariant identycznych rezerwacji; wynik danych musi pozostać identyczny.
- Rollback: przygotuj wcześniejsze rekordy `child_skill_progress` i `child_target_exposures`, których timestampy writer faktycznie zmieni. Zrób migawki ich pełnych wartości i kontekstu. W transakcji po wydaniu potwierdź nowe zadanie, zapieczętowane zdarzenie, oba ujawnienia, zmienione timestampy i rezerwacje; dopiero potem rzuć `Error("abort-issued-slot")`. Po rollbacku: brak nowego zadania/zdarzeń/ujawnień, a istniejące projekcje i kontekst dokładnie równe migawkom. Nie wywołuj `endSession` między rollbackiem a tym porównaniem.

Run z `$env:UMIEM_TEST_RUN_ID='vocabulary-task-issuance-7be8'`: `corepack pnpm test:integration tests/integration/training-session-plan.test.ts`.
Expected: PASS na obecnej implementacji — są to testy charakteryzujące zachowywane działanie. Nie wymagaj sztucznego błędu reguł, których nie zmieniamy.

- [ ] **Step 3: Dodaj kontrolę granicy, obejrzyj RED i wydziel writer.**

Nowy test AST czyta `vocabulary-task-issuance.ts`. Dozwolone runtime: `drizzle-orm`, `../db/schema`, `./events`, `./skill-projections`; type-only: `../db/client`, `../domain/training-session-plan`. Odrzuć re-eksporty modułów, `require`, import dynamiczny i wywołania `.transaction(...)`. Sprawdź czułość na import `./sessions`, runtime klient bazy oraz transakcję wewnątrz funkcji; osobno potwierdź, że sam import type-only Tx jest dozwolony.

Run: `corepack pnpm test:unit packages/server/src/modules/vocabulary-task-issuance.architecture.test.ts`.
Expected RED: brak nowego pliku, a nie błąd środowiska. Następnie utwórz writer o podanym interfejsie, przenosząc istniejący zapis poprawnego slotu. Zachowaj opcjonalne metadane i dotychczasowe helpery projekcji/zdarzeń. Listy readonly kopiuj przy zapisie; nie modyfikuj wejścia.

Run: to samo polecenie jednostkowe oraz test integracyjny z kroku 2. Expected: PASS. Sam writer nie otwiera transakcji ani nie dokonuje własnego commitu.

- [ ] **Step 4: Podłącz istniejące ścieżki i usuń kopie zapisu.**

W `vocabulary-plan-tasks.ts` zastąp wyłącznie zapis wydawanego slotu wywołaniem `issueVocabularyTask`. Pozostaw dotychczasowy zapis `skipped`, warunki pętli, liczniki i warunek budżetu. Zwracaj ten sam slot i licznik. Zaktualizuj jego kontrolę importów: dopuść writer runtime i jego typ sesji type-only; usuń `./skill-projections`, które przestaje być potrzebne. Zachowaj używane `contextOf`, schemat oraz typy planu.

W starszej gałęzi `sessions.ts` pozostaw `planNextTask`, obsługę `null`, `materializeTask` i generowanie ID w dotychczasowej kolejności. Złóż snapshot i wywołaj writer. Zachowaj istniejące `issuedTaskDto(..., counts.assessed)`. Usuń przeniesioną kopię zapisu i wyłącznie importy rzeczywiście nieużywane — np. `writeSealedEvent` nadal ma innych odbiorców w tym pliku.

Run: test jednostkowy z kroku 1 wraz z nowym testem architektury; test integracyjny z kroku 2. Expected: PASS. Diff pokazuje dwa produkcyjne wywołania wspólnego writera i jeden punkt zapisu wydania, bez importu writera do domeny/transportu.

- [ ] **Step 5: Sprawdź regresje i opisz granicę.**

Zaktualizuj `docs/folder-structure.md`: koordynator/starszy planer → obsługa przypiętych slotów → wspólny zapis wydania. Udokumentuj, że writer pozostaje zależny od Drizzle i PostgreSQL.

Końcowy PostgreSQL, z tym samym run ID: `corepack pnpm test:integration tests/integration/training-session-plan.test.ts tests/integration/sessions.test.ts tests/integration/picture-vocabulary.test.ts`. Pliki uruchamiają się sekwencyjnie przez istniejące `fileParallelism: false`. Obejmują nową i starszą ścieżkę, równoległe next/restart/poprawną ocenę oraz mikrofon i ćwiczenia obrazkowe. Expected: PASS. Pozostałe ścieżki lekcji/kartkówek nie są zmieniane; poszerz zestaw tylko przy ustaleniu realnego wpływu.

Następnie `corepack pnpm typecheck`, `corepack pnpm build`, `git diff --check`. Expected: exit 0. Końcowy przebieg przewidziany przez `task-done` wykorzystaj jako ten sam finałowy test integracyjny; nie powtarzaj zielonych serii wyłącznie dla księgowania workflow. E2E nie jest wymagane przy nietkniętym UI i zachowanym HTTP/DTO.

API → MCP → skill: endpointy, DTO, uprawnienia i semantyka raportowania pozostają te same; nie ma potrzeby regeneracji schematów ani aktualizacji skilla. Zapisz to uzasadnienie w raporcie wykonania.

- [ ] **Step 6: Przejrzyj i zapisz etap lokalnie.**

Jeden końcowy przegląd zgodnie z `executing-plans`: zgodność obu mapowań snapshotu, kolejność zapisu, brak własnej transakcji oraz pełny rollback aktualizowanych projekcji. Po poprawkach ponawiaj tylko sprawdzenia uzasadnione zmianą.

Dodaj konkretne pliki z tabeli zakresu. Suggested commit: `refactor: share vocabulary task issuance`. Zostaw worktree i gałąź do dalszej pracy. Raport: korzyść organizacyjna, rzeczywiste sprawdzenia, pozostała zależność od Drizzle oraz brak wpływu na API → MCP → skill. Bez publikacji zmian.

## Samodzielny przegląd planu

Zakres obejmuje jedną operację produktu, wspólną dla dwóch istniejących ścieżek. Typ snapshotu pochodzi z istniejącego modelu; funkcja nie przejmuje planowania, idempotencji ani mapowania DTO. Każdy punkt Review Focus ma test nowy lub istniejący. Nie dochodzą pakiety, porty providerów ani zmiany schematu. Wykonanie bezpośrednie przez `superpowers:executing-plans`, z jednym końcowym przeglądem, po akceptacji konkretnego planu.
