# Kid UI Mantine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wdrożyć zaakceptowany wariant A makiety Mantine we wszystkich istniejących ekranach dziecka Umiem!, zachowując produkcyjne zachowanie i responsywność.

**Architecture:** Przenośny `packages/kid-ui` otrzymuje jeden provider Mantine, tokeny i komponenty prezentacji. `KidPage` nadal jako jedyny mierzy viewport; `KidScreen` i dotychczasowy `ExerciseFrame` dzielą przestrzeń na stabilne sloty. Istniejący kontroler sesji, kontrakty i adaptery pozostają źródłem zachowania oraz danych.

**Tech Stack:** React/React DOM 19.3.0 z istniejącego lockfile, TypeScript strict, Mantine core/hooks 9.7.3, CSS Modules, Next.js App Router jako host, pnpm 10.34.6, Vitest 4, Playwright.

**Spec:** `.planning/kid-ui-mantine/PLAN.md` — wymagania i kryteria ustalone z właścicielem, zwłaszcza §2, §6 i §7. Ten dokument zastępuje jego ogólny podział etapów szczegółową instrukcją wykonania. Czytać oba. Dokumenty domenowe: `docs/architecture.md` §5 i §19; `docs/SPEC.md` sekcje wskazane w §9 specyfikacji.

## Global Constraints

- „Kliknięcie odpowiedzi/kafelka natychmiast wysyła odpowiedź.” Nie dodawać `Sprawdź` ani lokalnego bufora wyboru dla wyborów, także w lekcjach i kartkówkach.
- „Werdykt pochodzi wyłącznie z API.” Wybrany kafelek przed odpowiedzią serwera ma stan `pending`, nigdy `correct`/`wrong`.
- „Touch co najmniej 44 × 44”; dla głównej akcji normalna wysokość 54 px. Tekst i zoom 200% mają pozostawiać treść oraz akcje osiągalne.
- Macierz: 360 × 640, 360 × 760, widoczna wysokość 320–420 px, 768 × 1024, 1440 × 960. Symulacja nie jest odbiorem Galaxy S10e.
- „Nie zastępujemy tego bezwarunkowym `height: 100vh`, globalnym `overflow: hidden` ani mechanizmem z demonstracji.” Jedyny pomiar: `layout/viewport.ts`; zoom → istniejący `flow`.
- „Podsumowanie pojawia się od razu.” Odczyt aktywności nie blokuje nawigacji; wynik związany z `sessionId` i `childId`, bez kolejnego raportu POST po resize/rerenderze.
- „Brak danych nie oznacza zera.” Zachować #113: 125 s → `2 min 5 s`, 0 → `0 s`, brak/niedostępność → `—`.
- „Kid UI nie importuje Next.js, Server Actions, bazy ani kodu serwerowego.” Zachować `KidApi`, konfigurowalny `baseUrl`, media i preferences.
- Polski interfejs `pl-PL`, nazwa `Umiem!`, wszystkie nowe teksty w `packages/contracts/src/messages.ts`. Materiał nadal `pl-PL` → `en-GB`.
- Bez zmian API, DTO, bazy, schedulera, ujawnień, ocen i punktów. Jeśli okażą się konieczne, opisać konflikt i przerwać zależną część; wrócić do API → MCP → skill.
- Nie przenosić z galerii lokalnego oceniania, przykładowych danych, nagrywania, kontroli wariantów/viewportu, stałego budżetu ani dekoracji zastępujących znaczenie ilustracji.
- Nie zmieniać panelu rodzica, makiet Flutter, innych worktree ani procesów na 4178/5178/5180. Nie wykonywać push, PR, merge ani deploy.
- Zmiany tylko na lokalnym `feature/kid-ui-mantine` w `C:/Users/looka/.codex/worktrees/kid-ui-mantine/knowli`; baza `c8758e8827c2045c4af3872be32ecdbe84aed8a1`. Nie tworzyć następnego worktree i nie przełączać wspólnego checkoutu.

## Review Focus

1. Stylesheet dziecka pozostaje po nawigacji klientowej: panel rodzica ma identyczne style i brak zmiany `html` color scheme — Task 1.
2. Długi tekst, klawiatura i zoom: wpis nie znika, focus zostaje, obie akcje są osiągalne; stała geometria dotyczy niezmienionego viewportu — Tasks 2 i 5.
3. Szybkie dwa tapnięcia/klawisz w oczekiwaniu i awaria sieci: jedna próba, neutralny pending, brak lokalnego sukcesu — Tasks 3 i 4.
4. Odmowa mikrofonu, pointercancel i zmiana profilu podczas nagrania: pełna ścieżka bez mikrofonu i zwolnienie streamu — Task 7.
5. Oczekujący wynik aktywności po przełączeniu dziecka: podsumowanie dostępne od razu, brak cudzych punktów i powtórzonego POST — Task 11.

---

## Przed pierwszym zadaniem

Polecenia wykonuj w powyższym worktree, w PowerShell, pojedynczo. Nie traktuj oczekiwanego wyniku poniżej jako wykonanego testu.

```powershell
git branch --show-current
git status --short
Test-Path node_modules
Test-Path .env
```

Oczekiwana gałąź `feature/kid-ui-mantine`. Zależności i `.env` już istnieją; nie instalować ponownie przed zmianą manifestów. Jeśli `.env` zniknął: `node scripts/setup-worktree.cjs --skip-install`, bez odczytywania sekretów. Zmiany niezwiązane zachować. Dotychczasowy szybki baseline: 13/13 testów `viewport.test.ts` + `option-outcome.test.ts`; nie odpalaj pełnego E2E jako kolejnego baseline.

Referencja wizualna, źródła dostępne lokalnie bez działającego serwera:

`C:/Users/looka/.codex/worktrees/0f7c/knowli/.planning/sketches/002-kid-mantine-flutter`

Czytaj `src/catalog.ts`, `theme.ts`, `KidScreen.tsx`, `KidScreen.module.css`, `FlowScreens.tsx`, `TaskPanel.tsx`, `styles.css`. Tylko wariant A. Nie importuj tych plików do runtime. Jeśli katalog niedostępny, zgłoś brak referencji zamiast projektować inny wygląd. Wartości ustalone: tło `#080d1c`, powierzchnia `#17223d`, obramowanie `#2c3d5e`, akcent `#8dd5ff`, tekst `#f0f5ff`, przygaszony tekst `#afbed8`, promień karty 26 px, przycisku głównego 18 px, pola 16 px; Manrope 200–800 z lokalnego TTF + OFL.

Nie twórz `Question` jako uniwersalnego komponentu z nową logiką typów zadań. Bodźce pozostają w istniejących widokach i `MeaningVisualView`. Nie dodawaj `ProfileCard` ani kolejnych wrapperów, dopóki konkretne zadanie ich nie potrzebuje. Publiczny barrel już eksportuje **typ** `KidScreen` z kontrolera; wizualny `KidScreen` importuj wewnętrznie z `layout/KidScreen`, bez kolidującego eksportu z `index.ts`.

## Mapa plików i odpowiedzialności

Wszystkie ścieżki poniżej względem repo. Lista jest wiążąca; nie tworzyć równoległego UI.

| Plik / grupa | Odpowiedzialność | Task |
|---|---|---|
| `packages/kid-ui/src/theme/kid-theme.ts` | Tokeny i `createTheme`, wariant A | 1 |
| `theme/KidThemeProvider.tsx`, `kid-theme.module.css`, `mantine.css` | Wrapper, scope zmiennych/resetu i niezbędne style vendor | 1 |
| `apps/web/public/fonts/kid/Manrope.ttf`, `OFL.txt` | Self-hostowane oryginalne pliki z referencji | 1 |
| `packages/kid-ui/src/test/render-kid.tsx`, `exercise-fixtures.ts` | Prawdziwy render testowy, poprawne propsy zadań, wyłącznie testy | 1, 3 |
| `layout/KidScreen.tsx`, `KidScreen.module.css` | Compound layout i Styles API, bez pomiaru okna | 2 |
| `layout/KidPage.tsx`, `viewport.ts` | Istniejący viewport; bez zmiany algorytmu | 2 |
| `components/ActionButton.tsx`, `AnswerField.tsx` | Przyciski i pola zgodne z natywnym form/ref | 3 |
| `components/AnswerGrid.tsx`, `AnswerGrid.module.css` | Siatka i semantyka opcji; kafelek prywatny w tym pliku | 3 |
| `components/SessionProgress.tsx` | Wyłącznie prawdziwe remaining, bez wymyślonego procentu | 4 |
| `exercises/ExerciseFrame.tsx` | Adapter istniejących propsów do compound layoutu | 4 |
| `screens/LearnScreen.tsx` | Pasek/status, obecny routing i handlery | 4, 7 |
| `exercises/*View.tsx`, `exercises/lesson/*View.tsx` | Istniejące bodźce, przejścia i formularze w Mantine | 4–9 |
| `screens/*Screen.tsx`, `SessionActivityResultView.tsx` | Profile, zestawy, kartkówki, podsumowania i stany | 9–11 |
| `packages/kid-ui/src/styles.css` | W czasie migracji kompatybilność, potem tylko używane style | 1–12 |
| `apps/web/src/kid/KidLearningHost.tsx`, `apps/web/next.config.ts` | Hostowe fonty/style i modularne importy Mantine | 1 |
| `packages/kid-ui/src/KidApp.tsx` | Jeden provider dla wszystkich gałęzi; bez nowego hooka sesji | 1, 11 |
| `tests/e2e/kid-mantine-theme.spec.ts`, `kid-mantine-responsive.spec.ts` | Izolacja i brakujące regresje geometrii | 1, 2, 12 |
| `docs/architecture.md`, `docs/folder-structure.md` | Stan po migracji, ograniczenia i kontrakt komponentów | 12 |

Warianty danych/fixture z istniejących testów mają pierwszeństwo przed tworzeniem nowych. Nie eksportować lokalnych helperów z istniejącego pliku `.spec.ts`; jeśli potrzebne drugi raz, przenieść do `tests/e2e/helpers/` i zachować oba zastosowania.

## Task 1: Motyw Mantine działający w KidApp bez wpływu na rodzica

**Files:**
- Create: `packages/kid-ui/src/theme/{KidThemeProvider.tsx,kid-theme.ts,kid-theme.module.css,mantine.css}`
- Create: `packages/kid-ui/src/test/render-kid.tsx`, `packages/kid-ui/src/theme/KidThemeProvider.test.tsx`, `tests/e2e/kid-mantine-theme.spec.ts`
- Create: `apps/web/public/fonts/kid/{Manrope.ttf,OFL.txt}`, `packages/kid-ui/src/styles.d.ts`
- Modify: root `package.json`, `pnpm-lock.yaml`, `packages/kid-ui/package.json`, `packages/kid-ui/src/{KidApp.tsx,styles.css}`, `apps/web/src/kid/KidLearningHost.tsx`, `apps/web/next.config.ts`

**Interfaces:**
- Consumes: dotychczasowy kontrakt `KidApp` bez zmiany jego propsów; assety/font referencji A.
- Produces: `kidTheme: MantineThemeOverride`; `kidTokens` z powyższymi kolorami; `KidThemeProvider({ children }: { children: ReactNode }): ReactElement`.
- Produces (test only): `renderKid(ui: ReactElement): RenderResult` z `@testing-library/react`, otaczający UI tym samym providerem; re-eksport `screen`, `fireEvent`, `cleanup`, `act` z testing-library. Każdy plik DOM ma `// @vitest-environment jsdom` i `afterEach(cleanup)`.

- [x] **Step 1: Dodaj manifesty i testy kontraktu motywu.** Przypnij core/hooks `9.7.3` w dependencies kid-ui; peer react i react-dom `^19.2.0`, dev oba `19.3.0`, typy React DOM zgodne z istniejącym web. Root dev: `@testing-library/react@16.3.0`, `@testing-library/dom@10.4.1`, `jsdom@26.1.0`. Do aktualizacji lock użyj `corepack pnpm --filter @learning/kid-ui add --save-exact @mantine/core@9.7.3 @mantine/hooks@9.7.3` oraz `corepack pnpm add -Dw --save-exact @testing-library/react@16.3.0 @testing-library/dom@10.4.1 jsdom@26.1.0`; po edycji peer/dev React zsynchronizuj lock `corepack pnpm install --lockfile-only --prefer-offline`, a właściwą instalację wykonaj wyłącznie `corepack pnpm install --prefer-offline --frozen-lockfile`. Nie zmieniaj środowiska node całego Vitest. Test `KidThemeProvider.test.tsx`:

```tsx
it('scopes dark scheme without changing document root', () => {
  const before = document.documentElement.getAttribute('data-mantine-color-scheme');
  const { container, unmount } = renderKid(<button>Próba</button>);
  expect(container.querySelector('.kid-theme')?.getAttribute('data-mantine-color-scheme')).toBe('dark');
  expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe(before);
  unmount();
  expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe(before);
});
```

Test przeglądarkowy: otwórz `/parent` bez logowania, zapisz computed `body` oraz `auth-secret` (font, background, color, border, padding, lineHeight) i atrybut scheme na html. Przejdź istniejącym `to-learning`, sprawdź `.kid-theme` i prawdziwy link do rodzica, wróć linkiem. Oczekuj identycznych zapisanych stylów; dodatkowo wykonaj powrót historią przeglądarki, aby pokryć pozostające arkusze CSS. Nie loguj/snapshotuj danych rodziny.

- [x] **Step 2: Uruchom RED.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/theme/KidThemeProvider.test.tsx` — FAIL przez brak modułu providera. Następnie `corepack pnpm exec playwright test tests/e2e/kid-mantine-theme.spec.ts` — nowa asercja obecności motywu ma FAIL. Błąd Docker/startu nie jest RED.

- [x] **Step 3: Wdroż provider, scope i font.** W `KidApp.tsx` wydziel dotychczasowe ciało jako prywatny `KidAppContent` z tymi samymi propsami i jednym `useLearningSession`; publiczny `KidApp` otacza je providerem. Bez zmiany kluczy/remountu. Provider: stabilny ref wrappera `.kid-theme`, `forceColorScheme="dark"`, `cssVariablesSelector=".kid-theme"`, `getRootElement={() => ref.current ?? undefined}`, `deduplicateCssVariables={false}`; atrybut dark także w początkowym JSX wrappera (SSR). Nie dodawaj globalnego ColorSchemeScript ani providera w root Next.

CSS: **nie importuj `@mantine/core/styles.css` ani nieskopowanych trzech bazowych arkuszy**. Niezbędne reguły baseline i global utwórz scoped pod `.kid-theme` (box sizing, font form controls, scheme utilities, focus, reduced motion); CSS variables generuje provider wyłącznie na `.kid-theme`, więc nie przenoś arkusza z `:root`. Importuj oficjalne, faktycznie używane arkusze komponentów z `@mantine/core/styles/{Component}.css` (w 9.7.3 pliki są bezpośrednio w `styles/`, nie `styles/components/`); `Textarea` używa stylów `Input.css`, oddzielny `Textarea.css` nie istnieje. Wszystkie modyfikacje wyglądu przez CSS Modules/Styles API, żadnych globalnych nadpisań klas Mantine. Portali na tym etapie nie używamy; przyszłe tooltip/popover w tej migracji `withinPortal={false}`. Bez nowego narzędzia do transformacji CSS.

`kid-theme.module.css` definiuje scoped reset/form fonts/focus i dark color-scheme, wrapper nie otrzymuje sztywnej wysokości. Font w hostowym CSS `@font-face` pod unikalnym `KnowliKidManrope`, URL `/fonts/kid/Manrope.ttf`, weight 200 800, display swap; provider ma fallback sans-serif. `styles.css` ładuje nową bazę przed starym CSS; nowe komponenty mają własne moduły. Nie zmieniaj kolorów starych rodzicielskich selektorów. Testy DOM uzupełnij o testowe `matchMedia`/`ResizeObserver` tylko jeśli potrzebne; bez mockowania `useState`, `useStyles` lub samego providera.

`styles.d.ts` deklaruje `module '*.module.css'` z domyślnym eksportem `Readonly<Record<string,string>>`, aby samodzielny typecheck kid-ui działał bez typów Next. Nie dodawaj `next-env.d.ts` do przenośnego pakietu. Jeśli runtime/test importuje zwykłe `.css` i TypeScript tego wymaga, dodaj osobną deklarację side-effect `module '*.css'`. Ustaw w istniejącym `apps/web/next.config.ts` `experimental.optimizePackageImports: ['@mantine/core','@mantine/hooks']`, zgodnie z oficjalnym przewodnikiem Mantine Next, by nie ładować nieużywanych eksportów z barrelów.

- [x] **Step 4: Sprawdź GREEN.** Oba polecenia z Step 2 PASS; `corepack pnpm why react react-dom` nie pokazuje nowej odrębnej wersji React; `corepack pnpm typecheck`, `corepack pnpm build` PASS, bez hydration errors. Jeśli React duplikuje się, wyrównaj deklaracje do lock zamiast używać overrides ukrywających konflikt. Wyniki: `KidThemeProvider.test.tsx` 1/1, theme Playwright 1/1 (link i historia), pełny typecheck PASS, produkcyjny build PASS.
- [x] **Step 5: Commit.** Dodaj wyłącznie pliki z Files i nowe testy: `git commit -m "feat(kid-ui): add scoped Mantine night theme"`. Niezależny review GPT‑6.1 Sol/medium zatwierdził poprawki kolejności CSS i lokalizacji providera; brak dalszych P0–P2.

## Task 2: KidScreen z jawnymi slotami i jednym właścicielem viewportu

**Files:**
- Create: `packages/kid-ui/src/layout/{KidScreen.tsx,KidScreen.module.css,KidScreen.test.tsx}`
- Create: `tests/e2e/kid-mantine-responsive.spec.ts`
- Modify: `packages/kid-ui/src/layout/KidPage.tsx` wyłącznie jeśli potrzebny scope/class, bez zmiany pomiarów; `tests/e2e/kid-layout-stability.spec.ts` w Task 4.

**Interfaces:**
- Consumes: provider z Task 1; istniejące `KidPage({mode:'flow'|'session', children})`, dane `data-viewport-short`, `data-viewport-very-short`, `data-zoomed`.
- Produces: Mantine factory `KidScreen` z ref `HTMLDivElement`, `BoxProps`, `ElementProps<'div'>`, `StylesApiProps<KidScreenFactory>` i `mode?: 'flow'|'session'` (default flow).
- Produces: `KidScreen.Header`, `.Content`, `.Actions` jako factory elementów div z children/ref/Styles API; `Actions` przyjmuje ponadto `secondary?: ReactNode`. Styles names wspólne: `root|header|content|actions|primary|secondary`; kontekst udostępnia `getStyles` i mode. Zagnieżdżony KidScreen jest dozwolony i bierze najbliższy kontekst.

- [x] **Step 1: Zapisz test `KidScreen.test.tsx`.** W `renderKid` wyrenderuj header, input w Content, Actions z pustym children i przyciskiem w secondary. Asercje:

```tsx
expect(screen.getByTestId('kid-primary-slot').textContent).toBe('');
expect(screen.getByTestId('kid-secondary-slot').textContent).toContain('Pomiń');
expect(screen.getByLabelText('Wpis')).toBe(inputBeforeRerender);
expect((screen.getByLabelText('Wpis') as HTMLInputElement).value).toBe('ca');
expect(rootRef.current).toBe(screen.getByTestId('kid-screen'));
expect(contentRef.current).toBe(screen.getByTestId('kid-content'));
expect(screen.getByTestId('kid-screen').getAttribute('data-mode')).toBe('session');
expect(screen.getByTestId('kid-screen').hasAttribute('data-active')).toBe(true);
expect(screen.getByTestId('kid-primary-slot').classList.contains('custom-primary')).toBe(true);
expect((screen.getByTestId('kid-secondary-slot') as HTMLElement).style.color).toBe('rgb(1, 2, 3)');
```

Ostatnie dwie sprawdź po `fireEvent.change` i `rerender` z inną treścią nagłówka bez zmiany typu/key. Sprawdź `classNames={{content:'probe-content'}}` na Content i ref subkomponentu. Pojedyncze test ID slotów w każdej ramie; nie twórz ich na innych wrapperach.
- [x] **Step 2: RED.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/layout/KidScreen.test.tsx` → FAIL brak KidScreen. Dodatkowa asercja mod początkowo FAIL potwierdziła utratę trybu; lokalne overrides Styles API początkowo FAIL.
- [x] **Step 3: Wdroż interfejs.** Czytaj skill `mantine-custom-components` przed factory. Użyj `factory/useProps/useStyles`, prywatnego kontekstu i CSS Modules. `KidScreen` nie renderuje `KidPage`, nie czyta window/visualViewport, nie instaluje ResizeObserver. Session: grid header/`minmax(0,1fr)`/actions, `min-width:0`, `min-height:0`. Actions ma dwa stałe sloty: główny minimum 54 px i pomocniczy minimum 44 px, gap 8 px; przyciski mogą rosnąć przy 200% tekście. Główna akcja nie znika z siatki gdy pusta. Content może scrollować; flow nie ogranicza wysokości. Przy `data-viewport-very-short` naturalny wzrost ramy i przewijanie na poziomie KidPage, bez klipowania. Scope pomiaru opiera się na istniejących atrybutach, nie nowym detektorze telefonu. Focus outline 2 px z offsetem 3 px. Scoping CSS używa bezpośrednich dzieci, by nie stylować zagnieżdżonego KidScreen.
- [x] **Step 4: GREEN.** Polecenie z Step 2 PASS i `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/layout/viewport.test.ts` PASS. Testy geometrii w nowym pliku dodaj z Task 4, gdy rama ma produkcyjnego konsumenta; sam jsdom nie dowodzi geometrii. Rzeczywisty wynik: KidScreen + viewport 8/8, kid-ui typecheck PASS.
- [x] **Step 5: Commit.** `git add packages/kid-ui/src/layout` i tylko nowy spec jeśli już zawiera wykonywalny test, `git commit -m "feat(kid-ui): add compound KidScreen layout"`. Independent review GPT‑6.1 Sol/medium nie wykrył dalszych P0–P2.

## Task 3: Przyciski, pola i natychmiastowy wybór

**Files:**
- Create: `packages/kid-ui/src/components/{ActionButton.tsx,AnswerField.tsx,AnswerGrid.tsx,AnswerGrid.module.css,answer-controls.test.tsx}`
- Create: `packages/kid-ui/src/test/exercise-fixtures.ts`

**Interfaces:**
- Consumes: `OptionOutcome = 'pending'|'correct'|'wrong'`, provider i renderKid.
- Produces: `ActionButton` na Mantine Button z pełnym `ButtonProps & ElementProps<'button', keyof ButtonProps>` (bez polymorphic API), ref HTMLButtonElement, dodatkowo `priority?: 'primary'|'secondary'` default primary; domyślny type button, przekazane type/form/onKeyDown zachowane.
- Produces: `AnswerField` na TextInput: `TextInputProps & ElementProps<'input', keyof TextInputProps>`, ref HTMLInputElement; nie utrzymuje własnego value, nie trymuje odpowiedzi.
- Produces: `AnswerGrid({options,outcomes,disabled,onChoose,optionRefs,visualOnly})`; options `readonly {id:string; label:string; content:ReactNode}[]`, outcomes `ReadonlyMap<string,OptionOutcome>`, disabled boolean, onChoose `(id:string)=>void`, optionRefs opcjonalny `MutableRefObject<(HTMLButtonElement|null)[]>`, visualOnly opcjonalny boolean default false. Prywatny kafelek Mantine UnstyledButton; brak stanu selected/value.
- Test helper: `makeExerciseProps(task: TaskDto, overrides?: Partial<ExerciseProps>): ExerciseProps` z pełnymi domyślnymi propsami i `vi.fn()` każdego handlera; task dostarczany jawnie, bez `as TaskDto` ukrywającego błąd. Nie importować Vitest w runtime.

- [x] **Step 1: Testy `answer-controls.test.tsx`.** Utwórz 3 opcje o ID `one/two/three`. `fireEvent.click` pierwszej → `expect(onChoose.mock.calls).toEqual([['one']])`; rerender disabled i pending one → ponowne click oraz Enter nie zwiększa calls; `aria-pressed=true` tylko pending; brak `kid-outcome-correct/wrong` przed feedbackiem. Rerender z wrong one/correct two → znaczniki ×/✓ i polskie accessible names z istniejących messages. `visualOnly` ukrywa widoczną etykietę, pozostawia nazwę dostępną. Sprawdź ref optionRefs[0], ref inputa, form submit i `onKeyDown`; `AnswerField` zachowuje dokładnie `" ca "` i native `autoComplete=off`, `autoCorrect=off`, `autoCapitalize=off`, `spellCheck=false` przekazane przez widok.
- [x] **Step 2: RED.** Test najpierw zakończył się FAIL z brakiem modułów `ActionButton`/`AnswerField`/`AnswerGrid`.
- [x] **Step 3: Implementacja.** Siatka ul/li, dwie równe kolumny, trzecia w lewym dolnym polu, bez rozciągania ostatniej przez całą szerokość. `AnswerGrid` bezpośrednio wywołuje onChoose tylko gdy !disabled. Stan busy zapewnia kontroler/caller; nie dodawaj innego transportu ani lokalnego werdyktu. Zachowaj `data-testid=kid-option`, outcome IDs, aria names i keyboard refs. Wspólne klasy kolorów z tokenów A; pending wizualnie odmienny od good/bad; ikony wyniku mają zarezerwowane miejsce. Użyj istniejącego `format` i messages dla etykiet correct/wrong. Pusty slot ikon nie może zmieniać wymiarów. minimum target 44 px.
- [x] **Step 4: GREEN.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/components/answer-controls.test.tsx` — 5/5 PASS; `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` PASS.
- [x] **Step 5: Commit.** `feat(kid-ui): add Mantine answer controls`.

## Task 4: Produkcyjna rama sesji i wybór obrazka

**Files:**
- Create: `packages/kid-ui/src/components/SessionProgress.tsx`, `packages/kid-ui/src/exercises/PictureListeningView.test.tsx`
- Modify: `packages/kid-ui/src/{screens/LearnScreen.tsx,exercises/ExerciseFrame.tsx,exercises/PictureListeningView.tsx}`
- Modify: `tests/e2e/{kid-layout-stability.spec.ts,picture-choice-layout.spec.ts,kid-mantine-responsive.spec.ts}`

**Interfaces:**
- Consumes: Tasks 1–3; `ExerciseProps`, `ExerciseHandlers` pozostają **bez zmian**; `useChoiceKeyboard` i `MeaningVisualView` pozostają źródłem refów/treści.
- Produces: `SessionProgress({remaining}:{remaining:number|null}): ReactElement|null`; null → nic, liczba → istniejący komunikat remaining, bez procentu.
- `ExerciseFrame` zachowuje dokładnie dzisiejszą sygnaturę: task:TaskDto, content:ReactNode, actions?, secondaryActions?, result?, resultActions?:ReactNode, reserveResult?:boolean default false.

- [x] **Step 1: Testy.** Test DOM `PictureListeningView.test.tsx`: poprawny TaskDto, wybór `option.id` wywołuje handler raz bez kid-submit; onPlay osobny; busy blokuje; pending nie pokazuje werdyktu. E2E `kid-mantine-responsive.spec.ts`: odpowiedź route `/attempts` jest wstrzymana, liczony jest POST, pending pozostaje neutralny do `great`, potem pokazuje ✓; geometria pozostaje stała.

Nowy `kid-mantine-responsive.spec.ts`: z `pictureChoiceLayoutFixture` po ekspozycji, trzy/cztery opcje na 360×640, 768×1024, 1440×960. `expect(.kid-theme).toBeVisible()` i obecność `data-kid-screen` stanowią nową asercję RED. Zmierz bounding boxes opcji, instrukcji, materiału, primary/secondary przed pending i po feedbacku: każde x/y/width/height zmienia się ≤1 CSS px przy stałym viewporcie; widoczne 3/4 kafelki, brak poziomego overflow. Dla 3 opcji `x[2]=x[0]`, `y[2]>y[0]`. Nie porównuj pozycji przed i po zmianie viewportu.
- [x] **Step 2: RED.** Test E2E sprawdził nową ramę i wybór. Pierwsze uruchomienia ujawniły błędy fixture/selector, a następnie rzeczywiste braki geometrii i overflow; regresje zachowano i poprawiono.
- [x] **Step 3: Integracja.** LearnScreen zachowuje header end/mic/guidance, renderuje pozostałe zadania przez Mantine `SessionProgress` i `ActionButton`. `ExerciseFrame` używa `KidScreen` jako jedynej compound ramy zadania: instrukcja, materiał z rezerwą wyniku, główny i drugorzędny slot. Zachowano test ID, `data-prompt-kind`, `.kid-material-content` i kotwice geometrii. PictureListening używa `AnswerGrid visualOnly`, ten sam keyboard hook, focus odsłuchu po taskId, mediaUrl i onPlay. `.kid-learning` nadal jest właścicielem header/status/ramy.
- [x] **Step 4: GREEN.** Testy DOM: `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises/PictureListeningView.test.tsx packages/kid-ui/src/components/answer-controls.test.tsx packages/kid-ui/src/layout/KidScreen.test.tsx` — 11/11 PASS. `corepack pnpm exec tsc --noEmit -p packages/kid-ui/tsconfig.json` PASS. E2E `UMIEM_TEST_RUN_ID=kid-mantine-1024 UMIEM_E2E_PORT=25618 corepack pnpm exec playwright test tests/e2e/kid-mantine-responsive.spec.ts tests/e2e/kid-layout-stability.spec.ts tests/e2e/picture-choice-layout.spec.ts` — 17/17 PASS.
- [x] **Step 5: Commit.** `feat(kid-ui): migrate exercise frame and picture choices`.

## Task 5: Pisanie i luki bez utraty wpisu przy klawiaturze

**Files:**
- Modify: `packages/kid-ui/src/exercises/{WrittenView.tsx,PictureRecallView.tsx,LetterCompletionView.tsx}`
- Create: `packages/kid-ui/src/exercises/written-controls.test.tsx`
- Modify: `tests/e2e/{kid-mantine-responsive.spec.ts,kid-layout-stability.spec.ts}`

**Interfaces:** Consumes kontrolki Task 3 i rama Task 4. Produces te same widoki `(props:ExerciseProps)`, bez zmiany onSubmitText/onEdit/letterDraft/onLetterDraftChange, klucz nadal taskId.

- [x] **Step 1: Testy.** `written-controls.test.tsx`: w recall wpisz ` ca `, submit Enter i osobno kliknięciem formowego przycisku → jeden handler z dokładnym ` ca `; puste/spacje nie submitują; busy/recording/phase!=idle blokuje; zmiana value wywołuje onEdit. Rerender z tym samym taskId i innym busy nie resetuje value; nowy taskId przez ExerciseView resetuje. LetterCompletion odtwarza istniejący draft, nie zmienia kolejności/sklejania liter. Sprawdź natywne flagi wyłączenia korekty. Nowa asercja użycia pola Mantine przez classNames/testID → RED przed migracją.

E2E w responsive: otwórz recall na 360×760, wpisz `ca`, zmień viewport na 360×360 i wróć. Oczekuj `toHaveValue('ca')`, zachowanego aktywnego elementu i osiągalnego submit/skip po scrollIntoView. Zasymuluj `visualViewport.scale=2` istniejącym wzorcem testów viewportu: `data-zoomed=true`, tryb flow, content i actions osiągalne. Nie nazywaj zmiany wysokości rzeczywistą klawiaturą.
- [x] **Step 2: RED.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises/written-controls.test.tsx`; najpierw testy RED na braku kontrolki Mantine. E2E tylko nowy test responsive (użyj `-g` z nazwą dodanego testu). FAIL ma dotyczyć nowej prezentacji/osiągalności, nie błędnego fixture.
- [x] **Step 3: Wymień input/button na AnswerField/ActionButton.** Zachowaj formId i type=submit/form (przycisk poza form), disabled i focus. Recording przy polu, poza primary slot. Nie dodawaj localStorage/draft store ani nowego klucza dla resize. LetterCompletion zachowuje własne małe pola i handler; styl Input przez Mantine, logika składania bez zmian. Materiał nieczytający korzysta z dotychczasowych visual/label zasad.
- [x] **Step 4: GREEN.** Unit z Step 2 i `corepack pnpm exec playwright test tests/e2e/kid-mantine-responsive.spec.ts tests/e2e/kid-layout-stability.spec.ts tests/e2e/kid-flow.spec.ts tests/e2e/spelling-diff-feedback.spec.ts` PASS.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate written answers with keyboard-safe layout"`.

## Task 6: Pozostałe słownictwo i ekspozycje

**Files:**
- Modify: `packages/kid-ui/src/exercises/{ExposureView.tsx,PictureExposureView.tsx,ListeningView.tsx,ReadingView.tsx,PictureRecognitionView.tsx}`
- Create: `packages/kid-ui/src/exercises/vocabulary-views.test.tsx`
- Modify: `tests/e2e/{picture-recognition-layout.spec.ts,picture-choice-layout.spec.ts}` tylko niezbędne oczekiwania nowego motywu

**Interfaces:** Consumes AnswerGrid/ActionButton i niezmienione ExerciseProps. Produces te same pięć eksportów; Reading obsługuje też reverse_recognition. `MeaningVisualView` nie zmienia kontraktu.

- [x] **Step 1: Testy tabelaryczne.** `vocabulary-views.test.tsx`: exposure i picture_exposure `kid-done` → onComplete raz, nigdy onSubmitText/onAnswerChoice; listening/reading/reverse/picture_recognition klik opcji → onAnswerChoice(id), bez kid-submit. Pending neutralny. Brak audio nie dodaje odsłuchu; picture_recognition korzysta wyłącznie z przekazanego `feedbackAudio`. Testy sprawdzają promptowy obraz, pojedynczy widoczny tekst, `lang=en-GB` oraz klasy Mantine.
- [x] **Step 2: RED.** Pierwszy przebieg testu wykazał brak Mantine Button/UnstyledButton w niezmigrowanych widokach.
- [x] **Step 3: Migruj prezentację.** Opcje przez AnswerGrid, akcje przez ActionButton, tekst przez Mantine Text. Zachowano useChoiceKeyboard, kolejność serwera, odsłuchy i identyfikatory. AnswerGrid obsługuje pionową listę i kompaktową siatkę dla rozpoznawania obrazkowego; puste treści wewnętrzne nie zajmują miejsca.
- [x] **Step 4: GREEN.** Unit: vocabulary/answer-controls/written-controls 18/18 PASS; package tsc PASS. Pełne E2E `picture-vocabulary.spec.ts picture-recognition.spec.ts picture-recognition-layout.spec.ts picture-choice-layout.spec.ts kid-ui-layout.spec.ts` — 69/69 PASS. Po poprawkach review dodatkowe E2E `picture-recognition.spec.ts kid-ui-layout.spec.ts` — 7/7 PASS. E2E krótkiego viewportu ma tolerancję 1 px na ułamek piksela z visualViewport. Review GPT‑6.1 Sol medium: dwa P2 naprawione (duplikat tekstu, `lang=en-GB`), następnie pusty span naprawiony; finalnie brak P0–P2.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate vocabulary and exposure views"`.

## Task 7: Mowa i feedback z niezmienionym cyklem nagrywania

**Files:**
- Modify: `packages/kid-ui/src/exercises/{SpeechView.tsx,PictureSpeechView.tsx,SpeechRecordButton.tsx}`, `packages/kid-ui/src/screens/{AnswerFeedback.tsx,SpeechFeedbackCard.tsx,LearnScreen.tsx}`
- Create: `packages/kid-ui/src/exercises/SpeechRecordButton.test.tsx`
- Modify: `tests/e2e/speech-recording-ux.spec.ts` (brakujące pointercancel/profile cleanup)

**Interfaces:** Zachowaj wszystkie obecne propsy eksportów, cooldown ref/onKeyDown, `recordingMode`, fazy idle/preparing/starting/recording/stopping. `onPrepare`, `onStart`, `onStop`, `onCancel` pozostają odrębne; nie zamieniaj gestu hold na onClick.

- [x] **Step 1: Testy.** DOM `SpeechRecordButton.test.tsx`: hold pointerdown → start, pointerup → stop, pointercancel → cancel; toggle click → start/stop zgodnie z phase; disabled → nic; preparing/stopping nie startują ponownie. Testy kontrolki sprawdzają też label i komponent Mantine; `keyboard-navigation.test.tsx` zachowuje sprawdzenie roving focus po zmianie AnswerGrid API.

W E2E rozszerz scenariusz odmowy: ścieżka tekstowa działa. Przy fake streamie rozpocznij nagranie, anuluj lub wyjdź istniejącym end/profile flow, obserwuj `MediaStreamTrack.stop` i brak dalszego nagrania; nie zapisuj próbek. Nie dodawaj nowego przycisku zmiany profilu do aktywnego nagrania tylko dla testu.
- [x] **Step 2: RED.** Nowy test wykazał brak migrowanego komponentu Mantine przed implementacją; nie wykryto regresji kontrolera gestów.
- [x] **Step 3: Migruj wygląd.** SpeechRecordButton używa Mantine Button, zachowuje pointer handler/ref, stany i klawisze. Widoki mowy i karty feedbacku używają wspólnych akcji Mantine; rozróżnienia feedbacku oraz źródło werdyktu pozostają bez zmian.
- [x] **Step 4: GREEN.** Vitest: 46/46 testów `SpeechRecordButton`, gestów i nawigacji PASS. Kid UI tsc PASS. Playwright: 32/34 testów trzech wskazanych plików przeszły w przebiegu zbiorczym; dwa testy wykryły zmianę intrinsic width Button w fazie nagrania. Po zwiększeniu specyficzności `.kid-ui .kid-record-button` oba scenariusze mikrofonu przeszły ponownie (2/2). Oddzielnie `speech feedback` i picture recognition 360×640 PASS (2/2). Review GPT‑6.1 Sol medium: brak P0–P2.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate speech controls and honest feedback"`.

## Task 8: Wszystkie typy ćwiczeń lekcyjnych

**Files:**
- Modify: `packages/kid-ui/src/exercises/lesson/{LessonCardView.tsx,LessonNoticeView.tsx,LessonChoiceView.tsx,LessonShortAnswerView.tsx,LessonOrderView.tsx,LessonGapView.tsx,LessonSentenceView.tsx}`
- Create: `packages/kid-ui/src/exercises/lesson/lesson-views.test.tsx`

**Interfaces:** Consumes ExerciseProps, existing `block-order.ts`, `gap.ts`, Task 3 controls. Produces unchanged view exports. `LessonSentenceView` nadal pokrywa lesson_error_fix/lesson_transform/lesson_open_answer; `onAnswerSequence(itemIds:string[])` bierze ID, nie słowa.

- [x] **Step 1: Testy `lesson-views.test.tsx`.** Render z Mantine providerem sprawdza akcję karty, natychmiastowy wybór, odpowiedź notice z ID, short answer, kolejność ID przy powtarzającym się słowie, tekst luk/zdania i dostępność odsłuchu tylko z wydanym assetem.
- [x] **Step 2: RED.** Nowy test najpierw FAIL na braku `mantine-Button-root` dla „Dalej” i odsłuchu zdania; asercje handlerów i payloadów przeszły.
- [x] **Step 3: Wymień warstwę prezentacji.** Karty, formularze i akcje przeszły na Mantine/wspólne kontrole; choice/short-answer używają AnswerGrid. Zachowane callbacki, order IDs, taskId reset oraz reguły audio. Reset Mantine nie zmniejsza kafelków poniżej 44 px.
- [x] **Step 4: GREEN.** Unit: 19/19 wraz z `block-order` i `gap`; Kid UI tsc PASS. `lesson-kid.spec.ts` + `lesson-real-flow.spec.ts`: 9/9 PASS; po dodaniu minimalnych wymiarów osobny pełny przebieg lekcji 1/1 i długi `lesson_order` na 360×640 1/1. Review GPT‑6.1 Sol medium: P2 krótkich klocków zamknięty (`min-width:44px` i selektory z większą specyficznością), brak pozostałych P0–P2.
- [x] **Step 5: Commit.** Selektywny add Files i zmieniony lesson-kid spec; `git commit -m "feat(kid-ui): migrate lesson exercise views"`.

## Task 9: Kartkówki, konflikt sesji i omówienia

**Files:**
- Modify: `packages/kid-ui/src/screens/{MockTestSummaryScreen.tsx,LessonMockTestSummaryScreen.tsx}`
- Create: `packages/kid-ui/src/screens/mock-test-views.test.tsx`
- Modify: `tests/e2e/{mock-test.spec.ts,lesson-mock-test.spec.ts,kid-flow-screens.spec.ts}` w niezbędnym zakresie

**Interfaces:** Zachowaj istniejące eksporty MockTestReadyScreen, SessionConflictScreen, MockTestSummaryScreen, LessonMockTestSummaryScreen i ich propsy; score helpers bez zmian. Użyj `ComponentProps<typeof ExistingScreen>` w testach, nie drugiego kontraktu DTO.

- [x] **Step 1: Testy.** `mock-test-views.test.tsx` renderuje ekrany z `ComponentProps`, sprawdza budżet z session, ready/cancel/conflict callbacki, statusy correct/incorrect/unassessed, retry i dostępne audio/praktykę. Assercje Mantine oraz retry 44 px.
- [x] **Step 2: RED.** Testy najpierw FAIL na braku `mantine-Button-root` w ekranie gotowości, akcji odsłuchu i praktyki. Stany błędu/redirection sprawdzono również E2E.
- [x] **Step 3: Migruj ekrany do KidScreen mode flow.** Wszystkie akcje przez ActionButton, wyniki i wiersze przez Mantine Paper/Badge/Text. Zachowane helpery score, rzeczywisty taskBudget, brak oceny bieżącej odpowiedzi, dostępność audio i callbacki.
- [x] **Step 4: GREEN.** Unit: 4/4; Kid UI tsc PASS. `mock-test.spec.ts`, `lesson-mock-test.spec.ts`, `kid-flow-screens.spec.ts`: 13/13 PASS. Po korekcie kolorów Mantine ponownie ekran ready + conflict + summary PASS; po asercjach Mantine E2E ready i summary 2/2. Review GPT‑6.1 Sol medium: oba P2 zamknięte (Paper status/flex oraz retry min. 44 px), brak pozostałych P0–P2.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate mock test screens and reviews"`.

## Task 10: Profile i zestawy na rzeczywistych danych

**Files:**
- Modify: `packages/kid-ui/src/screens/{ProfileScreen.tsx,DeckScreen.tsx,reward-summary.test.tsx}`
- Create: `packages/kid-ui/src/screens/profile-decks.test.tsx`
- Modify: `tests/e2e/{kid-decks-layout.spec.ts,kid-flow-screens.spec.ts}`

**Interfaces:** Zachowaj publiczne propsy ProfileScreen/DeckScreen/DeckCard i `deck-presentation.ts`. Avatar map fox/bear/cat/dog/owl/rabbit pozostaje zgodny z avatarKey. Brak nowego DTO lub ukrytego filtrowania listy.

- [x] **Step 1: Testy i poprawny renderer.** Przenieś `reward-summary.test.tsx` z ręcznego wołania funkcji komponentów na `renderKid` + screen/container i prawdziwy React. Nie wywołuj `node.type(props)` i nie mockuj hooków. Zachowaj wszystkie istniejące asercje, szczególnie:

```tsx
expect(screen.getByText('Zatwierdzono dziś: 2 min 5 s')).toBeTruthy(); // 125
expect(screen.getByText('Zatwierdzono dziś: 0 s')).toBeTruthy(); // 0
expect(screen.getByText('Zatwierdzony czas: —')).toBeTruthy(); // undefined/unavailable
expect(screen.queryByText('Xbox')).toBeNull();
```

Każdy przypadek renderuj osobno z cleanup. `profile-decks.test.tsx`: wybór prawdziwego childId, także jeden profil; canRead=false marker, faktyczny rewardPoints; deck recommended/other, termin, coverVisual, resume/end/mock callbacks z deckId, pusta lista i długi tytuł. Nowa asercja Mantine karty/akcji daje RED. Stars test sprawdza sens i liczbę, niekoniecznie surowy ciąg znaków jeśli przechodzą na dostępne ikony.
- [x] **Step 2: RED.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/profile-decks.test.tsx packages/kid-ui/src/screens/reward-summary.test.tsx` — część przeniesionych regresji może PASS; nowa prezentacja musi FAIL.
- [x] **Step 3: Migruj profile i deck.** KidScreen flow, Paper/karty Mantine; przydatne mniejsze prywatne komponenty trzymaj obok ekranów, bez kopiowania fikcyjnych kart z FlowScreens. Szerokość czytelnej treści max 1000 px, na telefonie padding 16 px (12 px przy krótkiej sesji tylko w sesji); listy rosną naturalnie. Nie zmieniaj startu od profilu, prawdziwego linku rodzica i mikrofonowego opt-in. Czas i punkty przez istniejące formatery, odmienna niedostępność. Cover z MeaningVisualView/mediaUrl, zachowaj heading/recommended groups.
- [x] **Step 4: GREEN.** Unit z Step 2 i `corepack pnpm exec playwright test tests/e2e/kid-decks-layout.spec.ts tests/e2e/deck-cover-image.spec.ts tests/e2e/kid-flow-screens.spec.ts tests/e2e/navigation.spec.ts` PASS. Profile/deck na 360×640 i 200% tekstu bez poziomego overflow i z osiągalnym ostatnim zestawem.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate profiles and deck selection"`.

## Task 11: Natychmiastowe podsumowanie i pozostałe stany aplikacji

**Files:**
- Modify: `packages/kid-ui/src/{KidApp.tsx,screens/SummaryScreen.tsx,screens/SessionActivityResultView.tsx,screens/reward-summary.test.tsx}`
- Modify: `tests/e2e/{kid-activity-lifecycle.spec.ts,kid-flow-screens.spec.ts}`
- Create: `packages/kid-ui/src/screens/summary-states.test.tsx`

**Interfaces:** Consumes istniejący controller/screen union, activity polling i Task 10 renderer. Produces te same kontrakty ekranów; bez zmian useLearningSession/controller ani zależności efektów.

- [x] **Step 1: Testy.** `summary-states.test.tsx`: summary bez activity, pending/already_started, evaluated, error pokazują właściwy komunikat i dostępny back/profile. Testy reward zachowują realne punkty, approved seconds i brak wpisania zera zamiast niedostępności. W kid-activity-lifecycle dodaj wariant opóźnionego GET wyniku: po end widoczne summary i back; resize 360×360→360×760 i powrót do profili nie zwiększają liczby POST end. Wybierz drugie dziecko, zwolnij stary GET z punktami pierwszego; ekran drugiego nie zawiera wyniku pierwszego. Użyj dwóch fixture profili i route obsługującego childId z query; nie zmieniaj API produkcyjnego dla testu.
- [x] **Step 2: RED.** `corepack pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/screens/summary-states.test.tsx` → FAIL nowej prezentacji. Run `corepack pnpm exec playwright test tests/e2e/kid-activity-lifecycle.spec.ts` dla zabezpieczenia obecnego lifecycle; jeśli już PASS, to dowód zachowanej regresji, nie wymuszaj sztucznego błędu.
- [x] **Step 3: Migruj podsumowanie i wszystkie pozostałe gałęzie KidApp.** Loading/initError/offline/sessionConflict/empty states w tym samym motywie; offline nadal usuwa zadanie i blokuje oceniane odpowiedzi. Summary flow, jego aktywność aktualizowana istniejącą subskrypcją; żadnego await na grade w renderze/nawigacji, nowego timera, fetch ani onMount POST. Zachowaj dzisiejsze aria-live i polskie komunikaty. Po zakończeniu przejrzyj każdą gałąź switch KidApp oraz ExerciseView — każda ma migrowaną prezentację, exhaustive never zostaje.
- [x] **Step 4: GREEN.** Unit summary/reward i `corepack pnpm exec playwright test tests/e2e/kid-activity-lifecycle.spec.ts tests/e2e/kid-flow-screens.spec.ts tests/e2e/kid-flow.spec.ts` PASS, brak dodatkowych żądań końca/wywołań providerów.
- [x] **Step 5: Commit.** Selektywny add Files; `git commit -m "feat(kid-ui): migrate summaries and application states"`.

## Task 12: Domknięcie responsywności, cleanup i dokumentacja

**Files:**
- Modify: `packages/kid-ui/src/styles.css`, moduły CSS nowych komponentów, `tests/e2e/{kid-mantine-responsive.spec.ts,kid-mantine-theme.spec.ts}`
- Modify: `docs/architecture.md` §5/stack, `docs/folder-structure.md` §3
- Create: `docs/superpowers/plans/2026-10-24-kid-ui-mantine-verification.md`

**Interfaces:** Żadnych nowych API/typów. Konsumuje wszystkie poprzednie zadania i macierz §6 specyfikacji. Raport weryfikacji zawiera osobno wykonane testy, ograniczenia i odbiór fizyczny.

- [x] **Step 1: Domknij brakujące testy responsive przed poprawkami.** Dla recall, 3/4 obrazków, długiego lesson_order, listy deck i summary sprawdź macierz 360×640/360×760/768×1024/1440×960. Na krótkim 360×320 i 360×420 wszystkie akcje osiągalne po scrollu, brak poziomego overflow. Przy 200% font/zoom nie wymagaj wszystkich obrazków bez scrollu — wymagaj dostępności wszystkich treści. Emuluj reduced-motion i sprawdź brak dekoracyjnych ciągłych animacji. `kid-mantine-theme` porównuje parent styles także po załadowaniu pełnej sesji, nie tylko profilu. Rozszerz istniejące helpers, nie kopiuj algorytmu viewportu do testu.
- [x] **Step 2: RED dla rzeczywistej luki.** `corepack pnpm exec playwright test tests/e2e/kid-mantine-responsive.spec.ts tests/e2e/kid-mantine-theme.spec.ts`. Zanotuj failing case przed poprawką. Jeżeli cała macierz PASS, odnotuj, że dodatkowa poprawka layoutu nie była potrzebna; nie dodawaj jej profilaktycznie.
- [x] **Step 3: Cleanup i minimalne poprawki.** `rg` sprawdza konsumentów każdego usuwanego starego selektora, zwłaszcza kotwic `.kid-material-content` i screenshot assertions. Usuń tylko nieużywane style; nie usuwaj potrzebnych layout anchors i klas dostępności. Zachowaj jeden provider i jeden viewport hook, bez importów `.planning`, globalnych resetów, `!important` jako obejścia i dwóch kopii React. Aktualizuj dokumentację faktycznego komponentu i portable host; opisz font/import stylów oraz brak wpływu API → MCP → skill. Jeśli potrzebna nowa etykieta, dodaj ją do messages, nie inline.
- [x] **Step 4: Końcowa walidacja.** Wykonaj kolejno:

```powershell
corepack pnpm test:unit
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:e2e
git diff --check
```

Wszystko PASS; nie używaj historycznego wyniku. Jeśli zmieniono controller/transport/exposure wbrew pierwotnemu zakresowi, także `corepack pnpm test:integration` i ponowna analiza kontraktu. Bez tych zmian wyjaśnij w raporcie dobór unit + istniejących E2E i brak potrzeby nowego wywołania prawdziwego LLM. Awaria Docker/providerów to blokada weryfikacji, nigdy PASS. Nie naprawiaj niezwiązanego kodu bez opisania nowego zakresu.

W raporcie podaj status każdego z 12 zadań, wykonane komendy i wyniki, migrowane 22 prompt kinds oraz gałęzie KidApp, API/MCP wpływ=brak z uzasadnieniem. Screenshoty kluczowych ekranów przy 360×640 i desktop zapisz jako artefakty testów; oceń je względem A, bez kopiowania przykładowych danych do produkcji. R01/R04/R07: reload/dwie przeglądarki/complete-presentation/mowa muszą pozostać pokryte istniejącą regresją. Odbiór fizycznego Galaxy S10e w browser/PWA zapisz jako **niewykonany**, jeśli urządzenia nie testowano; to jawny brak dowodu, nie automatyczny powód do dodania kolejnej implementacji.

- [x] **Step 5: Commit i review.** Selektywnie dodaj cleanup/docs/tests, `git commit -m "refactor(kid-ui): finish Mantine migration and document verification"`. Przeprowadź review zgodnie z uzgodnioną metodą wykonania, skupione na pięciu Review Focus i granicy UI/domena; napraw findingi z adekwatnymi testami, a po zmianach uruchom dotknięte kontrole. Nie pushuj i nie twórz PR bez polecenia właściciela.

## Handoff i zasady wykonania przez słabszy model

1. Wykonuj Tasks 1→12 sekwencyjnie. Task nie jest ukończony po samym dodaniu plików: potrzebuje wyniku testów i lokalnego commita. Przy dużym kontekście zakończ na granicy zadania i zapisz faktyczny stan checkboxów/commit/test results.
2. Nie reinterpretuj natychmiastowej wysyłki, naliczania czasu, sposobu nagrywania ani kontraktów z powodu różnic w makiecie. Każdy handler ma już właściciela w produkcji.
3. Jeśli istniejący test dotyczy tylko starego koloru/klasy, zmień go na token A i semantykę. Nie zmniejszaj wymaganej widoczności, kontrastu, stabilności ani liczby wywołań dla wygody.
4. Jeśli sygnatura w planie zderza się z faktycznymi typami 9.7.3, sprawdź zainstalowane deklaracje i zachowaj opisany kontrakt. Nie używaj `any`, `@ts-ignore`, mocka całego Mantine lub zmiany wersji biblioteki, aby ukryć błąd.
5. Każdy Task ma pięć checkable kroków; w krokach testowych są nazwane warunki i asercje. Nie przepisuj planu na nowe ogólne TODO zamiast realizacji.

Źródła techniczne sprawdzone 2026-10-24: [Mantine global CSS](https://mantine.dev/styles/global-styles/), [MantineProvider i zakres zmiennych](https://mantine.dev/theming/mantine-provider/). Przy implementacji factory stosuj lokalny skill `mantine-custom-components` dla Mantine 9.x.

## Self-review planu — wykonany przed przekazaniem

- Pokrycie spec: §2 zachowanie → Tasks 3–11; §3–4 komponenty → Tasks 1–4; §5 etapy → Tasks 1–12; §6 responsywność/testy → Tasks 2,4,5,7,9–12; §7 granice API → Global Constraints i Task 12. Nie stwierdzono nieprzypisanego wymagania implementacyjnego.
- Review Focus: pięć punktów ma przypisane konkretne testy; rozróżniono unit DOM, geometrię Playwright oraz fizyczny odbiór.
- Zgodność typów: ExerciseProps/Handlers i propsy ekranów bez zmiany; AnswerGrid operuje na ID/string i istniejącym OptionOutcome; KidScreen wizualny nie koliduje z typem kontrolera w publicznym barrel.
- Proporcja: plan zawiera decyzje, interfejsy, asercje i polecenia; ciała widoków pozostają zadaniem implementera. Jeden subsystem UI, brak osobnego planu backendu.
- Stan: **wyłącznie plan; żadna kontrolka produkcyjna ani zależność nie została wdrożona w ramach pisania tego dokumentu**.
