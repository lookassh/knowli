# Wyświetlanie liczb jako cyfr zamiast ilustracji z jabłkami — Plan Implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wyświetlać liczby w interfejsie dziecka jako czytelne, duże cyfry SVG zamiast ilustracji z jabłkami we wszystkich widokach oraz rozszerzyć obsługę liczb o liczbę 0 (zero).

**Architecture:** Uprościć komponent `NumberVisual` do renderera SVG tekstu z cyfrą (`kid-visual-number kid-visual-number--digit`), usuwając kod rysowania jabłek przy zachowaniu kompatybilności interfejsu. W kontraktach (`@learning/contracts`) oraz schematach Zod rozszerzyć dopuszczalny zakres liczb z 1–50 na 0–50, dodać `zero: 0` do słownika liczb angielskich i zaktualizować walidację oraz prompt LLM.

**Tech Stack:** React, TypeScript (strict), Zod, Vitest, Node.js.

**Spec:** `docs/superpowers/specs/2026-10-16-display-numbers-as-digits-design.md`

## Global Constraints

- Zachować nazewnictwo i strukturę pakietów w monorepo (`packages/contracts`, `packages/kid-ui`, `packages/server`).
- Zachować polski język interfejsu użytkownika (`pl-PL`), etykiety dostępności (`aria-label`) oraz komunikaty dla dziecka.
- Nie wprowadzać zewnętrznych bibliotek; renderer opiera się na czystym SVG i stylach CSS projektu.
- Zapewnić kompatybilność wsteczną dla parametrów komponentu `NumberVisual` (`display?: "apples" | "digit"`).
- Nie modyfikować niezwiązanych elementów bazy danych ani innych typów wizualizacji (`image`, `color`, `sequence`).

## Review Focus

1. Liczba `0` jako wartość falsy: upewnić się, że `0` nie jest traktowane jako brak wartości w `NumberVisualDataSchema`, `knownEnglishNumber` (`exact !== undefined`), `MeaningVisualSchema` oraz `countValue` w `Visual.tsx`.
2. Centrowanie i czytelność liczb 1- i 2-cyfrowych (np. `0`, `2`, `11`, `20`, `50`): zweryfikować atrybuty `x="80"`, `y="84"`, `textAnchor="middle"` oraz brak obcinania tekstu w `viewBox="0 0 160 120"`.
3. Spójność we wszystkich widokach: `MeaningVisualView` (używane w ekspozycji, mowie, powtórce, odsłuchu, okładkach) oraz `Visual` generują ten sam element SVG cyfry.
4. Etykiety dostępności: `formatVisualCountLabel(0)` zwraca poprawną polską formę gramatyczną ("0 elementów") dla czytników ekranu.
5. Poprawność walidacji generowania i edytora: upewnić się, że `isVisualDataValid("number", { count: 0 }, "zero")` oraz `isVisualDataValid("number", { count: 0 }, "0")` zwracają `true`.

---

### Task 1: Kontrakty i walidacja liczb od 0 do 50

**Files:**
- Modify: `packages/contracts/src/decks.ts:87-175`
- Modify: `packages/contracts/src/kid.ts:54-59`
- Test: `packages/contracts/src/kid-picture.test.ts`
- Test: `packages/contracts/src/decks.test.ts`

**Interfaces:**
- Consumes: brak.
- Produces:
  - `NumberVisualDataSchema`: Zod schema akceptujący `count` jako liczbę całkowitą od 0 do 50 (`min(0).max(50)`).
  - `MeaningVisualSchema`: unia dyskryminowana akceptująca `{ kind: "number", count: number }` z `count` od 0 do 50.
  - `ENGLISH_NUMBER_VALUES`: słownik zawierający wpis `zero: 0`.
  - `isVisualDataValid(visualType, visualData, target)`: walidacja akceptująca `visualType: "number"` z `count: 0` dla `target: "zero"` lub `"0"`.

- [ ] **Step 1: Napisać test weryfikujący obsługę liczby 0 w kontraktach**

Dodać do `packages/contracts/src/kid-picture.test.ts` oraz `packages/contracts/src/decks.test.ts` asercje sprawdzające:
```typescript
expect(NumberVisualDataSchema.safeParse({ count: 0 }).success).toBe(true);
expect(MeaningVisualSchema.safeParse({ kind: "number", count: 0 }).success).toBe(true);
expect(isVisualDataValid("number", { count: 0 }, "zero")).toBe(true);
expect(isVisualDataValid("number", { count: 0 }, "0")).toBe(true);
expect(isVisualDataValid("number", { count: -1 }, "zero")).toBe(false);
```

- [ ] **Step 2: Uruchomić test i potwierdzić, że nie przechodzi (FAIL)**

Run: `corepack pnpm vitest run packages/contracts/src/kid-picture.test.ts`
Expected: FAIL z powodu błędu walidacji `count >= 1`.

- [ ] **Step 3: Zaktualizować schematy i funkcje w `packages/contracts`**

W `packages/contracts/src/decks.ts`:
- Zmienić `NumberVisualDataSchema` na `z.number().int().min(0).max(50)`.
- W `ENGLISH_NUMBER_VALUES` dodać wpis `zero: 0`.
- W `knownEnglishNumber` zmienić warunek numeryczny na `numeric >= 0 && numeric <= 50`.

W `packages/contracts/src/kid.ts`:
- W `MeaningVisualSchema` zmienić gałąź `number` na `count: z.number().int().min(0).max(50)`.

- [ ] **Step 4: Uruchomić testy kontraktów i potwierdzić, że przechodzą (PASS)**

Run: `corepack pnpm vitest run packages/contracts/src/kid-picture.test.ts packages/contracts/src/decks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/decks.ts packages/contracts/src/kid.ts packages/contracts/src/kid-picture.test.ts packages/contracts/src/decks.test.ts
git commit -m "feat(contracts): allow number visual count to be zero"
```

---

### Task 2: Wyświetlanie liczb jako cyfr w Kid UI

**Files:**
- Modify: `packages/kid-ui/src/visuals/NumberVisual.tsx`
- Modify: `packages/kid-ui/src/visuals/Visual.tsx:15-20`
- Test: `packages/kid-ui/src/visuals/NumberVisual.test.ts`
- Test: `packages/kid-ui/src/visuals/Visual.test.ts`

**Interfaces:**
- Consumes: `NumberVisualDataSchema` i `MeaningVisualSchema` z Task 1 (`count: 0..50`).
- Produces:
  - `NumberVisual({ count, label, display }: { count: number; label: string; display?: "apples" | "digit" }): ReactElement` — komponent SVG renderujący wyśrodkowaną dużą cyfrę/liczbę (`<text x="80" y="84" ...>{count}</text>`) z klasą `kid-visual-number kid-visual-number--digit`.
  - `Visual({ text, visualType, visualData })` — komponent wspierający `count: 0`.

- [ ] **Step 1: Zaktualizować testy jednostkowe w `NumberVisual.test.ts` i `Visual.test.ts`**

W `packages/kid-ui/src/visuals/NumberVisual.test.ts`:
- Usunąć asercje sprawdzające rysowanie jabłek (`kid-number-apple`) i ich rozmieszczenie.
- Dodać testy sprawdzające, że dla liczb `[0, 1, 2, 10, 11, 20, 50]` renderowany jest SVG z:
  - `viewBox="0 0 160 120"`, `role="img"`, `className` zawierającym `kid-visual-number` oraz `kid-visual-number--digit`.
  - Elementem `<text>` o atrybutach `x="80"`, `y="84"`, `textAnchor="middle"` i zawartości równej danej liczbie.
  - Prawidłową etykietą `aria-label` (w tym dla 0: `"0 elementów"`).

W `packages/kid-ui/src/visuals/Visual.test.ts`:
- Dodać test potwierdzający, że `Visual({ text: "Zero", visualType: "number", visualData: { count: 0 } })` zwraca komponent `NumberVisual` z `count: 0`.

- [ ] **Step 2: Uruchomić testy i potwierdzić, że nie przechodzą (FAIL)**

Run: `corepack pnpm vitest run packages/kid-ui/src/visuals/NumberVisual.test.ts packages/kid-ui/src/visuals/Visual.test.ts`
Expected: FAIL z powodu brakującej obsługi 0 i niezgodności renderera z nowymi asercjami.

- [ ] **Step 3: Zaimplementować renderowanie cyfr w `NumberVisual.tsx` i `Visual.tsx`**

W `packages/kid-ui/src/visuals/NumberVisual.tsx`:
- Usunąć funkcję `columnsForCount` i kod generujący jabłka.
- Zwracać element SVG z klasą `kid-visual kid-visual-number kid-visual-number--digit` oraz elementem `<text>` wyświetlającym `{count}`.
- Zachować `display?: "apples" | "digit"` w sygnaturze dla kompatybilności wstecznej.

W `packages/kid-ui/src/visuals/Visual.tsx`:
- Zaktualizować funkcję `countValue`: warunek `count >= 0 && count <= 50`.

- [ ] **Step 4: Uruchomić testy i potwierdzić, że przechodzą (PASS)**

Run: `corepack pnpm vitest run packages/kid-ui/src/visuals/NumberVisual.test.ts packages/kid-ui/src/visuals/Visual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kid-ui/src/visuals/NumberVisual.tsx packages/kid-ui/src/visuals/Visual.tsx packages/kid-ui/src/visuals/NumberVisual.test.ts packages/kid-ui/src/visuals/Visual.test.ts
git commit -m "feat(kid-ui): display numbers as digits instead of apples"
```

---

### Task 3: Prompt LLM i test integracyjny zestawu obrazkowego 0–20

**Files:**
- Modify: `packages/server/src/providers/openai/llm.ts:69`
- Modify: `tests/integration/picture-vocabulary.test.ts:83-93`

**Interfaces:**
- Consumes: Task 1 i Task 2.
- Produces:
  - Spójny prompt generowania AI wspierający liczby 0–50.
  - Zaktualizowany test integracyjny słownictwa obrazkowego tworzący pełny zestaw 0–20 wyłącznie z `visualType: "number"`.

- [ ] **Step 1: Zaktualizować test integracyjny `picture-vocabulary.test.ts`**

W `tests/integration/picture-vocabulary.test.ts`:
- W teście `liczby 0–20: losuje nextTask, utrwala issued i kończy przebieg` zastąpić warunek `index === 0 ? image : number` bezpośrednim:
```typescript
visualType: "number" as const,
visualData: { count: index },
```
dla wszystkich indeksów 0–20 (włącznie z 0).

- [ ] **Step 2: Zaktualizować prompt systemowy LLM w `llm.ts`**

W `packages/server/src/providers/openai/llm.ts`:
- Zmienić fragment instrukcji z:
  `For number use {count: integer 1-50};`
  na:
  `For number use {count: integer 0-50};`

- [ ] **Step 3: Uruchomić test integracyjny i potwierdzić, że przechodzi (PASS)**

Run: `corepack pnpm vitest run tests/integration/picture-vocabulary.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/providers/openai/llm.ts tests/integration/picture-vocabulary.test.ts
git commit -m "feat(server): support zero in picture vocabulary numbers and llm prompt"
```

---

### Task 4: Weryfikacja całościowa i typy

**Files:**
- Test: weryfikacja całościowa (`tests/e2e/picture-choice-layout.spec.ts` jeśli dotyczy)

**Interfaces:**
- Consumes: Wszystkie poprzednie zadania.
- Produces: Zweryfikowane, czyste repozytorium bez błędów typowania i regresji.

- [ ] **Step 1: Uruchomić kontrolę typów TypeScript**

Run: `corepack pnpm typecheck`
Expected: PASS bez błędów.

- [ ] **Step 2: Uruchomić powiązane testy jednostkowe**

Run: `corepack pnpm vitest run packages/kid-ui/src/visuals packages/contracts/src/decks.test.ts packages/contracts/src/kid-picture.test.ts`
Expected: All test suites PASS.

- [ ] **Step 3: Commit (jeśli wystąpiły zmiany porządkowe)**

```bash
git status
```
Upewnić się, że drzewo robocze jest czyste lub zapisać ewentualne poprawki typów.
