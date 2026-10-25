# Wydzielenie reguły zakończenia zadania — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uporządkować decyzję o stanie zadania po próbie w jednej czystej funkcji, zachowując zachowanie treningu, kartkówek i istniejących klientów.

**Architecture:** Pierwszy etap porządkowania modułu nauki: wydzielenie reguły z `modules/attempts.ts` do istniejącego `domain/`, bez tworzenia pustej hierarchii modułów. Przypadek użycia nadal odczytuje dane i zapisuje wynik w dotychczasowej transakcji; reguła otrzymuje wyłącznie zwykłe dane domenowe. Testy jednostkowe określają decyzje, a istniejące testy PostgreSQL chronią włączenie reguły, atomowość i współbieżność.

**Tech Stack:** TypeScript strict, Vitest, istniejące Drizzle/PostgreSQL 17 w testach integracyjnych; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-24-modular-monolith-design.md`, szczególnie „Kandydat na pierwszy zakres implementacyjny”. Przeczytaj również `AGENTS.md`, `docs/architecture.md` §9–11 oraz `docs/SPEC.md` §15–16.

## Global Constraints

- „Właściciel wybrał stopniowe porządkowanie obszarami produktu.” To pierwszy kompletny etap, a nie przebudowa pięciu modułów naraz.
- „Zachowujemy Next.js, React, TypeScript, PostgreSQL, Drizzle, oRPC, obecne procesy web/worker oraz pakiety.”
- „Podział katalogów nie zmienia istniejących commitów, kolejności blokad ani faz wywołań zewnętrznych.”
- „Nie tworzymy event busa ani eventual consistency.”
- „Czyste reguły nie przyjmują ich ani rekordów `$inferSelect`.” Dotyczy `Services`, `Tx` i rekordów ORM.
- „Pierwszy zakres ma zachować publiczne kontrakty, schemat i wywołujących.” Nie zmieniaj DTO, endpointów, migracji, oceniania, ekspozycji ani liczby wywołań providerów.
- „Ten zakres nie obejmuje przebudowy lekcji, losowania promptów, modeli bazy, routerów, rozliczeń aktywności ani zmiany dotychczasowych progów i zachowania.”
- „Zachowujemy ponadto krótkotrwałe przetwarzanie nagrań w pamięci, brak odpowiedzi dziecka i sekretów w diagnostyce oraz oddzielenie publicznych DTO od rekordów bazy.”
- Nie zmieniaj `SubjectModule`, Kid UI, publicznego `packages/server/src/index.ts` ani zależności pakietów. Nie wypychaj zmian, nie twórz PR i nie scalaj bez polecenia właściciela.

## Review Focus

1. Brak ocen lub same `unevaluated` nie zamykają treningu, również przy `attemptNumber=2`; testy tabelaryczne w kroku 2.
2. Mieszanka `correct` i `incorrect` nie zamyka treningu po pierwszym błędzie; jedna próba z kilkoma błędnymi ocenami nie staje się dwiema próbami; kroki 2 i 5.
3. `speechContentMatched=false` oznacza obecność wyniku ćwiczenia mowy, a brak pola jego nieobecność; druga próba mowy i zwykły techniczny brak oceny zachowują różne decyzje; kroki 2 i 5.
4. Kartkówka kończy każdą finalizowaną próbę jako `answered`, także nieocenioną; `skip` zawsze daje `skipped`; kroki 2 i 5.
5. Historyczne próby techniczne zwiększają `attemptNumber`, ale nie liczbę błędnych prób; przejście do wsparcia zależy od różnych błędnych prób, a nie od liczby ocen umiejętności; kroki 2 i 5.

---

## Zakres plików

| Operacja | Plik | Odpowiedzialność |
| --- | --- | --- |
| Utwórz | `packages/server/src/domain/task-completion.ts` | Typy wejścia/wyjścia i reguła stanu po próbie |
| Utwórz | `packages/server/src/domain/task-completion.test.ts` | Tabela przypadków rzeczywistego zachowania |
| Utwórz | `packages/server/src/domain/task-completion.architecture.test.ts` | Wąska ochrona zależności nowej reguły |
| Zmień | `packages/server/src/modules/attempts.ts` | Import reguły, mapowanie danych i usunięcie starej kopii |
| Zmień | `docs/folder-structure.md` §4 | Jeden wpis wyjaśniający, gdzie jest reguła |
| Uruchom bez zmian | `tests/integration/{attempts,speech,mock-tests,history}.test.ts` | Regresje publicznych operacji i zapisu w PostgreSQL |

Nie twórz `modules/learning/index.ts` dla pojedynczej funkcji domenowej. Pełne
grupowanie przypadków użycia z projektu pozostaje poza tym etapem.

### Task 1: Wydzielenie i włączenie reguły stanu zadania

**Files:** wszystkie pliki z tabeli powyżej; testy integracyjne zmieniaj wyłącznie,
jeżeli rozpoznanie podczas wykonania ujawni brak pokrycia konkretnej gwarancji.

**Interfaces:**
- Consumes: `SkillOutcome` z `domain/types.ts`; istniejące `grade`, `session.mode`, `modality`, `attempt.attemptNumber` i zapytanie `incorrectAttempts` w `finalizeAttemptRow`.
- Produces, w `domain/task-completion.ts`:

```ts
import type { SkillOutcome } from "./types";

export type TaskCompletionState = "issued" | "answered" | "skipped";
export interface TaskCompletionInput {
  readonly isMockTest: boolean;
  readonly action: "answer" | "dont_remember" | "skip";
  readonly outcomes: readonly SkillOutcome[];
  readonly attemptNumber: number;
  readonly incorrectAttemptCount: number;
  readonly speechContentMatched?: boolean;
}
export function taskStateAfterAttempt(input: TaskCompletionInput): TaskCompletionState;
```

To deklaracja kontraktu planu, nie kompletny plik implementacji. Nie importuj
DTO ani całego `Grade` do nowej funkcji. Nie dodawaj walidacji runtime dla liczb
ani nowej konfiguracji polityki przy okazji tej refaktoryzacji.

- [ ] **Step 1: Sprawdź warunki uruchomienia i zakres zmian.**

Sprawdź `git status --short`, bieżący commit i aktualny kod `nextTaskState` oraz
wywołanie w `finalizeAttemptRow` (w bazie projektu około linii 186 i 381).
Pracuj w izolowanym worktree, zachowaj cudze zmiany i nie przełączaj współdzielonego
checkoutu. Przed implementacją zastosuj `superpowers:using-git-worktrees`; obecny
chat ma już worktree, więc nie twórz drugiego bez potrzeby. Jeżeli nadal jest
detached HEAD, użyj lokalnej gałęzi `feature/task-completion-refactor`.

Sprawdź `Test-Path node_modules` i `Test-Path .env`. W chwili pisania planu oba
wyniki były `False`. Brakujący `.env`: `node scripts/setup-worktree.cjs --skip-install`.
Zależności instaluj tylko gdy potrzebne: `corepack pnpm install --prefer-offline --frozen-lockfile`.
Nie pokazuj wartości `.env`. Potwierdź dostępność testowego Dockera przez `docker info`.
Integracje uruchamiaj z unikalnym `$env:UMIEM_TEST_RUN_ID = 'task-completion-7be8'`,
aby global setup nie sprzątał kontenerów innego równoległego przebiegu. Nie uruchamiaj
drugiego przebiegu z tym samym ID. Nie wykonuj pełnego baseline monorepo ani e2e.

- [ ] **Step 2: Napisz test reguły i potwierdź RED.**

Utwórz `domain/task-completion.test.ts`. Importuj Vitest i typy/funkcję z
`./task-completion`. Poniższa tabela jest kontraktem zachowania, w tym kolejności
warunków. Nie odczytuj starej funkcji z pliku ani nie buduj jej kopii w teście.

```ts
const base: TaskCompletionInput = {
  isMockTest: false, action: "answer", outcomes: [],
  attemptNumber: 1, incorrectAttemptCount: 0,
};
const cases: Array<[string, Partial<TaskCompletionInput>, TaskCompletionState]> = [
  ["pomiń", { action: "skip" }, "skipped"],
  ["pomiń ma pierwszeństwo przed sukcesem mowy", { action: "skip", speechContentMatched: true }, "skipped"],
  ["poprawna odpowiedź", { outcomes: ["correct"] }, "answered"],
  ["poprawna i nieoceniona umiejętność", { outcomes: ["correct", "unevaluated"] }, "answered"],
  ["brak ocen", {}, "issued"],
  ["druga techniczna próba", { outcomes: ["unevaluated"], attemptNumber: 2 }, "issued"],
  ["nie pamiętam", { action: "dont_remember" }, "answered"],
  ["pierwszy błąd", { outcomes: ["incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["drugi błąd", { outcomes: ["incorrect"], incorrectAttemptCount: 2 }, "answered"],
  ["dwa błędne skill w jednej próbie", { outcomes: ["incorrect", "incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["sukces i błąd w pierwszej próbie", { outcomes: ["correct", "incorrect"], incorrectAttemptCount: 1 }, "issued"],
  ["sukces i błąd w drugiej błędnej próbie", { outcomes: ["correct", "incorrect"], incorrectAttemptCount: 2 }, "answered"],
  ["błąd po próbie technicznej", { outcomes: ["incorrect"], attemptNumber: 2, incorrectAttemptCount: 1 }, "issued"],
  ["techniczna ocena przy dawnych błędach", { outcomes: ["unevaluated"], incorrectAttemptCount: 2 }, "issued"],
  ["zgodna treść mowy bez oceny wymowy", { speechContentMatched: true }, "answered"],
  ["pierwsza rozbieżność mowy", { speechContentMatched: false }, "issued"],
  ["druga rozbieżność mowy", { speechContentMatched: false, attemptNumber: 2 }, "answered"],
  ["kartkówka bez oceny", { isMockTest: true, outcomes: ["unevaluated"] }, "answered"],
  ["kartkówka z błędem", { isMockTest: true, outcomes: ["incorrect"] }, "answered"],
  ["pominięcie kartkówki", { isMockTest: true, action: "skip" }, "skipped"],
];
it.each(cases)("%s", (_name, override, expected) => {
  expect(taskStateAfterAttempt({ ...base, ...override })).toBe(expected);
});
```

Run: `corepack pnpm test:unit packages/server/src/domain/task-completion.test.ts`.
Expected: FAIL wskazujący brak `./task-completion`; błąd narzędzia lub brak zależności
nie jest dowodem RED. Zapisz przyczynę w wyniku wykonania.

- [ ] **Step 3: Zaimplementuj regułę i potwierdź GREEN.**

W `domain/task-completion.ts` zdefiniuj powyższe typy i implementację.
Zachowaj kolejność: pominięcie; pozostałe próby kartkówki; obecny wynik ćwiczenia
mowy i zgodna treść lub `attemptNumber >= 2`; co najmniej jeden sukces bez błędu;
brak pamięci; bieżący błąd i `incorrectAttemptCount >= 2`; w pozostałych przypadkach
`issued`. Pole mowy jest obecne także przy wartości `false`; nie sprawdzaj wyłącznie
jego prawdziwości. Licznik błędów dotyczy różnych prób i uwzględnia aktualną próbę.
Reguła nie wykonuje efektów ubocznych, nie zna zegara ani providerów.

Run: polecenie z kroku 2. Expected: PASS dla wszystkich 20 przypadków.

- [ ] **Step 4: Dodaj wąski test granicy importów.**

W `domain/task-completion.architecture.test.ts` czytaj tylko nową regułę przez
`new URL("./task-completion.ts", import.meta.url)` i parsuj ją TypeScriptem, już
obecnym w devDependencies. Lokalna funkcja testowa
`forbiddenDependencies(source: string): string[]` dopuszcza wyłącznie statyczny
`import type` z `./types`. Odrzuca inne importy, re-eksporty z modułów, import-equals,
`require(...)` oraz dynamiczny `import(...)`. Przejdź AST także dla wywołań wewnątrz funkcji.

Testy: dozwolony `import type { SkillOutcome } from "./types"` daje `[]`; źródło
rzeczywistego pliku daje `[]`; każdy z przykładów daje niepustą listę:
`import { eq } from "drizzle-orm"`, `import type { Tx } from "../db/client"`,
`import type { AttemptInput } from "@learning/contracts"`,
`export { createServices } from "../config"`, `import("../providers/fake")`,
`require("next/server")`, `import type { X } from "@orpc/server"`,
`import x = require("../config")`. To test czułości oraz realnej granicy;
nie dodawaj ogólnego frameworka sprawdzania importów.

Run: `corepack pnpm test:unit packages/server/src/domain/task-completion.test.ts packages/server/src/domain/task-completion.architecture.test.ts`.
Expected: PASS, z potwierdzeniem działania przypadków odrzuconych.

- [ ] **Step 5: Włącz regułę w istniejącej finalizacji i sprawdź regresje.**

W `modules/attempts.ts` dodaj import `taskStateAfterAttempt` z
`../domain/task-completion`. Usuń lokalne `nextTaskState`, zachowaj `AnyModality`,
bo nadal używają go inne funkcje. Zastąp ternary kartkówki i wywołanie funkcji
jednym wywołaniem nowej reguły z następującym mapowaniem:

- `isMockTest: session.mode === "mock_test"` — również stare `daily_round` daje `false`;
- `action`: `skip` i `dont_remember` zachowują nazwę; wszystkie pozostałe modalności to `answer`;
- `outcomes: Object.values(grade.skills).map(skill => skill.outcome)`;
- `speechContentMatched: grade.speechAttempt?.contentMatched`;
- `attemptNumber: attempt.attemptNumber`, `incorrectAttemptCount: incorrectAttempts.length`.

Nie przesuwaj wywołania względem zapisu ocen i `selectDistinct` błędnych prób.
Nie zmieniaj blokad, transakcji, timeoutów, finalizacji ani zapisu feedbacku.
Nie przenoś tego helpera do `lesson-attempts.ts`; reguły lekcji pozostają bez zmian.

Run ponownie oba testy jednostkowe z kroku 4, następnie:
`corepack pnpm test:integration tests/integration/attempts.test.ts tests/integration/speech.test.ts tests/integration/mock-tests.test.ts tests/integration/history.test.ts`.
Expected: PASS na PostgreSQL uruchomionym przez istniejący global setup, w jednym
przebiegu z ustawionym w kroku 1 ID. Sprawdź w wynikach szczególnie:
rollback finalizacji, równoległą finalizację jednej próby, idempotencję,
ekspozycję przed odpowiedzią, niezmienność historii, ciszę/timeout, drugą próbę
mowy oraz `finishes %s without support or disclosures` (wariant `text` jest
odpowiedzią pustą, finalizowaną jako nieoceniona w kartkówce).
Gdy Docker nie działa, zgłoś brak dowodu; nie zastępuj PostgreSQL PGlite ani mockiem.

- [ ] **Step 6: Udokumentuj granicę i zweryfikuj cały zakres.**

Dodaj jeden wpis `task-completion.ts` w tabeli `docs/folder-structure.md` §4.
Wyjaśnij, że moduł nauki posiada regułę, a `attempts.ts` koordynuje zapis.
W raporcie wykonania zapisz: API → MCP → skill bez zmian, ponieważ wydzielono
wewnętrzną decyzję przy zachowaniu wyników i publicznych kontraktów; nie zmieniono
odczytów `getLearningOverview`, filtra lekcji ani semantyki raportu Hermesa.

Run: `corepack pnpm typecheck`, potem `corepack pnpm build` i `git diff --check`.
Expected: exit code 0 każdej kontroli. Build nie jest dowodem zachowania na urządzeniu.
Nie uruchamiaj e2e ani pełnych testów monorepo bez nowego powodu: UI, transport
i schemat pozostają poza zakresem. Nie naprawiaj niezwiązanych błędów przy okazji;
odnotuj je i odróżnij od wyniku tego etapu.

- [ ] **Step 7: Sprawdź diff i wykonaj jeden lokalny commit kompletnego etapu.**

Potwierdź, że usunięto starą regułę, nowe dane nie zawierają odpowiedzi dziecka,
nie zmieniły się zapytania i granice transakcji, a diff obejmuje tylko wskazany
zakres. Commit dopiero po odczytaniu wyników kontroli; nie deklaruj gwarancji,
których nie sprawdzono. Dodaj konkretne pliki, bez `git add .`.
Suggested commit: `refactor: extract task completion rule from attempt persistence`.
Bez push, PR i merge. Raportuj pliki, korzyść, rzeczywiste wyniki oraz pozostałe
sprzężenie z Drizzle w `attempts.ts`; nie deklaruj wydzielenia całego modułu nauki.

## Dalszy kierunek, poza tym planem

Po ocenie pierwszego etapu osobnych planów wymagają: deterministyczna materializacja
zadania z jawną losowością i ID, koordynacja kartkówek poza routerami, usunięcie
cyklu generowania lekcji i grupowanie większych przypadków użycia według pięciu
obszarów z projektu. Ich kolejność nie jest warunkiem wykonania tego planu.

## Przekazanie do wykonania

Plan ma jeden kompletny etap; rekomendacja autora to wykonanie bezpośrednio w tej
sesji przez `superpowers:executing-plans`, ponieważ całość dotyczy jednej reguły
i jej jednego miejsca wywołania. Po implementacji obowiązuje przegląd zmian.
Zapisanie planu nie rozpoczyna implementacji; właściciel wybiera sposób wykonania
po przeczytaniu dokumentu.
