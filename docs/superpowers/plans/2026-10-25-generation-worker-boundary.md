# Etap 6: granica koordynacji generowania — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Oddzielić wybór i uruchamianie pracy workera od wykonania generacji oraz usunąć bezpośredni cykl `generation.ts` ↔ `lessons/lesson-drafts.ts`.

**Architecture:** Przenieść istniejący poller do `modules/generation-worker.ts`, obok czystego `worker-schedule.ts`. Koordynator korzysta z wykonawców słówek, lekcji i mediów; wykonawcy nie importują koordynatora. Publiczne eksporty `@learning/server` zachowują nazwy i sygnatury, a istniejące operacje zachowują własne granice transakcji.

**Tech Stack:** Obecne TypeScript, Drizzle, PostgreSQL 17, Vitest oraz proces worker. Bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, szczególnie organizacja kodu, granice transakcji i wskazany cykl generowania; `AGENTS.md`; `docs/architecture.md` §7–8 oraz §19 (retry generowania lekcji); `docs/folder-structure.md` §5. Rozpoznany HEAD: `5e5aa65`, branch `feature/task-completion-refactor`.

## Global Constraints

- „Głównym celem jest ładnie zorganizowany, czytelny kod: łatwe odnalezienie funkcji, zrozumienie jej odpowiedzialności i bezpieczna zmiana przez człowieka lub agenta.”
- „Nowy plik lub port ma wynikać z konkretnej odpowiedzialności w kodzie.”
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Pomocnik współpracujący w istniejącej transakcji otrzymuje ten sam kontekst wykonania i nie otwiera własnego niezależnego commitu.”
- Zachowaj idempotencję, trzy automatyczne próby, CAS/lease mediów, niezmienność gotowych zasobów i blokady wersji. Poller nie otwiera wspólnej transakcji dla wielu zadań ani transakcji przez wywołanie providera.
- Zachowaj `nextAttemptAt`, klucze prób, limity, rotację kolejności oraz zachowanie anulowania i `onProgress`.
- Bez zmian schematu, DTO, HTTP/oRPC, MCP, `SubjectModule`, UI, providerów ani konfiguracji wdrożenia. Bez push, PR i merge.

## Review Focus

1. Wolny deck nie blokuje lekcji i wolny slot przyjmuje nową pracę — istniejące testy `generation.test.ts` i `worker-schedule.test.ts` w zadaniu 2.
2. Run lekcji odroczony przez `nextAttemptAt` pozostaje niewykonany przed terminem — istniejący test integracyjny lekcji w zadaniu 2.
3. Lease oraz identyfikator próby nadal chronią przed ponownym uruchomieniem lub zapisem starego workera — istniejące testy generowania, mediów i lekcji w zadaniu 2.
4. Limity wyłączające kolejki oraz anulowanie przed startem nie wywołują providerów ani nie zmieniają rekordów — dwa testy charakterystyki w zadaniu 1.
5. Reeksport przez stary plik nie odtwarza cyklu; importy pod aliasem lub w pojedynczych cudzysłowach nie omijają kontroli — test architektoniczny w zadaniu 1.

---

## Rozpoznanie i uzasadnienie zakresu

`generation.ts` zawiera zlecanie/odczyt/retry runów, wykonanie decków i mediów oraz `runDueGenerationWork` (od okolic linii 645). Tylko koordynacja potrzebuje `executeLessonGeneration`. Jednocześnie `lesson-drafts.ts` importuje z `generation.ts` pięć istniejących pomocników: `MAX_AUTOMATIC_ATTEMPTS`, `claimQueuedRun`, `enqueueGenerationRun`, `requireGeneration`, `supersedeLessonRuns`. Powstaje bezpośredni cykl.

Wydzielenie koordynatora usuwa krawędź `generation.ts` → `lesson-drafts.ts` bez przenoszenia tych pomocników do nowej warstwy. `worker-schedule.ts` już oddziela reguły rotacji i zajmowania slotów od odczytu bazy; zachowujemy tę dobrą granicę. Ten etap nie wymaga rozdzielania całego pozostałego `generation.ts`.

Docelowe zależności:

```text
apps/worker → @learning/server → generation-worker
generation-worker → generation, lessons/lesson-drafts, worker-schedule
lessons/lesson-drafts → generation (dotychczasowe pomocniki)
generation ↛ generation-worker, lessons/lesson-drafts
```

To usunięcie konkretnego bezpośredniego cyklu. Kontrola nie deklaruje braku wszystkich pośrednich cykli całego pakietu.

## Pliki i odpowiedzialności

| Operacja | Plik | Zakres |
| --- | --- | --- |
| Utwórz | `packages/server/src/modules/generation-worker.ts` | `WorkerLimits`, `runDueGenerationWork`, prywatny `workerScheduleCursor`; wybór SQL i delegowanie zadań |
| Zmień | `packages/server/src/modules/generation.ts` | Usuń przeniesiony blok i nieużywane importy; zostaw istniejące operacje i pomocniki |
| Zmień | `packages/server/src/index.ts` | Eksportuj poller i typ limitów z nowego pliku; pozostałe eksporty pozostają z `generation.ts` |
| Utwórz | `packages/server/src/modules/generation-worker.architecture.test.ts` | Wąska kontrola kierunku importów i braku reeksportu koordynatora przez wykonawców |
| Zmień | `tests/integration/generation.test.ts` | Dwie brakujące charakterystyki pollera |
| Zmień | `docs/folder-structure.md` | Rozróżnij koordynację kolejki, algorytm slotów i wykonanie generacji |

`apps/worker/src/tasks.ts` nadal importuje z `@learning/server`; nie wymaga zmiany. `lesson-drafts.ts` nadal używa dotychczasowych pomocników. Wewnętrzny plik `modules/generation.ts` nie będzie reeksportował pollera — odtworzyłoby to zależność zwrotną. W rozpoznaniu nie znaleziono konsumentów importujących poller bezpośrednio z tego pliku; przed zmianą potwierdź to wyszukiwaniem.

## Task 1: Wydziel koordynację workera i zabezpiecz kierunek zależności

**Interfaces:**

Przenieś bez zmiany sygnatur:

```ts
export interface WorkerLimits {
  total?: number;
  deck?: number;
  lesson?: number;
  tts?: number;
  images?: number;
}

export async function runDueGenerationWork(
  services: Services,
  limits: WorkerLimits = {},
  options: { signal?: AbortSignal; onProgress?: () => void } = {},
): Promise<{ processed: number }>;
```

Koordynator konsumuje istniejące `executeGeneration`, `executeMediaAsset`, `requireGeneration`, `errorCodeOf` z `./generation`, `executeLessonGeneration` z `./lessons/lesson-drafts` i funkcje/typy `./worker-schedule`. SQL nadal korzysta z `generationRuns` i `mediaAssets`; to warstwa wykonawcza związana z Drizzle.

- [x] **Step 1: Potwierdź stan i wykonaj mały baseline.** Sprawdź `git status`, HEAD, importy pollera, aktualne skrypty, obecność `.env` i `node_modules`. Zachowaj niezwiązane zmiany i użyj obecnego worktree. Przy istniejących zależnościach pomiń instalację. Brak `.env` uzupełnij przez `node scripts/setup-worktree.cjs --skip-install`, bez drukowania wartości. Przeczytaj wskazane fragmenty specyfikacji i dokumentacji.

Run: `corepack pnpm test:unit packages/server/src/modules/worker-schedule.test.ts apps/worker/src/tasks.test.ts`.
Expected: PASS.

- [x] **Step 2: Utrwal dwa zachowania w istniejącym `tests/integration/generation.test.ts`.** Wykorzystaj `fakeGeneration`, `generationServices`, `COMMAND`, `createLesson` i dotychczasowe sprzątanie. Pierwszy test: zleć deck i lekcję, wywołaj `runDueGenerationWork(services, { deck: 0, lesson: 0, tts: 0, images: 0 })`; wynik to `{ processed: 0 }`, oba runy nadal `queued`, `attempts = 0`, brak wywołań generowania decka/lekcji. Drugi: zleć deck, przerwij `AbortController` przed wywołaniem i przekaż sygnał; te same oczekiwania dla decka oraz brak wywołania `onProgress`. Nie używaj prawdziwych providerów. Testy charakterystyki mają przejść jeszcze przed przeniesieniem kodu.

Run w PowerShell po ustawieniu `$env:UMIEM_TEST_RUN_ID='generation-boundary-7be8'`: `corepack pnpm test:integration tests/integration/generation.test.ts`.
Expected: PASS na rzeczywistym PostgreSQL 17 uruchamianym przez istniejący global setup. Błąd Dockera nie jest dowodem regresji.

- [x] **Step 3: Dodaj kontrolę architektury i obejrzyj RED.** Użyj TypeScript AST, `StringLiteralLike.text` i rozwiązania lokalnych ścieżek względem pliku. Sprawdzaj importy, reeksporty, literalne `import()` i `require()`. Odrzucaj powrót z `generation.ts` do `generation-worker.ts` lub `lessons/lesson-drafts.ts`, a z `lesson-drafts.ts` do koordynatora. Wymagaj, by `runDueGenerationWork` i `WorkerLimits` były eksportowane przez `src/index.ts` z nowego pliku; rozpoznawaj oryginalne nazwy eksportów przy aliasach. Sprawdź próbki z pojedynczymi/podwójnymi cudzysłowami, aliasem, reeksportem i dynamicznym importem. Kontrola dotyczy tych plików, bez globalnego frameworka analizy zależności.

Run: `corepack pnpm test:unit packages/server/src/modules/generation-worker.architecture.test.ts`.
Expected RED: obecny import `executeLessonGeneration` w `generation.ts` i brak eksportu z nowego koordynatora.

- [x] **Step 4: Przenieś blok i przepnij eksport.** Przenieś `WorkerLimits`, całe `runDueGenerationWork` i jedyny prywatny `workerScheduleCursor` do nowego pliku. Zachowaj SQL, predykaty, kolejność, domyślne limity `2/2/2/1`, limit łączny `2`, klucze prób, sygnał, obsługę błędu i callback. Nie resetuj kursora przy każdym wywołaniu i nie twórz drugiej jego kopii. Usuń nieużywane importy ze starego pliku, przepnij `src/index.ts`. Popraw przeniesiony komentarz: wybór jest rotacyjny, a nie zawsze deck → lesson → TTS → image.

- [x] **Step 5: Sprawdź wynik i zapisz odpowiedzialności.** Uruchom celowane testy jednostkowe z kroków 1 i 3 oraz integracyjne z kroku 2; oczekuj PASS. Dodaj w `docs/folder-structure.md` wpis koordynatora i doprecyzuj opis `generation.ts` oraz `worker-schedule.ts`. Obejrzyj diff pod kątem czystego przeniesienia i zachowania transakcji wykonawców.

## Task 2: Sprawdź zachowanie całej granicy i zakończ etap

**Interfaces:** Publiczne `@learning/server.runDueGenerationWork` i `WorkerLimits` z zadania 1; dotychczasowe operacje wykonawcze i fixture pozostają dostępne.

- [x] **Step 1: Uruchom odpowiednie istniejące regresje.**

```powershell
corepack pnpm test:unit packages/server/src/modules/generation-worker.architecture.test.ts packages/server/src/modules/worker-schedule.test.ts apps/worker/src/tasks.test.ts packages/server/src/domain/lessons/architecture.test.ts
$env:UMIEM_TEST_RUN_ID='generation-boundary-7be8'
corepack pnpm test:integration tests/integration/generation.test.ts tests/integration/lesson-generation.test.ts tests/integration/media.test.ts tests/integration/grammar-without-tts.test.ts
```

Expected: PASS. Istniejące testy pokrywają restart, retry do trzech prób, stary `edit_number`, powolny deck obok lekcji, odzyskiwanie slotów, `nextAttemptAt`, spóźniony worker i brak TTS dla gramatyki. Nie dopisuj testów dublujących te przypadki. Jeżeli któryś rzeczywisty predykat/wywołanie musiał się zmienić, wyjaśnij przyczynę i uzupełnij właściwy test przed uznaniem zmiany za refaktoryzację.

- [x] **Step 2: Sprawdź typy i build.** Run: `corepack pnpm typecheck`, następnie `corepack pnpm build`, następnie `git diff --check`. Expected: wszystkie kończą się kodem 0. Pełny e2e nie jest wymagany dla samego przeniesienia pollera bez zmian klientów i transportu.

- [x] **Step 3: Sprawdź wpływ API → MCP → skill i oceń diff.** Potwierdź brak zmian kontraktów, tras, autoryzacji i znaczenia raportów; `getLearningOverview` i wyłączenie lekcji w MCP pozostają poza zakresem. Zapisz to uzasadnienie w raporcie. Sprawdź brak nowych transakcji, nowych wywołań providerów, kopiowania algorytmu schedulera oraz importu koordynatora przez wykonawców. Podaj rzeczywiste wyniki kontroli i ewentualne braki środowiska.

- [x] **Step 4: Utwórz lokalny commit wyłącznie plików tego etapu.** Po przejściu kontroli użyj jawnych ścieżek w `git add`, następnie `git commit -m "refactor: separate generation worker coordination"`. Bez push, PR i merge. W raporcie podaj commit, usunięty cykl, lokalizację koordynacji i testy.

## Kryterium zakończenia i ograniczenia

Kod wywołujący poller nadal korzysta z tego samego publicznego API. `generation.ts` nie importuje już wykonawcy lekcji ani koordynatora, a logika wyboru pracy ma jeden nazwany plik. Istniejące gwarancje bazy pozostają u dotychczasowych wykonawców i przechodzą wskazane testy PostgreSQL.

Reguły `worker-schedule.ts` pozostają niezależne od bazy. Nowy koordynator i istniejący wykonawcy nadal zależą od Drizzle, `Services`, zapytań PostgreSQL, transakcji oraz portów providerów — zmiana bazy wymagałaby przepisania tej infrastruktury. Etap nie oznacza pełnej przenośności ani ukończenia całej modularizacji.

Ewentualny późniejszy podział wykonania mediów i generowania słówek wymaga osobnego uzasadnienia po ocenie tego etapu; nie należy do tej implementacji.

## Wynik implementacji — 2026-10-25

- Wydzielono koordynację do `generation-worker.ts`; usunięto bezpośredni cykl z `lesson-drafts.ts` i zachowano publiczne eksporty `@learning/server`.
- Ciało `runDueGenerationWork` i prywatny kursor porównano z `5e5aa65`: identyczne. Transakcje, lease, retry i wywołania providerów pozostały u istniejących wykonawców.
- Przed przeniesieniem: 9 testów bazowych i 15 testów charakterystyki PostgreSQL PASS. Kontrola architektury RED: dwa oczekiwane błędy (zależność wsteczna i eksport ze starego pliku), pozostałe 10 przypadków PASS.
- Po przeniesieniu: 23/23 testy jednostkowe oraz 64/64 integracyjne na PostgreSQL 17 PASS, w plikach wskazanych w zadaniu 2. `corepack pnpm typecheck`, `corepack pnpm build` i `git diff --check`: kod 0. Nie uruchamiano e2e ani prawdziwych providerów.
- API → MCP → skill: brak zmian kontraktów, tras, autoryzacji oraz znaczenia danych. `getLearningOverview`, filtr lekcji i skill nie wymagają aktualizacji ani regenerowania schematu.
- Weryfikację po przeniesieniu połączono z pełnym zestawem czterech wskazanych plików integracyjnych, aby uniknąć powtórnego identycznego przebiegu PostgreSQL. Początkową literówkę nazwy metody spy poprawiono na istniejące `generateLessonPool` przed udanym baseline charakterystyki.
- Koordynator pozostaje związany z Drizzle i PostgreSQL. Nie dodano portów ani nowej hierarchii modułów.
