# Etap 2: wydzielenie składania treści zadania — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uporządkować `sessions.ts` przez wydzielenie składania promptu i prywatnego klucza do funkcji domenowej, z jawną kolejnością opcji i ich identyfikatorami.

**Architecture:** Moduł nauki zachowuje koordynację sesji i istniejące transakcje. Mały adapter `materializeTask` losuje kolejność i tworzy ID, a deterministyczny `buildTaskContent` składa treść wyłącznie z przekazanych danych. Adapter obsługuje zarówno przygotowanie stałego planu treningu, jak i starsze sesje bez planu.

**Tech Stack:** TypeScript strict, Vitest, istniejące Drizzle i PostgreSQL 17; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, sekcje „Reguły i infrastruktura”, „Granice transakcji i gwarancje” oraz „Co pozostaje do planu”. Etap 1 zakończył się commitem `637daf6`; ten plan realizuje kolejny wskazany tam obszar, materializację zadania. Przed implementacją przeczytaj `AGENTS.md`, `docs/architecture.md` §9.1–9.2 i `docs/folder-structure.md` §4–5.

## Global Constraints

- „Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji, zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Czas, identyfikatory i losowość przekazujemy jawnie przy wydzielaniu zależnej od nich decyzji.”
- „Nie zmieniamy rozkładu losowania, momentu zapisu, formatu danych ani liczby wywołań providerów przy okazji porządkowania.”
- „Podział katalogów nie zmienia istniejących commitów, kolejności blokad ani faz wywołań zewnętrznych.” Słowo „commitów” oznacza tu granice zatwierdzania transakcji.
- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.” Bez pustych katalogów pięciu modułów, nowych pakietów ani frameworka generatorów.
- Zachowaj niezmienność wydanych promptów, kluczy i planów, przypięte wersje, zapis ekspozycji przed odpowiedzią oraz oddzielenie DTO od prywatnego klucza.
- Nie zmieniaj algorytmu schedulera, mechanik lekcji, schematu danych, Kid UI, endpointów ani eksportów głównego `packages/server/src/index.ts`.
- Nie wypychaj zmian, nie otwieraj PR i nie scalaj bez polecenia właściciela. Zlecenie napisania tego planu nie rozpoczyna implementacji.

## Review Focus

1. Ponowienie `next`, równoległe żądania i restart odczytują te same ID i kolejność opcji, bez nowej materializacji — krok 6.
2. Zmiana kolejności opcji zachowuje zgodność `correctOptionId`, `optionItemRevisionIds`, tekstu i wizualizacji — kroki 2 i 4.
3. Dla 0/1 opcji adapter nie pobiera losowości; dla N opcji pobiera N−1 liczb i N identyfikatorów w dotychczasowej kolejności — krok 4.
4. Publiczne warianty obrazkowe nie ujawniają odpowiedzi ani klucza; `picture_recognition` nie dostaje audio — krok 2.
5. Obie ścieżki wywołania zachowują moment przygotowania: nowy plan przy starcie, stara sesja przy wydaniu; samo przygotowanie slotu nie zapisuje ekspozycji — krok 6.

---

## Rozpoznanie i decyzje dla wykonawcy

- `modules/sessions.ts`: `PlannedItem` około linii 417, wywołania w `createTrainingSessionPlan` około 958 i w starszej ścieżce `nextTask` około 1245; `shuffled` i `materializeTask` około 978–1092.
- `modules/sessions.test.ts` importuje helper bezpośrednio. Jeden test próbuje 60 losowań; testy obrazków używają `vi.spyOn(Math, "random")`. Zastąp je kontrolowanymi wejściami i efektami.
- Nowe treningi utrwalają gotowe prompty i klucze w `training_plan` przy starcie; `nextTask` odczytuje slot. Nie przenoś losowania ze startu do wydawania slotu.
- ID opcji są dziś przypisywane przez `Map<text, id>` po tasowaniu. Zachowaj ten szczegół, włącznie z ostatnim ID dla powtarzającego się tekstu; naprawa ewentualnego duplikatu jest oddzielną zmianą.
- `buildLetterFragment` jest już deterministyczną regułą domenową; użyj jej bez zmian.
- Zachowaj dotychczasowe `TaskPrompt` jako typ wyniku. Jego type-only import nie wiąże funkcji z Next.js/oRPC; projekt nie wymaga teraz drugiego, równoległego modelu promptu.

## Zakres plików

| Operacja | Ścieżka | Odpowiedzialność |
| --- | --- | --- |
| Utwórz | `packages/server/src/domain/task-materialization.ts` | Typ materiału, przygotowane opcje i deterministyczne składanie promptu/klucza |
| Utwórz | `packages/server/src/domain/task-materialization.test.ts` | Kontrakty treści i prywatności wszystkich istniejących wariantów |
| Utwórz | `packages/server/src/domain/task-materialization.architecture.test.ts` | Ochrona funkcji przed infrastrukturą i globalną losowością |
| Zmień | `packages/server/src/modules/sessions.ts` | Mały adapter efektów, import funkcji domenowej i zgodny re-eksport typu |
| Zmień | `packages/server/src/modules/sessions.test.ts` | Deterministyczne testy tasowania, ID i zgodności adaptera |
| Zmień | `tests/integration/training-session-plan.test.ts` | Zachowanie przypiętych opcji w nowej ścieżce |
| Zmień | `tests/integration/sessions.test.ts` | Zachowanie przypiętych opcji w starszej ścieżce |
| Zmień | `docs/folder-structure.md` §4 | Lokalizacja nowej odpowiedzialności |

### Task 1: Oddzielenie składania treści od losowania i zapisu

**Files:** dokładne ścieżki z tabeli powyżej.

**Interfaces — rdzeń w `domain/task-materialization.ts`:**

```ts
import type { TaskPrompt, VisualType, MeaningVisual } from "@learning/contracts";
import type { TaskPlan, PlannedOption } from "./scheduler";

// Przenieś PlannedItem z sessions.ts z identycznymi polami i opcjonalnością.
export interface PlannedItem { /* dokładnie obecna definicja */ }
export interface IdentifiedTaskOption extends PlannedOption { readonly id: string }
export interface TaskContentInput {
  readonly plan: Pick<TaskPlan, "exerciseType" | "direction" | "pictureRecall">;
  readonly item: PlannedItem;
  readonly options: readonly IdentifiedTaskOption[];
  readonly audioAssetId: string | null;
  readonly imageAssetId: string | null;
  readonly exampleAudioAssetId: string | null;
}
export interface TaskContent {
  prompt: TaskPrompt;
  answerKey: Record<string, unknown>;
}
export function buildTaskContent(input: TaskContentInput): TaskContent;
```

Fragment przedstawia sygnatury; definicję `PlannedItem` przenieś z aktualnego kodu,
a nie z komentarza. Zachowaj `Record<string, unknown>` istniejącego prywatnego
klucza; nie zmieniaj jego formatu ani persisted JSON.

**Interfaces — adapter w `modules/sessions.ts`:**

```ts
export interface TaskMaterializationEffects {
  random(): number;           // [0, 1), jak Math.random
  createOptionId(): string;  // w produkcji randomUUID
}
export function materializeTask(
  plan: TaskPlan, item: PlannedItem,
  audioAssetId: string | null, imageAssetId: string | null,
  exampleAudioAssetId: string | null,
  effects?: TaskMaterializationEffects,
): TaskContent;
```

Zachowaj pięć dotychczasowych argumentów i dodaj opcjonalny szósty wyłącznie do
wewnętrznego helpera. Domyślne efekty wiąż przy wywołaniu, nie podczas importu.
`PlannedItem` importuj i re-eksportuj z `sessions.ts` jako typ, bez drugiej definicji.
`shuffled<T>(items: readonly T[], random: () => number): T[]` pozostaje prywatnym
pomocnikiem adaptera. Żadne nowe API nie trafia do głównego eksportu serwera.

- [ ] **Step 1: Potwierdź bazę i przygotuj środowisko.**

Sprawdź `git status --short`, `git log -1 --oneline` i bieżącą gałąź. Baza planu:
`637daf6` na `feature/task-completion-refactor`. Zachowaj cudze zmiany, użyj istniejącego
izolowanego worktree zgodnie z `superpowers:using-git-worktrees`. Jeśli HEAD się
zmienił, najpierw porównaj wskazane miejsca wywołań; nie cofaj checkoutu.
Sprawdź `Test-Path node_modules` i `.env` — przy pisaniu planu oba istnieją.
Instalacja tylko przy rzeczywistym braku zależności, przez `corepack pnpm install --prefer-offline --frozen-lockfile`;
brakujący `.env` przez `node scripts/setup-worktree.cjs --skip-install`, bez wypisywania sekretów.

Run: `corepack pnpm test:unit packages/server/src/modules/sessions.test.ts`.
Expected: PASS istniejącego, celowanego baseline. Bez pełnego monorepo/e2e na starcie.

- [ ] **Step 2: Napisz testy rdzenia i potwierdź RED.**

Utwórz `domain/task-materialization.test.ts`, importując nowe API. Użyj zwykłego
materiału Thursday/czwartek, wariantu `Thu` i jawnie podanych opcji w kolejności
Friday (`id=f`, rewizja `r2`, incorrect), Thursday (`id=t`, rewizja `r1`, correct).
Dla tekstowego listening oczekiwania muszą zawierać dosłowne wartości:

```ts
expect(result.prompt).toEqual({ kind: "listening", audioAssetId: "audio-1",
  options: [{ id: "f", text: "Friday" }, { id: "t", text: "Thursday" }] });
expect(result.answerKey).toEqual({ exerciseType: "listening", target: "Thursday",
  acceptedAnswers: ["Thu"], correctOptionId: "t", optionItemRevisionIds: { f: "r2", t: "r1" } });
```

Przenieś istniejące testy treści obrazkowej z `modules/sessions.test.ts`, zamieniając
losowanie na podaną kolejność i ID. Dodaj tabelę literalnych oczekiwań dla wszystkich
gałęzi obecnego switcha: exposure i picture_exposure; listening tekstowe, całkiem
wizualne i mieszane (mieszane nadal tekstowe); reading; reverse_recognition;
picture_recognition z fallbackiem `listeningVisual`; recall i picture_recall;
spelling; letter_completion (`Monday` → `M_n_a_`); speech i picture_speech.
Sprawdź zachowanie null mediów, przykładu, opcjonalnych `visualData` oraz `direction` w kluczu.

Testy prywatności: obrazkowe exposure/recall/speech i obrazkowe listening nie
zawierają angielskiego celu ani pól klucza; picture_recognition ma angielskie opcje,
ale nie wskazuje poprawnej i nie zawiera audio. Opcje promptu nie mają pól `correct`
ani `itemRevisionId`. Dwukrotne wykonanie na tych samych danych daje ten sam pełny
wynik; zamrożone wejścia nie są mutowane. Nie wyliczaj oczekiwań starym builderem.

Run: `corepack pnpm test:unit packages/server/src/domain/task-materialization.test.ts`.
Expected RED: brak nowego modułu/funkcji, a nie błąd środowiska.

- [ ] **Step 3: Zaimplementuj rdzeń i potwierdź GREEN.**

Przenieś definicję `PlannedItem` i switch składania treści do nowego pliku.
Używaj przekazanej kolejności i ID opcji; rdzeń niczego nie losuje i nie tworzy ID.
Zachowaj kształty promptów i kluczy, fallbacki i istniejące założenia kompletności
zatwierdzonego materiału. Jedyny import wykonywalny to `buildLetterFragment`.

Run: polecenie z kroku 2. Expected: wszystkie nowe testy PASS.

- [ ] **Step 4: Dodaj testy adaptera, zobacz RED i podłącz rdzeń.**

W `modules/sessions.test.ts` zastąp test 60 losowań trzema kontrolowanymi permutacjami:
strumienie `[0.99, 0.99]`, `[0.99, 0]`, `[0, 0.99]` dają poprawną opcję odpowiednio
na pozycji 0, 1, 2. Podaj efekty przez szósty argument, bez podmieniania globalnego Math.
Generator ID zwraca kolejno `o1`, `o2`, `o3`; wynik zachowuje mapowanie do tekstu,
wizualizacji i rewizji. Rejestr efektów ma kolejność `random, random, id, id, id`.
Dla 0 i 1 opcji oczekuj 0 wywołań random i odpowiednio 0/1 wywołań generatora ID.
Dodaj przypadek powtarzającego się tekstu: ostatnie przypisane ID pozostaje wspólne
tak jak przed zmianą. Wejściowy plan pozostaje niezmieniony.

Run: `corepack pnpm test:unit packages/server/src/modules/sessions.test.ts`.
Expected RED: obecny adapter ignoruje przekazane efekty.
Następnie zmień adapter: istniejący Fisher–Yates korzysta z `effects.random`,
dotychczasowy Map po tekście z `effects.createOptionId`, a wynik trafia do
`buildTaskContent` jako przygotowane opcje. Domyślki: `Math.random` i `randomUUID`.
Usuń lokalny switch; pozostaw oba istniejące wywołania pięcioargumentowe na miejscu.

Run: obydwa pliki testów z kroków 2 i 4 w jednym `corepack pnpm test:unit`.
Expected GREEN: PASS; brak losowo zależnych asercji.

- [ ] **Step 5: Zabezpiecz granicę rdzenia.**

Dodaj `domain/task-materialization.architecture.test.ts` według małego testu z etapu 1.
Dozwolone: runtime `./letter-fragment`, type-only `./scheduler` i `@learning/contracts`.
Test odrzuca inne importy/re-eksporty, require/dynamic import, wywołanie `Math.random`,
`crypto.randomUUID` lub globalnego `randomUUID`, `Date.now` i dostęp do `process.env`.
Odczytaj realny plik i dodaj kontrolowane próbki dozwolonych i zabronionych zależności,
w tym zabronione wywołanie wewnątrz funkcji. Nie buduj ogólnego frameworka kontroli importów.

Run: `corepack pnpm test:unit packages/server/src/domain/task-materialization.test.ts packages/server/src/domain/task-materialization.architecture.test.ts packages/server/src/modules/sessions.test.ts`.
Expected: PASS zachowania, rzeczywistej granicy i czułości skanera.

- [ ] **Step 6: Sprawdź oba miejsca wywołania na PostgreSQL.**

Rozszerz istniejące integracje, korzystając z ich fixture i helperów:
`training-session-plan.test.ts` dla zwykłego `startSession`; `sessions.test.ts` dla
`startLegacyTrainingSession` (`training_plan IS NULL`). W każdej ścieżce doprowadź
sesję do zadania wyboru z co najmniej dwiema opcjami. W stałym planie znajdź taki
slot w przypiętej liście, a poprzedzające sloty zakończ istniejącymi operacjami
complete-presentation/skip. Nie ustawiaj klucza ani planu bezpośrednio w bazie.

Zapamiętaj pełny prompt i prywatny klucz w bazie. Dwa równoległe `nextTask` oraz
odczyt po `openRestartedServices` zachowują taskId, prompt, ID i kolejność opcji
oraz niezmienny klucz; użyj `dispose` w finally dla puli restartu.
W SQL oczekuj jednego wiersza tego zadania i istniejącej zapieczętowanej ekspozycji
promptu przed odebraniem pierwszej odpowiedzi. Nie wymagaj braku kolejnych zdarzeń
przy retry, bo ponowne ujawnienie może być rejestrowane. Dla nowego planu sprawdź
również brak zadań i ekspozycji tych slotów przed pierwszym `nextTask`.

Ustaw `$env:UMIEM_TEST_RUN_ID = 'task-materialization-7be8'`; zachowaj sekwencyjne
wykonywanie plików i jeden przebieg z tym ID. Run:
`corepack pnpm test:integration tests/integration/training-session-plan.test.ts tests/integration/sessions.test.ts tests/integration/picture-vocabulary.test.ts tests/integration/attempts.test.ts`.
Expected: PASS na istniejącym PostgreSQL 17 z migracjami. Próby odpowiedzi dodatkowo
potwierdzają zgodność kluczy nowych opcji z ocenianiem. Brak Dockera oznacza brak
dowodu, nie zastępuj testów bazy mockiem lub PGlite.

- [ ] **Step 7: Udokumentuj odpowiedzialność i wykonaj kontrole końcowe.**

Dodaj w `docs/folder-structure.md` jeden wpis: `task-materialization.ts` składa
treść na podstawie gotowych opcji, a `sessions.ts` losuje i zapisuje. Potwierdź
usunięcie starej definicji `PlannedItem` i switcha z adaptera.
Run: `corepack pnpm typecheck`, `corepack pnpm build`, `git diff --check`.
Expected: exit code 0. Nie dodawaj pełnego monorepo/e2e bez nowego uzasadnienia.
Jeżeli wystąpi niezwiązany błąd, zgłoś go osobno zamiast rozszerzać zakres.

API → MCP → skill: żadnych zmian kontraktu, ponieważ format promptu, ocena,
odczyty `getLearningOverview`, autoryzacja i interpretacja raportu pozostają te same.
Nie regeneruj niezmienionych schematów ani nie aktualizuj konsumentów Hermesa.

- [ ] **Step 8: Sprawdź i zapisz kompletny etap w jednym lokalnym commicie.**

Diff ma dotyczyć wskazanych plików; zapytania, blokady i zapis sealed exposure
pozostają bez zmian. Dodaj konkretne ścieżki, nie `git add .`.
Suggested commit: `refactor: separate task content building from session effects`.
Wykonaj końcowy przegląd zmian zgodnie z wybranym sposobem wykonania. Raportuj
realne testy, wynik typecheck/build, commit i ograniczenie: koordynacja sesji
wciąż używa Drizzle, a cały moduł nauki nie został jeszcze przeniesiony.

## Przekazanie do wykonania

Rekomendacja: wykonanie bezpośrednie przez `superpowers:executing-plans`, jak w etapie 1,
z jednym końcowym przeglądem. To jeden spójny etap obejmujący builder i jego adapter.
Niniejszy dokument jest planem do przeglądu; implementacja wymaga akceptacji właściciela.
