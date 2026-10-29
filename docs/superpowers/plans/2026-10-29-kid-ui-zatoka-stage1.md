# Kid UI „Zatoka” — etap 1: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ciemny motyw „Zatoka” (morski błękit, ciepłe akcenty, Fredoka + Nunito, kafelkowe kształty, ilustracje SVG) oraz przebudowane ekrany wokół sesji: profil, zestawy, podsumowania, kartkówki, konflikt.

**Architecture:** Zmiany wyłącznie w `packages/kid-ui` (tokeny, ilustracje, wspólne komponenty, ekrany), w hostowym CSS czcionek `apps/web` i w testach. Paleta powstaje skryptem deweloperskim z `@material/material-color-utilities`; ekrany składają się z rozszerzonego `KidScreen.Header` (wariant `band`) i nowych `RowList`/`Chip`. Bez zmian API, DTO, bazy, logiki sesji i panelu rodzica.

**Tech Stack:** React 19, CSS Modules + `styles.css` (tokeny M3), Motion, Vitest + Testing Library (`renderKid`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-kid-ui-zatoka-stage1-design.md`

## Global Constraints

- Tylko ciemny motyw; `color-scheme: dark`, `data-kid-theme="night"` bez zmian; Kid UI nie reaguje na `prefers-color-scheme`.
- Literały koloru, rozmiaru fontu i promienia wyłącznie w bloku `.kid-theme,\n.kid-ui {` w `styles.css`; wyjątki: `visuals/` i nowy `illustrations/`.
- Kontrast: tekst ≥ 4,5:1, granice kontrolek i istotna grafika ≥ 3:1.
- Cele dotykowe ≥ 48 px, główna akcja ≥ 54 px; brak poziomego przepełnienia w portrait, landscape (< 480 px wysokości), tablecie, desktopie.
- Motion: tylko `transform`/`opacity`, bez `layout`; `reducedMotion="user"` zostaje.
- Bez nowych zależności produkcyjnych; jedyna nowa: `@material/material-color-utilities@0.3.0` jako devDependency w root (API `DynamicScheme`/`TonalPalette`/`MaterialDynamicColors`).
- Bez surowych `<button>`/`<input>` w `packages/kid-ui` poza wnętrzem wspólnego komponentu; bez Mantine.
- Wszystkie istniejące `data-testid` zostają; nowe dopisywane, nie zastępują starych (wyjątek: Task 7, tytuł zestawu).
- Czcionki tylko lokalnie z `/fonts/kid/`; brak Google Fonts w runtime. Pobranie plików czcionek wymaga zgody właściciela.
- Teksty UI po polsku w `messages.ts`; jedyna zmiana treści: usunięcie „ 👋” z `messages.kid.greeting`.
- Każdy task kończy się commitem z linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; bez pusha do `main`.

## Review Focus

- Bardzo długie imię dziecka lub tytuł zestawu w pasie i kartach na 320 px szerokości → tekst się łamie, nic nie wychodzi poza ekran, akcje osiągalne (Task 6 i 7: testy z długimi danymi).
- Niska wysokość (landscape telefonu 844×390) → pas nagłówka kompaktowy, pierwsza karta zestawu i akcje osiągalne przewijaniem (Task 4: tryb kompaktowy; Task 7: asercja geometrii w 844×390).
- Nieznany `avatarKey` z serwera → neutralny awatar SVG zamiast pustego miejsca (Task 3: test fallbacku).
- Zestaw z `resumeOnly` + `activeSession` lub `mockTestAvailable` na liście „Wszystkie zestawy” → drugorzędna akcja nadal dostępna, adresuje ten sam zestaw (Task 7: test akcji w wierszu).
- Wynik kartkówki bez koloru → status rozpoznawalny po ikonie i tekście odznaki (Task 9: test, że wiersz ma ikonę SVG i tekst statusu).

---

### Task 1: Paleta Zatoka i test kontrastu ról

**Files:**
- Create: `scripts/kid-palette.mjs`
- Modify: `package.json` (devDependencies), `pnpm-lock.yaml`
- Modify: `packages/kid-ui/src/styles.css` (wyłącznie blok tokenów, linie 1–114)
- Test: `tests/kid-tokens.test.ts`

**Interfaces:**
- Produces: tokeny `--kid-color-header`, `--kid-color-on-header`, `--kid-font-display`, `--kid-font-body` w bloku tokenów; zregenerowane `--md-sys-color-*`. Skala kształtu: `--kid-shape-l: 16px` (przyciski, kafelki) i `--kid-shape-xl: 20px` (karty) już istnieją; jedyna zmiana `--kid-shape-xxl: 28px → 24px`. Promień głównych przycisków i kart w `ActionButton`/kartach ma wskazywać `l`/`xl` (nie `full`) — sprawdź i popraw użycia w Task 6–9.

- [ ] **Step 1: Napisz failujące testy w `tests/kid-tokens.test.ts`**

Dodaj parser bloku tokenów (`resolveToken(name): string` rozwiązujący łańcuchy `var(--x)` w obrębie bloku do `#rrggbb`) oraz `contrast(a, b): number` (WCAG, luminancja sRGB). Testy:

```ts
it.each([
  ["on-surface", "surface"], ["on-surface", "surface-container"], ["on-surface", "surface-container-high"],
  ["on-surface-variant", "surface-container"], ["on-primary", "primary"],
  ["on-primary-container", "primary-container"], ["kid-color-on-header", "kid-color-header"],
  ["on-tertiary-container", "tertiary-container"], ["on-error-container", "error-container"],
  ["kid-color-on-warm-container", "kid-color-warm-container"],
])("text %s on %s reaches 4.5:1", (fg, bg) => expect(contrast(role(fg), role(bg))).toBeGreaterThanOrEqual(4.5));

it.each([["outline", "surface"], ["outline", "surface-container"], ["primary", "surface-container"], ["kid-color-warm", "surface-container"]])
  ("graphic %s on %s reaches 3:1", (fg, bg) => expect(contrast(role(fg), role(bg))).toBeGreaterThanOrEqual(3));

it("success differs from primary in lightness", () =>
  expect(contrast(role("tertiary"), role("primary"))).toBeGreaterThanOrEqual(1.15));

it("defines the header and font roles", () => {
  for (const name of ["--kid-color-header", "--kid-color-on-header", "--kid-font-display", "--kid-font-body"]) expect(styles).toContain(`${name}:`);
});
```

(`role("on-surface")` → `--md-sys-color-on-surface`; nazwy zaczynające się od `kid-` → `--kid-…`.)

- [ ] **Step 2: Uruchom i potwierdź porażkę**

Run: `pnpm vitest run --config vitest.unit.config.ts tests/kid-tokens.test.ts`
Expected: FAIL na „defines the header and font roles” (pozostałe mogą przejść na starej palecie).

- [ ] **Step 3: Dodaj devDependency i skrypt**

`pnpm add -D -w @material/material-color-utilities@0.3.0`. `scripts/kid-palette.mjs` buduje `new DynamicScheme({ sourceColorArgb, variant: Variant.TONAL_SPOT, contrastLevel: 0, isDark: true, primaryPalette, secondaryPalette, tertiaryPalette, neutralPalette, neutralVariantPalette })` z `TonalPalette.fromHueAndChroma`: primary H240 C40, secondary H240 C16, tertiary H150 C36, neutral H225 C10, neutral variant H225 C16, error H25 C56 (podmień `scheme.errorPalette`), warm H75 C40 (tony 80/20/30/90 jak dziś). Wypisuje na stdout gotowe linie `--md-sys-color-<rola>: #rrggbb;` dla wszystkich ról z listy `colorRoles` w `tests/kid-tokens.test.ts` oraz cztery linie `--kid-color-*warm*`. Parametry jako stałe na górze pliku.

- [ ] **Step 4: Wklej wynik do bloku tokenów**

Zastąp wartości `--md-sys-color-*` i `--kid-color-*warm*` wynikiem `node scripts/kid-palette.mjs`; zaktualizuj komentarz bloku (nowe parametry, nazwa „Zatoka”). Dodaj `--kid-color-header: var(--md-sys-color-primary-container)`, `--kid-color-on-header: var(--md-sys-color-on-primary-container)`, `--kid-font-display: KnowliKidFredoka, KnowliKidNunito, sans-serif`, `--kid-font-body: KnowliKidNunito, sans-serif`, `--kid-shape-xxl: 24px`. Gdy test kontrastu nie przechodzi, zmieniaj chroma w skrypcie i regeneruj całość — nie poprawiaj pojedynczych ról ręcznie.

- [ ] **Step 5: Uruchom testy tokenów i Kid UI**

Run: `pnpm vitest run --config vitest.unit.config.ts tests/kid-tokens.test.ts tests/kid-design-tokens.test.ts packages/kid-ui`
Expected: PASS

- [ ] **Step 6: Commit** — `feat(kid-ui): paleta Zatoka i test kontrastu ról`

### Task 2: Czcionki Fredoka i Nunito

**Files:**
- Create: `apps/web/public/fonts/kid/Fredoka.ttf`, `Nunito.ttf`, `OFL-Fredoka.txt`, `OFL-Nunito.txt`
- Delete: `apps/web/public/fonts/kid/Manrope.ttf`, `OFL.txt`
- Modify: `apps/web/src/kid-fonts.css`, `packages/kid-ui/src/theme/kid-theme.module.css:5`, `packages/kid-ui/src/styles.css` (reguły nagłówków `.kid-theme h1–h3` / `.kid-ui h1–h3` i `ActionButton` głównej akcji → `font-family: var(--kid-font-display)`)
- Test: `tests/kid-design-tokens.test.ts`

**Interfaces:**
- Consumes: `--kid-font-display`, `--kid-font-body` (Task 1).
- Produces: rodziny `KnowliKidFredoka` (wght 300–700) i `KnowliKidNunito` (wght 200–1000).

- [ ] **Step 1: Zapytaj właściciela o zgodę na pobranie** zmiennych TTF z `github.com/google/fonts` (`ofl/fredoka/Fredoka[wdth,wght].ttf`, `ofl/nunito/Nunito[wght].ttf` i ich `OFL.txt`) — podaj nazwy plików i rozmiar. Bez zgody zatrzymaj task.

- [ ] **Step 2: Napisz failujący test** w `tests/kid-design-tokens.test.ts`:

```ts
it("loads only local kid fonts", () => {
  const css = readFileSync(new URL("../apps/web/src/kid-fonts.css", import.meta.url), "utf8");
  expect(css).toContain('url("/fonts/kid/Fredoka.ttf")');
  expect(css).toContain('url("/fonts/kid/Nunito.ttf")');
  expect(css).not.toMatch(/fonts\.googleapis|Manrope/);
});
```

Run: `pnpm vitest run --config vitest.unit.config.ts tests/kid-design-tokens.test.ts` → FAIL.

- [ ] **Step 3: Pliki i `@font-face`** — zapisz pobrane pliki pod nazwami z listy, dwa bloki `@font-face` (`font-display: swap`, zakresy wag z Interfaces), `kid-theme.module.css` `.root { font-family: var(--kid-font-body) }`, nagłówki i główna akcja `var(--kid-font-display)`. Usuń Manrope.

- [ ] **Step 4: Testy** — Run jak w Step 2 + `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui` → PASS.

- [ ] **Step 5: Commit** — `feat(kid-ui): czcionki Fredoka i Nunito zamiast Manrope`

### Task 3: Ilustracje

**Files:**
- Create: `packages/kid-ui/src/illustrations/HeaderWave.tsx`, `ProfileAvatar.tsx`, `EmptyScene.tsx`, `illustrations.test.tsx`
- Modify: `tests/kid-design-tokens.test.ts` (filtr `!relative(url).startsWith("visuals/")` → także `illustrations/`)

**Interfaces:**
- Produces:
  - `HeaderWave({ className }: { className?: string }): ReactElement` — `<svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 390 40">`, ścieżka `fill="currentColor"` (kolor z CSS rodzica, bez literału).
  - `PROFILE_AVATAR_KEYS = ["fox", "bear", "cat", "dog", "owl", "rabbit"] as const`
  - `ProfileAvatar({ avatarKey, size = 72 }: { avatarKey: string; size?: number }): ReactElement` — `<svg aria-hidden="true" data-avatar={known ? avatarKey : "fallback"} width={size} height={size}>`; płaskie kształty, maks. 5 kolorów na zwierzę, czytelne na `surface-container`.
  - `EmptyScene({ className }: { className?: string }): ReactElement` — `aria-hidden`, scena „zatoka”: fala, łódka, słońce; ok. 200×120.

- [ ] **Step 1: Failujące testy w `illustrations.test.tsx`** (jsdom, `renderKid`):

```tsx
it.each(PROFILE_AVATAR_KEYS)("renders the %s avatar", (key) => {
  const { container } = renderKid(<ProfileAvatar avatarKey={key} />);
  expect(container.querySelector(`svg[data-avatar="${key}"]`)?.getAttribute("aria-hidden")).toBe("true");
});
it("falls back for an unknown avatar key", () => {
  const { container } = renderKid(<ProfileAvatar avatarKey="dragon" />);
  expect(container.querySelector('svg[data-avatar="fallback"]')).not.toBeNull();
});
it("paints the wave with the current text color", () => {
  const { container } = renderKid(<HeaderWave />);
  expect(container.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
});
```

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/illustrations` → FAIL (moduły nie istnieją).

- [ ] **Step 2: Zaimplementuj trzy komponenty** zgodnie z Interfaces; rysunki to proste ścieżki SVG (lis z makiety Zatoki jako wzór stylu).

- [ ] **Step 3: Rozszerz wyjątek w `kid-design-tokens.test.ts`** na `illustrations/`.

- [ ] **Step 4: Testy** — `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/illustrations tests/kid-design-tokens.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(kid-ui): ilustracje SVG — fala, awatary profili, pusty stan`

### Task 4: Pas nagłówka `KidScreen.Header variant="band"`

**Files:**
- Modify: `packages/kid-ui/src/layout/KidScreen.tsx`, `KidScreen.module.css`
- Test: `packages/kid-ui/src/layout/KidScreen.test.tsx`

**Interfaces:**
- Consumes: `HeaderWave` (Task 3), `--kid-color-header`/`--kid-color-on-header` (Task 1).
- Produces: `KidScreenHeaderProps.variant?: "plain" | "band"` (domyślnie `"plain"`, zachowanie jak dziś). Dla `"band"` korzeń nagłówka ma `data-kid-header="band"` i klasę `classes.band`; dzieci renderują się w środku, `<HeaderWave className={classes.wave} />` na końcu.

- [ ] **Step 1: Failujący test**

```tsx
it("renders the band header with a decorative wave", () => {
  renderKid(<KidScreen><KidScreen.Header variant="band" data-testid="hdr"><h1>Tytuł</h1></KidScreen.Header></KidScreen>);
  const header = screen.getByTestId("hdr");
  expect(header.getAttribute("data-kid-header")).toBe("band");
  expect(header.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Tytuł" })).toBeTruthy();
});
it("keeps the plain header unchanged by default", () => {
  renderKid(<KidScreen><KidScreen.Header data-testid="hdr">x</KidScreen.Header></KidScreen>);
  expect(screen.getByTestId("hdr").hasAttribute("data-kid-header")).toBe(false);
});
```

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/layout/KidScreen.test.tsx` → FAIL.

- [ ] **Step 2: Implementacja** — `.band`: tło `var(--kid-color-header)`, kolor `var(--kid-color-on-header)`, ujemne marginesy do krawędzi `.root` (`margin-inline: calc(-1 * <padding .root>)`, `margin-top: calc(-1 * max(16px, env(safe-area-inset-top)))`) i odpowiadający im padding, aby pas sięgał krawędzi i safe-area; rośnie z treścią, bez stałej wysokości i bez `overflow: hidden` na treści. `.wave`: `display: block; width: 100%; height: 24px; color: var(--kid-color-header)` pod pasem. `@media (max-height: 479px)`: mniejszy padding pasa i fala 12 px. Promienie i rozmiary tylko z tokenów.

- [ ] **Step 3: Testy** — Run jak w Step 1 → PASS.

- [ ] **Step 4: Commit** — `feat(kid-ui): wariant band nagłówka KidScreen`

### Task 5: `RowList` i `Chip`

**Files:**
- Create: `packages/kid-ui/src/components/RowList.tsx`, `RowList.module.css`, `Chip.tsx`, `Chip.module.css`, `row-list.test.tsx`

**Interfaces:**
- Produces:
  - `RowList(props: HTMLAttributes<HTMLUListElement>): ReactElement` — `<ul>` karta z separatorami `--kid-line`, promień `--kid-shape-xl`.
  - `RowListItem({ leading, title, description, trailing, below, ...li }: { leading?: ReactNode; title: ReactNode; description?: ReactNode; trailing?: ReactNode; below?: ReactNode } & LiHTMLAttributes<HTMLLIElement>): ReactElement` — siatka: leading | (title, description, below) | trailing; `min-width: 0` i łamanie tekstu w kolumnie środkowej.
  - `Chip({ tone = "neutral", icon, children, ...span }: { tone?: "neutral" | "warm"; icon?: KidIconName } & HTMLAttributes<HTMLSpanElement>): ReactElement` — `data-tone={tone}`, min-height 32 px, promień `--kid-shape-m`; warm = `--kid-color-warm-container`/`--kid-color-on-warm-container`.

- [ ] **Step 1: Failujące testy**

```tsx
it("renders rows with title, description and trailing action", () => {
  renderKid(<RowList aria-label="Zestawy"><RowListItem title="Kolory" description="10 słów" trailing={<span>→</span>} /></RowList>);
  const list = screen.getByRole("list", { name: "Zestawy" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(list.textContent).toContain("Kolory");
  expect(list.textContent).toContain("10 słów");
});
it("marks the chip tone", () => {
  renderKid(<Chip tone="warm" data-testid="c">Kartkówka: 4 lis</Chip>);
  expect(screen.getByTestId("c").getAttribute("data-tone")).toBe("warm");
});
```

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/components/row-list.test.tsx` → FAIL.

- [ ] **Step 2: Implementacja** zgodna z Interfaces; style tylko z tokenów.

- [ ] **Step 3: Testy** → PASS (to samo polecenie).

- [ ] **Step 4: Commit** — `feat(kid-ui): wspólne RowList i Chip`

### Task 6: Ekran wyboru profilu

**Files:**
- Modify: `packages/kid-ui/src/screens/ProfileScreen.tsx`, `packages/kid-ui/src/styles.css` (reguły `.kid-screen--profile`, `.kid-profile*`, `.kid-avatar`, `.kid-list` w kontekście profilu)
- Test: `packages/kid-ui/src/screens/profile-decks.test.tsx`, `tests/e2e/kid-responsive.spec.ts`

**Interfaces:**
- Consumes: `KidScreen.Header variant="band"`, `ProfileAvatar`, `EmptyScene`, `Chip`.
- Produces: kafelki `data-testid="kid-profile"` (bez zmian) w siatce `ul.kid-profile-grid`; awatar `ProfileAvatar` w miejsce emoji (`AVATARS` i `avatarOf` usunięte).

- [ ] **Step 1: Failujące testy**
  - Unit: profil z `avatarKey: "owl"` renderuje `svg[data-avatar="owl"]` w kafelku; brak emoji „🦉” w tekście; chip punktów nadal `kid-profile-points`; pusta lista → `kid-hint` i `EmptyScene` (`svg[aria-hidden]` w treści).
  - E2E (`kid-responsive.spec.ts`, nowy test „profile tiles fit portrait, landscape, tablet and desktop”): dla viewportów 360×800, 844×390, 820×1180, 1440×900 i 3 profili, w tym jednego z imieniem 40 znaków: każdy `kid-profile` ma prostokąt w granicach viewportu, wysokość ≥ 48, `scrollWidth <= innerWidth`; na 360×800 dwa kafelki w jednym rzędzie (równe `top`), na 820×1180 trzy.

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/profile-decks.test.tsx` → FAIL.

- [ ] **Step 2: Implementacja** — nagłówek `variant="band"` z `kid-top-bar` (headerActions + odsłuch) i `<h1>`; siatka `repeat(2, minmax(0,1fr))`, od 600 px 3, od 840 px 4; w `max-height: 479px` kafelek poziomy (awatar obok imienia). Kafelek: awatar 72 px, imię (`--kid-font-display`), tag nieczytającego i chip punktów pod spodem. Zachowaj `m.li` z wejściem i `whileHover`.

- [ ] **Step 3: Testy** — unit jak w Step 1, E2E: `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test tests/e2e/kid-responsive.spec.ts tests/e2e/kid-flow-screens.spec.ts` → PASS.

- [ ] **Step 4: Commit** — `feat(kid-ui): kafelki profili z awatarami w motywie Zatoka`

### Task 7: Ekran „Co dziś robimy?”

**Files:**
- Modify: `packages/kid-ui/src/screens/DeckScreen.tsx`, `packages/kid-ui/src/styles.css` (reguły `.kid-deck-*`, `.kid-daily-activity`, `.kid-greeting`, `.kid-badge`, `.kid-deck-stars`), `packages/contracts/src/messages.ts:423`
- Test: `packages/kid-ui/src/screens/profile-decks.test.tsx`, `packages/kid-ui/src/screens/deck-cover.test.tsx`, `tests/e2e/kid-decks-layout.spec.ts`

**Interfaces:**
- Consumes: wariant `band`, `RowList`/`RowListItem`, `Chip`, `IconActionButton`, `EmptyScene`.
- Produces:
  - `messages.kid.greeting = "Cześć, {name}!"`.
  - Rekomendowane: `DeckCard` (bez zmian sygnatury) jako duża karta `article[data-testid="kid-deck-card"]`.
  - Pozostałe: `DeckRow({ deck, mediaUrl, onStart, onMockTest, onEndActive, index })` w `DeckScreen.tsx` jako `RowListItem` z `data-testid="kid-deck-card"` i `data-deck-id`/`data-kind` na `<li>`; główna akcja `IconActionButton` `aria-label="Ucz się: {title}"` (lub `messages.kid.resumeSession` + tytuł dla `resumeOnly`) z `data-testid` jak dziś (`kid-deck` / `kid-resume-session`); drugorzędna (`kid-mock-start` / `kid-end-active-session`) jako `ActionButton variant="tonal" size="sm"` w `below`.
  - Tytuł: `h3[data-testid="kid-deck-title"]` zawiera tylko `deck.title`; opis (liczba słów albo przedmiot lekcji) w nowym `p[data-testid="kid-deck-meta"]`.

- [ ] **Step 1: Failujące testy**
  - Unit: oczekiwania `kid-deck-title` zawierają tylko tytuł; `kid-deck-meta` zawiera „12 słów” / przedmiot lekcji („Język angielski” w obecnym teście linii 56); wiersz zestawu z `mockTestAvailable` w sekcji „Wszystkie zestawy” ma `kid-mock-start` i wywołuje `onMockTest(deckId)` tego wiersza; `resumeOnly` + `activeSession` → `kid-end-active-session` wywołuje `onEndActive(deckId)`; główny przycisk wiersza ma nazwę dostępną „Ucz się: {title}”; brak zestawów → `kid-no-decks` + `EmptyScene`; powitanie bez „👋”.
  - E2E (`kid-decks-layout.spec.ts`): zaktualizuj asercje linii 63 i 121 do nowego podziału tytuł/meta. Nowy test „deck cards and rows fit portrait, landscape, tablet and desktop”: viewporty jak w Task 6; pas (`[data-kid-header="band"]`) zaczyna się na `top = 0` i ma szerokość viewportu (na desktopie — kontenera `.kid-ui`); każda `kid-deck-card` mieści się w poziomie; przyciski w kartach ≥ 48 px, główna akcja karty rekomendowanej ≥ 54 px; `scrollWidth <= innerWidth`; na 844×390 ostatnia karta osiągalna po `scrollIntoViewIfNeeded` i w całości w viewporcie. Długi tytuł (istniejący test linii 117) łamie się bez przycięcia.

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens` → FAIL.

- [ ] **Step 2: Implementacja** — `variant="band"`: `kid-top-bar` z `Chip` czasu (`kid-daily-activity`, ikona `calendar`), headerActions, mikrofon, odsłuch; powitanie i `<h1>`. Sekcja „Rekomendowane”: każdy rekomendowany jako `DeckCard` (etykieta sekcji w karcie, okładka 88 px, tytuł Fredoka, meta, gwiazdki `MASTERY_STAR_MAX`, `Chip tone="warm"` terminu, główna akcja pełnej szerokości, drugorzędna `variant="tonal"`). Sekcja „Wszystkie zestawy”: `RowList` z `DeckRow`. Od 840 px dwie kolumny kart rekomendowanych w granicach kontenera. Autofocus pierwszej głównej akcji jak dziś.

- [ ] **Step 3: Testy** — unit (Step 1) i `UMIEM_E2E_WEB_MODE=dev pnpm exec playwright test tests/e2e/kid-decks-layout.spec.ts tests/e2e/kid-flow-screens.spec.ts tests/e2e/kid-responsive.spec.ts` → PASS.

- [ ] **Step 4: Commit** — `feat(kid-ui): ekran zestawów Zatoka — karty rekomendowane i lista`

### Task 8: Podsumowanie sesji

**Files:**
- Modify: `packages/kid-ui/src/screens/SummaryScreen.tsx`, `SessionActivityResultView.tsx`, `packages/kid-ui/src/styles.css` (`.kid-summary-*`)
- Test: `packages/kid-ui/src/screens/summary-states.test.tsx`, `reward-summary.test.tsx`, `tests/e2e/kid-flow-screens.spec.ts`

**Interfaces:**
- Consumes: wariant `band`, `RowList`, `Chip`.
- Produces: kafelki liczników `kid-summary-recall` / `kid-summary-spelling` (testid bez zmian) z elementem `.kid-stat__value` (liczba) i `.kid-stat__label`; `kid-summary-reward` jako `Chip` z `role="status"` bez zmian treści.

- [ ] **Step 1: Failujące testy** — unit: `kid-summary-recall` zawiera osobny element z liczbą `3` i podpis z „Samodzielne przypominanie”; lista „Jeszcze poćwiczymy” i cele lekcji renderują się jako `RowList` (role `list`, nazwa z nagłówka); przy zerowych sukcesach nadal `kid-summary-neutral` i brak kafelków. E2E: istniejące „long session summary…” i „dark session summary…” przechodzą; dodaj asercję, że `kid-again` ≥ 54 px i `[data-kid-header="band"]` istnieje.

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/summary-states.test.tsx packages/kid-ui/src/screens/reward-summary.test.tsx` → FAIL.

- [ ] **Step 2: Implementacja** zgodnie z Interfaces; `CelebrationBurst` wokół `<h1>` jak dziś.

- [ ] **Step 3: Testy** → PASS (unit + `kid-flow-screens.spec.ts` w trybie dev).

- [ ] **Step 4: Commit** — `feat(kid-ui): podsumowanie sesji z kafelkami wyników`

### Task 9: Kartkówki i konflikt sesji

**Files:**
- Modify: `packages/kid-ui/src/screens/MockTestSummaryScreen.tsx`, `LessonMockTestSummaryScreen.tsx`, `mock-test-score.ts` (`MOCK_TEST_SOLUTION_ICONS` → `Record<MockTestWordStatus, KidIconName>`: `check`, `close`, `question`), `packages/kid-ui/src/styles.css` (`.kid-mock-*`, `.kid-conflict-*`)
- Test: `packages/kid-ui/src/screens/mock-test-views.test.tsx`, `mock-test-score.test.ts`, `tests/e2e/kid-flow-screens.spec.ts`

**Interfaces:**
- Consumes: wariant `band`, `RowList`/`RowListItem`, `Chip`, `IconActionButton`, `EmptyScene`, `KidIcon`.
- Produces: wiersze `kid-mock-solution` / `kid-lesson-mock-solution` (testid i `data-status` bez zmian) jako `RowListItem`: `leading` = `KidIcon` statusu w kafelku w kolorze roli statusu, `title` = `source → target`, `below` = odznaki; odsłuch jako `IconActionButton` `aria-label={messages.kid.listen}`; inline `style={{ color: "var(--kid-wrong)" }}` alertów zastąpione klasą `kid-alert`. `MockTestReadyScreen`: `kid-mock-budget` jako kafelek z dużą liczbą `session.taskBudget`. `SessionConflictScreen`: `EmptyScene` nad `kid-conflict-info`.

- [ ] **Step 1: Failujące testy** — unit: wiersz każdego statusu zawiera `svg` ikony i tekst odznaki (status rozpoznawalny bez koloru); `MOCK_TEST_SOLUTION_ICONS.correct === "check"`; odsłuch ma nazwę „Posłuchaj” (`messages.kid.listen`) i rozmiar przez `IconActionButton`; `kid-mock-budget` zawiera liczbę z `taskBudget`; konflikt renderuje ilustrację i oba przyciski. E2E: istniejące „mock-test ready…”, „session conflict…”, „mock-test summary…” przechodzą; dodaj asercję cele ≥ 48 px w wierszach rozwiązań i brak poziomego przepełnienia na 360×800.

Run: `pnpm vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/mock-test-views.test.tsx packages/kid-ui/src/screens/mock-test-score.test.ts` → FAIL.

- [ ] **Step 2: Implementacja** zgodnie z Interfaces.

- [ ] **Step 3: Testy** → PASS (unit + `kid-flow-screens.spec.ts`, `lesson-kid.spec.ts` w trybie dev).

- [ ] **Step 4: Commit** — `feat(kid-ui): kartkówki i konflikt sesji w motywie Zatoka`

### Task 10: Weryfikacja całości i PR

**Files:**
- Modify (tylko jeśli testy wykażą regresję w zadaniach etapu 2): reguły w `packages/kid-ui/src/styles.css` korzystające z tokenów — bez zmian układu zadań.

- [ ] **Step 1: Zrzuty do przeglądu** — w `kid-flow-screens.spec.ts` i `kid-answer-contrast.spec.ts` zapisuj `page.screenshot` ekranów etapu 1 do `testInfo.outputPath(...)` (wzór: linia 103 `kid-answer-contrast.spec.ts`).
- [ ] **Step 2: Pełne sprawdzenie** — Run kolejno: `pnpm typecheck`, `pnpm test:unit`, `pnpm build`, `pnpm test:e2e:shards`. Expected: wszystko PASS (247+ testów E2E). Regresje kontrastu lub geometrii w ćwiczeniach naprawiaj tokenami, nie zmianą układu.
- [ ] **Step 3: Przejrzyj zrzuty** ekranów etapu 1 i 2–3 ekranów zadań (np. listening, recall) pod kątem czytelności ilustracji i palety; wyślij je właścicielowi.
- [ ] **Step 4: PR** — gałąź `claude/kid-ui-redesign-75509a`, tytuł „Kid UI Zatoka — etap 1: język wizualny i ekrany wokół sesji”. Opis: zmiany, link do specu, wpływ API → MCP → skill: brak (bez zmian endpointów, DTO i znaczenia danych), wykonane sprawdzenia z wynikami, jawnie niezweryfikowane: fizyczny telefon/tablet. Stopka `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Nie scalaj.
