# Gwiazdki opanowania zestawu na liście dziecka — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Zastąpić pigułkę „⭐ {count} przypominasz samodzielnie" na liście zestawów dziecka jednym wskaźnikiem symbolicznym — 6 gwiazdek opanowania (samodzielny Recall), bez procentu i rozbicia na umiejętności.

**Architecture:** Dane już płyną w `KidDeckDto` (`itemCount`, `independentlyRecalledCount`) — zmiana jest wyłącznie prezentacyjna w `packages/kid-ui` + katalog komunikatów + dokumentacja SPEC. Wzór gwiazdek współdzielony z omówieniem próbnej kartkówki (§19.1) przez nowy helper `starsForFraction`, żeby jedna skala nie rozjechała się między ekranami.

**Tech Stack:** React (kid-ui, bez importów serwerowych), TypeScript strict, Vitest, Tailwind-free CSS (`styles.css`), komunikaty w `packages/contracts/src/messages.ts`.

**Spec:** Design zatwierdzony przez właściciela w czacie 2026-10-11 (bounded, decyzje: same gwiazdki bez procentu; maksimum 6; zastąpienie pigułki; znaczenie = samodzielny Recall; szczegóły per umiejętność zostają w panelu rodzica i w omówieniu kartkówki). Rządzący dokument: `docs/SPEC.md` §6 — aktualizowany w Zadaniu 3.

## Global Constraints

- UI dziecka po polsku (pl-PL), krótkie i naturalne teksty; dziecko nie widzi procentów ani liczb ułamkowych poza wyjątkiem §19.1 — dlatego przy gwiazdkach **nie dodajemy** „%" ani „X/Y".
- `packages/kid-ui` nie importuje Next.js, bazy ani kodu serwerowego.
- pnpm na tej maszynie działa przez pełną ścieżkę: `"$LOCALAPPDATA/npm-global/pnpm.cmd"` (10.34.6; corepack zepsuty).
- Bazowy stan: worktree zaktualizowany z `origin/main` = `da20f3f` (#44 „wszystkie zestawy dziecka w jednej przewijanej liście"; DeckCard bez paginacji — plan celuje w tę strukturę). e2e na CI jest czerwone z powodu istniejących awarii po #42 (poza zakresem tego planu — nie naprawiaj ich tutaj, tylko odnotuj).
- W pierwotnym checkoucie main są niezwiązane zmiany użytkownika (` M .gitignore`, pliki nieśledzone) — **nie dotykaj ich i nie commituj**; praca wyłącznie w worktree na plikach tego planu.
- Każde zadanie: TDD (potwierdzony RED przed implementacją), osobny commit w konwencji historii (`feat:`/`refactor:`/`docs:` + opis po polsku).
- Skale nie duplikujemy: po Zadaniu 1 jedynym miejscem wzoru gwiazdek jest `stars.ts`; `mock-test-score.ts` musi z niego korzystać.

---

### Task 1: Wspólny helper skali gwiazdek `starsForFraction`

**Files:**
- Create: `packages/kid-ui/src/screens/stars.ts`
- Test: `packages/kid-ui/src/screens/stars.test.ts`
- Modify: `packages/kid-ui/src/screens/mock-test-score.ts:29-40` (refactor na wspólny wzór; istniejące testy `mock-test-score.test.ts` zostają bez zmian i muszą przejść)

**Interfaces:**
- Produces: `export const MASTERY_STAR_MAX = 6;` oraz `export function starsForFraction(known: number, total: number): number` (0 dla `total <= 0`, inaczej `min(6, floor(known*6/total))`).
- Konsumenci: `mock-test-score.ts` (to zadanie) i `DeckScreen.tsx` (Zadanie 2).

- [ ] **Step 1: Write the failing test** — utwórz `packages/kid-ui/src/screens/stars.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MASTERY_STAR_MAX, starsForFraction } from "./stars";

describe("starsForFraction — skala 0–6 (SPEC §6, jak w omówieniu kartkówki §19.1)", () => {
  it("zwraca 0 gwiazdek dla pustego zestawu i zerowego postępu", () => {
    expect(starsForFraction(0, 0)).toBe(0);
    expect(starsForFraction(0, 10)).toBe(0);
  });

  it("przyznaje pierwszą gwiazdkę dopiero po osiągnięciu 1/6 drogi", () => {
    expect(starsForFraction(1, 10)).toBe(0); // 10% < 16,7%
    expect(starsForFraction(2, 10)).toBe(1); // 20% ≥ 16,7%
  });

  it("liczy z pełnego ułamka, nie z zaokrąglonego procentu", () => {
    expect(starsForFraction(5, 6)).toBe(5); // próg piątej gwiazdki dokładnie
    expect(starsForFraction(3, 7)).toBe(2); // floor(18/7) — przypadek z deck-screen.test.ts
  });

  it("pełne opanowanie to maksimum 6 gwiazdek, bez przekroczenia", () => {
    expect(starsForFraction(10, 10)).toBe(MASTERY_STAR_MAX);
    expect(starsForFraction(12, 10)).toBe(MASTERY_STAR_MAX);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit -- stars.test`
Expected: FAIL — nie można zaimportować `./stars` (modul nie istnieje).

- [ ] **Step 3: Write minimal implementation** — utwórz `packages/kid-ui/src/screens/stars.ts`:

```ts
/** Skala gwiazdek postępu: maksymalnie 6, po jednej za każdą szóstą drogi (100%/6 ≈ 16,7%). */
export const MASTERY_STAR_MAX = 6;

/**
 * Gwiazdki liczymy z całkowitego ułamka, nie z zaokrąglonego procentu:
 * 5/6 słów osiąga próg piątej gwiazdki dokładnie, a float po zaokrągleniu
 * gubiłby tę granicę.
 */
export function starsForFraction(known: number, total: number): number {
  return total <= 0 ? 0 : Math.min(MASTERY_STAR_MAX, Math.floor((known * MASTERY_STAR_MAX) / total));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit -- stars.test`
Expected: PASS (4 testy).

- [ ] **Step 5: Refactor `mock-test-score.ts` na wspólny wzór** — w `packages/kid-ui/src/screens/mock-test-score.ts` dodaj na górze `import { starsForFraction } from "./stars";`, a w `computeMockTestScore` zamień linie:

```ts
    // liczymy z całkowitego ułamka, nie z zaokrąglonego procentu: 5/6 słów
    // osiąga próg piątej gwiazdki dokładnie, a float po zaokrągleniu gubiłby tę granicę
    stars: total === 0 ? 0 : Math.min(6, Math.floor((correct * 6) / total)),
```

na:

```ts
    stars: starsForFraction(correct, total),
```

- [ ] **Step 6: Run the affected tests**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit -- stars.test mock-test-score.test`
Expected: PASS — nowe testy helpera i istniejące testy kartkówki (zachowanie bez zmian).

- [ ] **Step 7: Commit**

```bash
git add packages/kid-ui/src/screens/stars.ts packages/kid-ui/src/screens/stars.test.ts packages/kid-ui/src/screens/mock-test-score.ts
git commit -m "refactor: wspólny helper skali gwiazdek postępu w kid-ui"
```

---

### Task 2: Gwiazdki w karcie zestawu zamiast pigułki

**Files:**
- Modify: `apps/web/src/kid/deck-screen.test.ts:31-53` (test najpierw — RED)
- Modify: `packages/contracts/src/messages.ts:255` (usuń `recalledCount`, dodaj `deckStarsLabel` przy `testDateLabel`)
- Modify: `packages/kid-ui/src/screens/DeckScreen.tsx:80-107` (`DeckCard`)
- Modify: `packages/kid-ui/src/styles.css` (nowa klasa `.kid-deck-stars` przy `.kid-deck-card .kid-badge`, ~linia 419)

**Interfaces:**
- Consumes: `starsForFraction`, `MASTERY_STAR_MAX` z `./stars` (Task 1); `KidDeckDto.itemCount`/`independentlyRecalledCount` (bez zmian).
- Produces: komunikat `messages.kid.deckStarsLabel = "Przypominasz samodzielnie: {n} z 6 gwiazdek"`; element `<p className="kid-deck-stars" data-testid="kid-deck-stars" role="img" aria-label=…>`; klucz `messages.kid.recalledCount` **przestaje istnieć** (jedyne użycie znika w tym zadaniu).

- [ ] **Step 1: Write the failing test** — w `apps/web/src/kid/deck-screen.test.ts` w bloku `describe("DeckScreen — powitanie i postępy na kafelkach (SPEC §6)"` zmień pierwszy przypadek (asercja pigułki w linii 38 znika) i dodaj przypadek pełnego opanowania:

```ts
  it("wita dziecko i pokazuje liczbę słów oraz gwiazdki opanowania (samodzielny Recall)", () => {
    const markup = renderDeckScreen(DECK);

    expect(markup).toContain("Cześć, Krzysztof! 👋");
    expect(markup).toContain("Dni tygodnia");
    expect(markup).toContain("— 7 słów");
    expect(markup).toContain('data-testid="kid-deck-stars"');
    expect(markup).toContain("★★☆☆☆☆"); // 3 z 7 słów → floor(3*6/7) = 2
    expect(markup).toContain("Przypominasz samodzielnie: 2 z 6 gwiazdek");
    expect(markup).not.toContain("⭐ 3 słowa przypominasz samodzielnie"); // pigułka zniknęła
    expect(markup).toContain("Sprawdzian: 10 paź");
  });

  it("pokazuje komplet 6 gwiazdek przy pełnym opanowaniu zestawu", () => {
    const markup = renderDeckScreen({ ...DECK, independentlyRecalledCount: 7 });

    expect(markup).toContain("★★★★★★");
    expect(markup).toContain("Przypominasz samodzielnie: 6 z 6 gwiazdek");
  });
```

Stara linia `expect(markup).toContain("⭐ 3 słowa przypominasz samodzielnie");` zostaje usunięta (zastępuje ją negacja pełnego tekstu pigułki — sama negacja fragmentu „przypominasz samodzielnie" byłaby myląca, bo nowy aria-label zawiera „Przypominasz samodzielnie" wielką literą). Nagłówek przypadku aktualizujemy z „…samodzielnie przypominane słowa" na „…gwiazdki opanowania".

- [ ] **Step 2: Run test to verify it fails**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit -- deck-screen.test`
Expected: FAIL — brak `kid-deck-stars` w markupie, obecna stara pigułka.

- [ ] **Step 3: Implement messages** — w `packages/contracts/src/messages.ts` (sekcja `kid`):
  - usuń linię `recalledCount: "⭐ {count} przypominasz samodzielnie",`
  - po `testDateLabel: "Sprawdzian",` dodaj:

```ts
    deckStarsLabel: "Przypominasz samodzielnie: {n} z 6 gwiazdek",
```

- [ ] **Step 4: Implement `DeckCard`** — w `packages/kid-ui/src/screens/DeckScreen.tsx`:
  - dodaj import: `import { MASTERY_STAR_MAX, starsForFraction } from "./stars";`
  - w `DeckCard` policz gwiazdki i podmień pigułkę (linia 91) na rząd gwiazdek; data sprawdzianu bez zmian:

```tsx
function DeckCard({ deck, onStart, onMockTest }: {
  deck: KidDeckDto;
  onStart: (deckId: string) => void;
  onMockTest?: (deckId: string) => void;
}) {
  const date = formatDeckTestDate(deck.testDate, new Date().getFullYear());
  const stars = starsForFraction(deck.independentlyRecalledCount, deck.itemCount);
  return (
    <li>
      <article className="kid-deck-card" data-testid="kid-deck-card" data-deck-id={deck.deckId}>
        <div className="kid-deck-card__details">
          <h3 data-testid="kid-deck-title">{deck.title} <span>— {wordCount(deck.itemCount)}</span></h3>
          <p className="kid-deck-stars" data-testid="kid-deck-stars" role="img"
            aria-label={format(messages.kid.deckStarsLabel, { n: stars })}>
            {"★".repeat(stars)}{"☆".repeat(MASTERY_STAR_MAX - stars)}
          </p>
          {date !== null && <p className="kid-badge">{messages.kid.testDateLabel}: {date}</p>}
        </div>
        {/* __actions bez zmian */}
```

  - wzorzec `role="img"` + `aria-label` kopiowany z `MockTestSummaryScreen.tsx:30`.

- [ ] **Step 5: Add CSS** — w `packages/kid-ui/src/styles.css` bezpośrednio po regule `.kid-deck-card .kid-badge` (~linia 419) dodaj:

```css
.kid-deck-stars {
  margin: 0;
  font-size: 1.35rem;
  letter-spacing: 2px;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit -- deck-screen.test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/kid/deck-screen.test.ts packages/contracts/src/messages.ts packages/kid-ui/src/screens/DeckScreen.tsx packages/kid-ui/src/styles.css
git commit -m "feat: gwiazdki opanowania zamiast pigułki na liście zestawów dziecka"
```

---

### Task 3: Aktualizacja SPEC §6 (przykład + zdanie o „3/7 umiem")

**Files:**
- Modify: `docs/SPEC.md:138-145` (przykład widoku + zdanie o „3/7 umiem")

**Interfaces:**
- Brak kodu; zmiana wyłącznie dokumentacyjna (wyjątek testu RED nie dotyczy zmiany samej dokumentacji).

- [ ] **Step 1: Zaktualizuj przykład widoku tematu** — obecny fragment:

```markdown
Przykład widoku tematu:

> Cześć, Krzysiu! 👋  
> 📅 Dni tygodnia — 7 słów  
> ⭐ 3 słowa przypominasz samodzielnie  
> **Uczę się**

Nie pokazujemy ogólnego „3/7 umiem”, jeżeli nie wiadomo, jakiej umiejętności dotyczy ta informacja.
```

zamień na (przykład dostosowany do obecnego UI po #42: bez 📅, przycisk „Ucz się”; 3 z 7 słów = 2 gwiazdki):

```markdown
Przykład widoku tematu:

> Cześć, Krzysiu! 👋  
> Dni tygodnia — 7 słów  
> ★★☆☆☆☆  
> **Ucz się**

Gwiazdki na liście zestawów to symboliczny wskaźnik postępu (2026-10-11): maksymalnie 6, po jednej za każdą szóstą drogi do kompletu. Oznaczają wyłącznie słowa przypominane samodzielnie; nie towarzyszy im procent ani liczba ułamkowa, a umiejętność nazywa etykieta dostępności. Nie pokazujemy ogólnego „3/7 umiem” ani rozbicia na umiejętności w interfejsie dziecka — szczegóły per umiejętność widzi rodzic w panelu postępów, a dziecko w omówieniu próbnej kartkówki przy wynikach mieszanych (§19.1).
```

- [ ] **Step 2: Verify consistency** — sprawdź, że nie naruszono innych reguł:
  - punkt §6 o „brak procentowych ocen…" pozostaje bez zmian (gwiazdki nie są procentem);
  - §19.1 dalej mówi o „jedynym wyjątku od reguły §6 o braku procentowych ocen" — nadal prawdziwe.
  - Run: `git diff --check` → Expected: puste wyjście (brak błędów białych znaków).

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs: gwiazdki postępu zestawu na liście dziecka w SPEC §6"
```

---

### Task 4: Weryfikacja całości, niezależny review i PR (bramki AGENTS)

**Files:**
- Brak nowych plików — weryfikacja i integracja.

- [ ] **Step 1: Pełny suite jednostkowy**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" test:unit`
Expected: PASS — wszystkie pliki zielone (481 testów bazowych + 4 nowe w `stars.test.ts` + 1 nowy przypadek w `deck-screen.test.ts` = 486; liczy się zieleń całości, nie dokładna liczba).

- [ ] **Step 2: Typecheck**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" typecheck`
Expected: PASS bez błędów (szczególnie: brak odwołań do usuniętego `messages.kid.recalledCount`).

- [ ] **Step 3: Build (integracja Next.js z kid-ui)**

Run: `"$LOCALAPPDATA/npm-global/pnpm.cmd" build`
Expected: sukces buildu `apps/web`.

- [ ] **Step 4: verification-before-completion** — przed raportem „gotowe" przeczytaj wyniki kroków 1–3 w tym dzienniku; e2e nie uruchamiamy w tym zadaniu (czerwone na CI z przyczyn istniejących w main po #42, poza zakresem — odnotować w raporcie i w PR).

- [ ] **Step 5: requesting-code-review** — niezależny review całego zakresu gałęzi (wszystkie commity + diff `BASE_SHA..HEAD`, gdzie BASE = `da20f3f`):
  - recenzent: subagent na **najmocniejszym dostępnym modelu, z wykluczeniem rodziny GPT Astra**;
  - kontekst wg szablonu `requesting-code-review/code-reviewer.md`: cel (gwiazdki zamiast pigułki, decyzja właściciela), ścieżka planu, wyniki testów ( kroki 1–3), Review Focus: granice kid-ui/contracts, spójność skali gwiazdek z §19.1, dostępność (aria-label), brak procentów w UI dziecka, odinstalowanie pigułki (maszyna grep: `recalledCount` bez użycia);
  - uwagi zweryfikuj przez `receiving-code-review`; Critical/Important napraw przed PR (poprawki zachowania przez RED→GREEN), Minor odłóż z adnotacją.

- [ ] **Step 6: finishing-a-development-branch** — push gałęzi `feat/deck-mastery-stars` do origin, utwórz **Pull Request do `main`** (Squash and merge wykonuje **wyłącznie właściciel**); w opisie PR: cel, wynik review i obsługa uwag, wyniki weryfikacji z kroków 1–3 oraz adnotacja o pre-existing czerwonym e2e. Po PR — raport końcowy w czacie i czekanie na decyzję właściciela.
