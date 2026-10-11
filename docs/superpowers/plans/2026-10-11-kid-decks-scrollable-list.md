# Kid decks: jedna przewijalna lista (bez paginacji) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Ekran wyboru zestawu w Kid UI pokazuje wszystkie przypisane zestawy jako jedną, przewijaną stronę, bez strzałek paginacji i podziału na strony 1–2 kart.

**Architecture:** Usuwam paginację z `DeckScreen` (stan strony, listener resize, nawigacja ‹ X z Y ›) i zastępuję podział na strony prostym podziałem na grupy `groupDecks` (Rekomendowane / Wszystkie zestawy). Obie sekcje renderują się jedna pod drugiej, dokument przewija się naturalnie, a stopka mikrofonu pozostaje przyklejona na dole (`position: sticky`). Bez zmian DTO/API/modelu danych.

**Tech Stack:** React + TypeScript strict (`packages/kid-ui`), Vitest (unit), Playwright (e2e), komunikaty w `packages/contracts/src/messages.ts`.

**Spec:** Zadanie bounded — design zatwierdzony przez właściciela w czacie 2026-10-11 (decyzje wbudowane w sekcję „Global Constraints" i treści zadań). Nie ma osobnego pliku spec.

## Global Constraints

- Interfejs dziecka po polsku; identyfikatory kodu i testidy po angielsku.
- Kid UI nie importuje Next.js ani kodu serwerowego; zmiana dotyczy wyłącznie `packages/kid-ui`, `packages/contracts/src/messages.ts` i testów.
- Zachowujemy nagłówki sekcji „Rekomendowane" i „Wszystkie zestawy" (decyzja właściciela) oraz testidy `kid-section-recommended`/`kid-section-other`.
- Stopka mikrofonu (`.kid-deck-microphone`) pozostaje sticky na dole ekranu.
- Testidy paginacji (`kid-decks-next`, `kid-decks-previous`, `kid-decks-page`) znikają z DOM; klucze `deckPagination`, `previousDecksPage`, `nextDecksPage`, `deckPage` znikają z `messages.ts`.
- Środowisko (Windows, Git Bash): `pnpm` przez pełną ścieżkę `"$HOME/AppData/Local/npm-global/pnpm"` (10.34.6); e2e wymaga uruchomionego Docker Desktop (`docker info` przed przebiegiem); filtrowanie e2e wyłącznie przez `pnpm exec playwright test <ścieżka>`; przy równoległych sesjach w repo dodać izolator `UMIEM_TEST_RUN_ID=<unikalny> UMIEM_E2E_PORT=<wolny>`.
- Komendy uruchamiać z roota repo: `C:/Users/looka/IdeaProjects/knowli`.
- Każde zadanie kończy się commitem; integracja do `main` wyłącznie przez PR ze squash (scala właściciel), po obowiązkowym niezależnym review (`superpowers:requesting-code-review`).

---

### Task 1: Helper `groupDecks` w deck-presentation (TDD, unit)

**Files:**
- Modify: `packages/kid-ui/src/screens/deck-presentation.ts`
- Test: `packages/kid-ui/src/screens/deck-presentation.test.ts`

**Interfaces:**
- Consumes: `KidDeckDto` z `@learning/contracts` (pole `recommended: boolean`).
- Produces: `type DeckGroups = { recommended: readonly KidDeckDto[]; other: readonly KidDeckDto[] }` oraz `groupDecks(decks: readonly KidDeckDto[]): DeckGroups`. Zadanie 2 korzysta dokładnie z tych nazw.

- [ ] **Step 1: Write the failing test**

W `packages/kid-ui/src/screens/deck-presentation.test.ts` zmień import (linia 3) na:

```ts
import { formatDeckTestDate, groupDecks } from "./deck-presentation";
```

Usuń w całości `describe("buildDeckPages", ...)` (linie 18–47) oraz `describe("clampDeckPageIndex", ...)` (linie 80–86). `describe("formatDeckTestDate", ...)` pozostaje bez zmian. Na miejscu usuniętych describe dodaj:

```ts
describe("groupDecks", () => {
  it("groups recommended decks before others and preserves API order", () => {
    const input = [deck("01", false), deck("02", true), deck("03", false), deck("04", true)];

    expect(groupDecks(input)).toEqual({
      recommended: [input[1], input[3]],
      other: [input[0], input[2]],
    });
  });

  it("returns empty groups for an empty deck list", () => {
    expect(groupDecks([])).toEqual({ recommended: [], other: [] });
  });

  it("keeps a pure split when every deck is recommended", () => {
    const input = [deck("01", true), deck("02", true)];
    expect(groupDecks(input)).toEqual({ recommended: input, other: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$HOME/AppData/Local/npm-global/pnpm" exec vitest run deck-presentation --config vitest.unit.config.ts`
Expected: FAIL — import error, `groupDecks` nie istnieje w `./deck-presentation`.

- [ ] **Step 3: Write minimal implementation**

W `packages/kid-ui/src/screens/deck-presentation.ts` usuń `export type DeckPage`, `buildDeckPages` i `clampDeckPageIndex`, a w ich miejsce dodaj (poniżej importu, nad `POLISH_MONTHS`):

```ts
export type DeckGroups = {
  recommended: readonly KidDeckDto[];
  other: readonly KidDeckDto[];
};

export function groupDecks(decks: readonly KidDeckDto[]): DeckGroups {
  return {
    recommended: decks.filter((deck) => deck.recommended),
    other: decks.filter((deck) => !deck.recommended),
  };
}
```

Uwaga: w tym kroku `DeckScreen.tsx` jeszcze importuje `buildDeckPages`/`clampDeckPageIndex` — dlatego nie uruchamiamy jeszcze `pnpm typecheck`; naprawimy to w Zadaniu 2. (Jeśli wolisz zielony build po każdym zadaniu: zostaw `buildDeckPages`/`clampDeckPageIndex` na razie w pliku i usuń je w Zadaniu 2 razem z przełączeniem ekranu — wtedy dodaj też z powrotem ich stare testy do czasu Zadania 2.)

- [ ] **Step 4: Run test to verify it passes**

Run: `"$HOME/AppData/Local/npm-global/pnpm" exec vitest run deck-presentation --config vitest.unit.config.ts`
Expected: PASS — wszystkie testy w pliku (groupDecks + formatDeckTestDate).

- [ ] **Step 5: Commit**

```bash
git add packages/kid-ui/src/screens/deck-presentation.ts packages/kid-ui/src/screens/deck-presentation.test.ts
git commit -m "refactor: extract groupDecks helper for kid deck screen"
```

---

### Task 2: DeckScreen bez paginacji — jedna przewijana lista (TDD, e2e)

**Files:**
- Modify: `packages/kid-ui/src/screens/DeckScreen.tsx`
- Modify: `packages/kid-ui/src/styles.css` (usuwa reguły `.kid-deck-page` ~linie 373–377 i `.kid-deck-pagination*` ~linie 462–484)
- Modify: `packages/contracts/src/messages.ts` (usuwa 4 klucze paginacji, linie 253–256)
- Test: `tests/e2e/kid-decks-layout.spec.ts`

**Interfaces:**
- Consumes: `groupDecks` z Zadania 1; `messages.kid.recommendedTitle`/`otherDecksTitle`; props `DeckScreen` bez zmian (KidApp nie wymaga modyfikacji).
- Produces: DOM bez `kid-decks-next`/`kid-decks-previous`/`kid-decks-page`; wszystkie karty `kid-deck-card` obecne w dokumencie jednocześnie, w kolejności: wszystkie rekomendowane (kolejność API), potem pozostałe (kolejność API).

- [ ] **Step 1: Rewrite the failing e2e spec**

W `tests/e2e/kid-decks-layout.spec.ts` zostaw bez zmian: importy, `expect`/`test.use`, `childId`, `sessionId`, `makeDeck`, `openDeckScreen` oraz testy „unavailable mock test is omitted", „long deck titles and actions remain available at 200 percent text size", „empty decks and a denied microphone still offer recovery". Trzy pierwsze testy zastąp następującymi (całość pliku od linii 40):

```ts
test("deck card actions address the same deck", async ({ page }) => {
  const decks = [makeDeck(0), makeDeck(1)];
  await openDeckScreen(page, decks);
  await page.route("**/api/v1/kid/sessions", async (route) => route.abort());
  const card = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const learningRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await card.getByRole("button", { name: "Ucz się" }).click();
  expect((await learningRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "training" });

  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  const sameCard = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const mockRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await sameCard.getByRole("button", { name: "Próbna kartkówka" }).click();
  expect((await mockRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "mock_test" });
});

test("all assigned decks render in one scrollable list in group order", async ({ page }) => {
  const decks = Array.from({ length: 4 }, (_, index) => makeDeck(index));
  const expectedOrder = [decks[0]!, decks[2]!, decks[1]!, decks[3]!];
  await openDeckScreen(page, decks);

  await expect(page.getByTestId("kid-deck-card")).toHaveCount(4);
  await expect(page.getByTestId("kid-deck-title")).toHaveText(expectedOrder.map((deck) => `${deck.title} — 12 słów`));
  await expect(page.getByTestId("kid-section-recommended")).toBeVisible();
  await expect(page.getByTestId("kid-section-other")).toBeVisible();
  await expect(page.getByTestId("kid-decks-next")).toHaveCount(0);
  await expect(page.getByTestId("kid-decks-previous")).toHaveCount(0);
  await expect(page.getByTestId("kid-decks-page")).toHaveCount(0);
});

test("short phone viewport reaches lower decks and the microphone bar by scrolling", async ({ page }) => {
  const decks = [
    makeDeck(0, { recommended: true, title: "Dni tygodnia i pory roku" }),
    makeDeck(1, { recommended: true }),
    makeDeck(2, { recommended: false }),
    makeDeck(3, { recommended: false }),
  ];
  await page.setViewportSize({ width: 360, height: 640 });
  await openDeckScreen(page, decks);
  await expect(page.getByTestId("kid-deck-card")).toHaveCount(4);
  const layout = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(layout.documentHeight, JSON.stringify(layout)).toBeGreaterThan(layout.viewportHeight);
  await expect(page.getByTestId("kid-mic-toggle")).toBeChecked();
  await expect(page.getByTestId("kid-microphone-hint")).toBeVisible();

  const lastCard = page.getByTestId("kid-deck-card").filter({ hasText: decks[3]!.title });
  await lastCard.getByRole("button", { name: "Ucz się" }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-mic-toggle")).toBeInViewport();

  const learningRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await lastCard.getByRole("button", { name: "Ucz się" }).click();
  expect((await learningRequest).postDataJSON()).toMatchObject({ deckId: decks[3]!.deckId, mode: "training" });
});
```

(Semantyka: „12 słów" wynika z `itemCount: 12` w `makeDeck` i odmiany `wordMany`; stary test „paginates two deck cards to avoid document scrolling" zostaje celowo odwrócony — teraz asertywamy, że dokument się przewija.)

- [ ] **Step 2: Run e2e to verify it fails (RED)**

Upewnij się, że Docker działa (`docker info`). Run:
`"$HOME/AppData/Local/npm-global/pnpm" exec playwright test tests/e2e/kid-decks-layout.spec.ts`
Expected: FAIL w nowych testach — stary UI renderuje 1 kartę na stronę (`toHaveCount(4)` nie przechodzi), `kid-decks-next` istnieje (`toHaveCount(0)` nie przechodzi). Testy niemodyfikowane (mock test omitted, long titles, empty decks) powinny przechodzić.

- [ ] **Step 3: Implement DeckScreen without pagination**

W `packages/kid-ui/src/screens/DeckScreen.tsx`:

1. Importy (linie 1–4) zamień na:

```tsx
import type { ReactNode } from "react";
import { messages, type KidDeckDto } from "@learning/contracts";
import { format } from "../format";
import { formatDeckTestDate, groupDecks } from "./deck-presentation";
```

2. Usuń cały stan i efekt viewportu oraz paginacji z ciała komponentu (linie 38–57: `viewportWidth`, `viewportHeight`, `pageIndex`, `useEffect` z `updateViewport`, `cardsPerPage`, `pages`, `safePageIndex`, `page`, `useEffect` clampujący). Ciało komponentu zaczyna się od:

```tsx
  const groups = groupDecks(decks);
  const sections = [
    { kind: "recommended", title: messages.kid.recommendedTitle, items: groups.recommended },
    { kind: "other", title: messages.kid.otherDecksTitle, items: groups.other },
  ].filter((section) => section.items.length > 0);
```

3. Blok `{decks.length === 0 ? … : page ? (…) : null}` (linie 65–96, razem z `<nav className="kid-deck-pagination">…</nav>`) zastąp:

```tsx
      {decks.length === 0 ? (
        <p className="kid-hint" data-testid="kid-no-decks">{messages.kid.noDecks}</p>
      ) : (
        sections.map((section) => (
          <section key={section.kind} aria-label={section.title} data-kind={section.kind}>
            <h2 className="kid-deck-group-title" data-testid={section.kind === "recommended" ? "kid-section-recommended" : "kid-section-other"}>
              {section.title}
            </h2>
            <ul className="kid-deck-list">
              {section.items.map((deck) => (
                <DeckCard key={deck.deckId} deck={deck} onStart={onStart} onMockTest={onMockTest} />
              ))}
            </ul>
          </section>
        ))
      )}
```

4. `wordCount`, `DeckCard` oraz `<aside className="kid-deck-microphone">` pozostają bez zmian. Aktualizacja komentarza docstringowego nad komponentem: `/** Ekran wyboru zestawu: wszystkie przypisane zestawy w jednej przewijanej liście. */`

- [ ] **Step 4: Remove pagination CSS**

W `packages/kid-ui/src/styles.css` usuń w całości:

```css
.kid-deck-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
```

oraz blok `.kid-deck-pagination { … }`, `.kid-deck-pagination button { … }`, `.kid-deck-pagination button:disabled { … }` (linie ~462–484). Pozostałe reguły (`.kid-deck-list`, `.kid-deck-card`, `.kid-deck-microphone`, media queries) zostają.

- [ ] **Step 5: Remove unused pagination messages**

W `packages/contracts/src/messages.ts` usuń linie 253–256:

```ts
    deckPagination: "Strony zestawów",
    previousDecksPage: "Poprzednia strona zestawów",
    nextDecksPage: "Następna strona zestawów",
    deckPage: "{current} z {total}",
```

- [ ] **Step 6: Run e2e to verify it passes (GREEN)**

Run: `"$HOME/AppData/Local/npm-global/pnpm" exec playwright test tests/e2e/kid-decks-layout.spec.ts`
Expected: PASS — 6/6 testów w pliku.

- [ ] **Step 7: Run unit + typecheck**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit && "$HOME/AppData/Local/npm-global/pnpm" typecheck`
Expected: PASS bez błędów (brak referencji do usuniętych funkcji i kluczy messages; `format` nadal używany w DeckScreen).

- [ ] **Step 8: Commit**

```bash
git add packages/kid-ui/src/screens/DeckScreen.tsx packages/kid-ui/src/styles.css packages/contracts/src/messages.ts tests/e2e/kid-decks-layout.spec.ts
git commit -m "feat: show all kid decks in one scrollable list"
```

---

### Task 3: Weryfikacja całości + bramka review + PR

**Files:**
- Modify: brak (wyłącznie przebiegi weryfikacyjne i dokumentacja dziennika postępu).

**Interfaces:**
- Consumes: ukończone Zadania 1–2.
- Produces: dowody weryfikacji do dziennika postępu i opisu PR.

- [ ] **Step 1: Full unit + typecheck**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:unit && "$HOME/AppData/Local/npm-global/pnpm" typecheck`
Expected: PASS.

- [ ] **Step 2: Full e2e suite (paritet z CI)**

Run: `"$HOME/AppData/Local/npm-global/pnpm" test:e2e`
Expected: PASS całości (DeckScreen współdzieli wiele przepływów — kid-flow, navigation, mock-test; upewnij się, że klikanie `.first()`/filtrów nadal działa po zmianie układu).
Przy równoległej sesji w repo: `UMIEM_TEST_RUN_ID=<unikalny> UMIEM_E2E_PORT=<wolny> "$HOME/AppData/Local/npm-global/pnpm" test:e2e`.

- [ ] **Step 3: whitespace check**

Run: `git diff --check main...HEAD` (oraz `git diff --check` dla niezacommitowanych, jeśli jakieś są)
Expected: brak wyników.

- [ ] **Step 4: Independent review (bramka obowiązkowa)**

Uruchom `superpowers:requesting-code-review` wg szablonu `requesting-code-review/code-reviewer.md`: cel, zakres `BASE_SHA..HEAD_SHA` całej gałęzi (nie tylko ostatni commit), wyniki testów z kroków 1–2, decyzja o odwróceniu testu „unikaj przewijania dokumentu". Recenzent: dedykowany subagent na najsilniejszym dostępnym modelu (bez rodziny GPT Astra). Uwagi obsłuż `superpowers:receiving-code-review` (Critical/Important przed PR; Minor jako odłożone).

- [ ] **Step 5: PR przez `superpowers:finishing-a-development-branch`**

Push gałęzi, PR do `main` z opisem zawierającym wynik review i sposób obsługi uwag. Scala właściciel (Squash and merge) — agent nie scala bez wyraźnego polecenia.

---

## Self-Review

1. **Pokrycie designu:** paginacja usunięta (Task 2 Step 3), nagłówki sekcji zachowane (Global Constraints + `sections` z filtrem niepustych), sticky stopka (bez zmian w CSS, asercja `toBeInViewport` w e2e), refaktor helpera (Task 1), CSS (Task 2 Step 4), messages (Task 2 Step 5), e2e przepisane (Task 2 Step 1), weryfikacja (Task 3). Brak luk.
2. **Placeholdery:** brak „TBD"/„podobnie do zadania N"; każdy krok kodowy ma pełny kod lub precyzyjne linie do usunięcia.
3. **Spójność typów:** `groupDecks`/`DeckGroups` zdefiniowane w Task 1, konsumowane w Task 2; testidy w e2e zgodne z DeckScreen po zmianie; „12 słów" zgodne z `wordCount(12)` i `makeDeck.itemCount = 12`.
