# Redesign panelu rodzica — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wdrożyć zaakceptowany redesign panelu rodzica: rama aplikacji z zakładkami ikonowymi, lista zestawów pogrupowana wg stanu z modalem „Nowy materiał", karty dzieci, czytelne Postępy (paski opanowania, kafelki aktywności, chipy, kropki w tabeli słów) — bez zmian domen nauki i bez utraty pokrycia e2e.

**Architecture:** Zmiana prezentacji w `apps/web/src/parent/**` + style CSS panelu. Jedna zmiana kontraktu: opcjonalne pola meta w `DeckSummaryDto` (`itemCount`, `assignedChildren`) wypełniane batchowo w `listDecks`. Domena, scheduler, ekspozycje, polityki samodzielności, Kid UI, `/api/v1/kid` i MCP `learning-overview` (nie konsumuje tego DTO) — bez zmian.

**Tech Stack:** TypeScript strict, React 19, Next App Router, istniejąca strategia CSS (nowe tokeny/komponenty w pliku CSS panelu), Drizzle, Zod, pnpm 10.34.6, Vitest, Playwright. Bez nowych zależności produkcyjnych (ikony inline SVG wg wzorca `KidIcon.tsx`).

**Spec:** `docs/superpowers/specs/2026-10-14-parent-panel-redesign-design.md` (decyzje designu, paleta, nienaruszalne zasady §4).

## Global Constraints

- Wszystkie zmiany wizualne zgodne ze specem §2–§4: paleta, cienie zamiast twardych ramek, pola dotykowe ≥ 44 px, kontrast tekstu ≥ 4,5:1, liczby tabularne, teksty wyłącznie pl z `messages.ts`.
- Każdy istniejący `data-testid` zachowany albo jawnie przeniesiony z aktualizacją speców e2e w tym samym zadaniu; zakaz cichego osłabiania asercji.
- Logika idempotencji generowania (`pendingGenerationCommand`, `isDefinitiveGenerationRejection`, `pendingEmptyCommand`), leave-guard, konflikty edytora i `onAuthExpired` — przeniesiona/otoczona bez zmiany semantyki; zmiany w tych obszarach wymagają własnego RED→GREEN.
- `DeckSummaryDto` rozszerzone wyłącznie o pola opcjonalne (zgodność wsteczna); walidacja Zod po obu stronach; brak N+1 w `listDecks`.
- MCP i skill `umiem-learning` bez zmian; w dzienniku i PR odnotować uzasadnienie braku wpływu (learning-overview czyta osobny endpoint).
- Bez nowego systemu stylowania, bibliotek ikon i webfontów; bez zmian w `packages/kid-ui` (kontrola: importy z `@learning/kid-ui` w panelu rodzica mogą być zastąpione lokalnymi odpowiednikami, ale nie modyfikujemy kid-ui).
- Dostępność: zakładki `aria-current`/`aria-selected`, modal jako natywny `<dialog>` (pułapka fokusu, powrót fokusu, `aria-modal`), paski postępu z `role="img"` i etykietą opisującą segmenty, stan wybranych chipów dziecka przez `aria-pressed`.

## Review Focus

1. **Pokrycie e2e po przeniesieniu testidów** — 13 speków dotyka redesignowanych obszarów (`generation-request-retry`, `kid-flow`, `lesson-archive`, `lesson-mock-test`, `lesson-parent-supervision`, `lesson-parent`, `lesson-real-flow`, `manual-deck-flow`, `mock-test-parent`, `navigation`, `parent-edit-protection`, `parent-flow`, `progress-panel`); każda zamiana asercji ma równoważnik, żaden spec nie został pominięty.
2. **Zgodność wsteczna DTO i MCP** — pola opcjonalne, parsowanie starych odpowiedzi, brak wycieku danych dziecka poza istniejący kontrakt, uzasadnienie no-impact dla MCP w PR.
3. **Auto-load Postępów** — brak burzy zapytań przy szybkiej zmianie filtrów (guard kolejności, ignorowanie przestarzałych odpowiedzi), obsługa 401 przez `onAuthExpired`/ekran logowania, stan ładowania i błędu.
4. **Kolejność `deck-row-N` po grupowaniu** — deterministyczna (review → published → draft → archived, w grupie dotychczasowa kolejność), archiwum lekcji tylko pod przełącznikiem.
5. **Dostępność modala i chipów** — fokus, zamykanie Esc/klawiszem, etykiety aria, 44 px cele; nagłówek wyniku kartkówki czytany przez czytnik ekranu.
6. **Reguły „znane" i statusy** — `knownCount` liczone jak dotychczas (item-level, z `meaningChanged`), paski sumują się do 100%, `totalItems = 0` nie produkuje NaN.

## Punkt startowy i sposób wykonania

- Baza planowania: `6faf2793d21e8cf98dcbd7cc655ccebc008393f6` (main). Sprawdzić `git status`/`git log` przed startem; przy rozjechaniu z main dociągnąć i zweryfikować kolizje w dotkniętych plikach.
- Spec i plan są dokumentami do oceny właściciela. Nie zaczynać implementacji przed akceptacją planu.
- Wykonawca używa `using-git-worktrees`, sprawdza istniejące worktree i tworzy nowe tylko w razie potrzeby (zasady szybkiego startu z AGENTS.md: nie reinstalować `node_modules` gdy istnieją, skopiować `.env` przez `node scripts/setup-worktree.cjs`, selektywny baseline).
- Instalacja jeśli potrzebna: `npx --yes pnpm@10.34.6 install --frozen-lockfile` (corepack w tym środowisku bywa uszkodzony). Nie aktualizować lockfile bez powodu.
- Dziennik implementacji: `docs/superpowers/progress/2026-10-14-parent-panel-redesign-implementation.md` — przy każdym zadaniu zapisywać dowody RED/GREEN, odstępstwa i wyniki review.
- Postępowanie w razie blokady: `globals.css` migrować per zadanie (nie big-bang), każdy zadaniowy commit trzyma spek zielony; przy niespójności niemożliwej do lokalnego rozstrzygnięcia zatrzymać wykonanie, zapisać stan w dzienniku i wrócić do właściciela — nie porzucać worktree po cichu ani nie kontynuować na czerwono.
- Izolacja testów: przed e2e ustawić wolne porty i unikalny run-id wg `tests/test-run-config.ts`, np. `UMIEM_TEST_RUN_ID=parent-redesign`, `UMIEM_E2E_PORT=24711`, `UMIEM_WORKER_HEALTH_PORT=9471`. Nie używać produkcyjnej bazy ani prawdziwych providerów.
- Baseline przed Zadaniem 1: `pnpm test:unit apps/web/src/parent` (istniejące testy deck-editor-state/generation-request), `pnpm test:e2e tests/e2e/progress-panel.spec.ts tests/e2e/parent-flow.spec.ts`, `pnpm typecheck`. Zapisać wyniki; rozróżnić błąd środowiska od regresji.
- Komendy testowe w zadaniach zapisane skrótem `pnpm` = `npx --yes pnpm@10.34.6`; e2e pojedynczego speka: `pnpm test:e2e tests/e2e/<plik>` z isolacją jak wyżej.

## Mapa plików

Nowe:

- `apps/web/src/parent/ParentIcon.tsx` — zamknięty zestaw ikon SVG (ok. 20 nazw), dekoracyjne, `aria-hidden`.
- `apps/web/src/parent/parent.css` — tokeny (paleta §2.5 specu), komponenty (topbar, tabs, karty, chipy, paski, kafelki, modal, wiersze zestawu/dziecka, tabela kropek); importowany przez `ParentApp.tsx`.
- `apps/web/src/parent/NewMaterialDialog.tsx` — natywny `<dialog>` z trzema opcjami i formularzem generowania.
- `apps/web/src/parent/deck-list-grouping.ts` + `.test.ts` — filtr rodzaju + grupowanie wg stanu z zachowaniem kolejności.
- `apps/web/src/parent/build-skill-rows.ts` + `.test.ts` — z `ProgressDto` wiersze umiejętności (znane wg dotychczasowej reguły, segmenty, krawędź total=0).
- `apps/web/src/parent/progress-lists.ts` + `.test.ts` — wpisy „do ćwiczeń" jako `{skill, target}` (zamiast konkatenowanych stringów) + format znacznika czasu historii (`Intl` pl-PL).

Modyfikowane: `ParentApp.tsx`, `DecksPanel.tsx`, `ChildEditor.tsx`, `ProgressPanel.tsx`, `ProgressItems.tsx`, `MockTestReportPanel.tsx`, `globals.css` (redukcja po migracji), `packages/contracts/src/decks.ts` (DTO + schemat), `packages/contracts/src/messages.ts`, `packages/server/src/modules/decks.ts` (`listDecks`), `tests/integration/decks-management.test.ts`, wskazane specy e2e, `docs/SPEC.md` (§5/§25 tam gdzie opisany układ), w razie potrzeby `docs/architecture.md` (odnotowanie rozszerzenia DTO).

## Zadanie 1: Tokeny, ikony i rama aplikacji

**Pliki:** nowe `ParentIcon.tsx`, `parent.css`; modyfikacje `ParentApp.tsx`, `globals.css` (ograniczenia szerokości przenieść do parent.css), `messages.ts` (podpis „Panel rodzica" jeśli brak).

**Interfejsy:**

- `ParentIconName = 'layers' | 'users' | 'trending-up' | 'play' | 'log-out' | 'plus' | 'book-open' | 'graduation-cap' | 'chevron-right' | 'eye' | 'check' | 'x' | 'minus' | 'pencil' | 'mic' | 'calendar' | 'target' | 'clipboard-check' | 'info' | 'flame' | 'lightbulb' | 'shuffle' | 'history' | 'list' | 'sparkles' | 'file-plus' | 'trash-2' | 'arrow-right' | 'activity'`; `ParentIcon({name, className?}: {name: ParentIconName; className?: string}): ReactElement` — SVG stroke 2, `currentColor`, rozmiar przez CSS.
- `ParentApp` zachowuje `Phase`/`Tab`, testidy `tab-decks`/`tab-children`/`tab-progress`, `to-learning`, `parent-logout`, `auth-*`; zmienia się markup ramy (topbar + zakładki podkreślane) i kontener 960 px. Zachować `aria-current="true"` (wartość jak dotychczas; nowy CSS celuje w `[aria-current="true"]`). Wyjątek `.container:has(.progress-items) { max-width: 1040px }` znika — tabela słów używa wspólnej szerokości 960 px (kropki wymagają mniej miejsca niż chipy tekstowe); świadoma decyzja, odnotować w dzienniku.

- [ ] RED: rozszerzyć `tests/e2e/navigation.spec.ts` o asercje widocznych zakładek z ikonami i stanu aktywnego (`aria-current`) po przejściu do /parent (asercja struktury/aria, nie kolorów). Potwierdzić porażkę na obecnym UI.
- [ ] Zaimplementować `ParentIcon` + `parent.css` (tokeny §2.5, topbar, tabs, kontener, `.pp-*` prefiksy klas; stary `globals.css` nadal obsługuje edytory), przebudować markup `ParentApp` (ekrany login/setup dostają tę samą ramę, bez zakładek).
- [ ] GREEN: `pnpm test:e2e tests/e2e/navigation.spec.ts`, `pnpm typecheck`; ręczny smoke `/parent` (login → panel). Commit `feat: add parent app shell with tabs and design tokens`.

## Zadanie 2: Modal „Nowy materiał" i pogrupowana lista zestawów

**Pliki:** nowe `NewMaterialDialog.tsx`, `deck-list-grouping.ts` + `.test.ts`; modyfikacje `DecksPanel.tsx`, `parent.css`, `messages.ts`; spece: `generation-request-retry`, `manual-deck-flow`, `parent-flow`, `lesson-parent`, `lesson-real-flow`, `lesson-mock-test`, `lesson-archive`, `kid-flow`, `parent-edit-protection` (7 miejsc klika `create-empty-submit` bez modala).

**Interfejsy:**

- `filterByKind(decks: DeckSummaryDto[], kind: 'all' | 'vocabulary' | 'lesson'): DeckSummaryDto[]`.
- `groupDecksByState(decks: DeckSummaryDto[]): ReadonlyArray<{id: 'review' | 'published' | 'draft' | 'archived'; decks: DeckSummaryDto[]}>` — grupy w stałej kolejności, puste grupy pominięte; kolejność wewnątrz grupy = wejściowa (najnowsze pierwsze z `listDecks`); `archived` tylko lekcje trafiają tu po włączeniu „Pokaż archiwalne" (istniejąca logika `visibleDecks`/`archivedIds` przed grupowaniem).
- `NewMaterialDialog({open, onClose, onGenerate, onCreateEmpty, onNewLesson, ...stan idempotencji})` — opcje `data-testid="new-material-generate" | "new-material-empty" | "new-material-lesson"`, przycisk otwarcia w DecksPanel `data-testid="new-material-open"`, zamknięcie `new-material-close`. Formularz generowania w modalu zachowuje testidy `deck-title`, `deck-prompt`, `generate-submit`; opcje pusty/lekcja uruchamiają istniejące akcje (`create-empty-submit`, `new-lesson-submit` mogą pozostać wewnątrz opcji modala). `NewLessonForm` otwierany jak dotychczas (pełny ekran), tylko opcja w modalu go wywołuje.
- Zamknięcie modala (Esc/tło/przycisk) blokowane nie tylko przy `generating`, lecz także gdy `pendingGenerationCommand` lub `pendingEmptyCommand` ≠ null (stan niepewny z `generation-request-retry.spec`); ponowne otwarcie modala odtwarza stan oczekującego polecenia — pola wyłączone, `generate-submit` z etykietą „Ponów tworzenie", `api-error` widoczny.
- `deck-kind-N` zachowuje testid; przy ikonie rodzaju tekst rodzaju („Słówka"/„Lekcja") jako `sr-only` — asercja `toHaveText` z `lesson-parent.spec` przeżywa bez zmian. Filtr rodzaju dostaje `data-testid="deck-kind-filter"` (segmented control) z jedną asercją e2e.
- Przyciski akcji (generate/createEmpty/newLesson) i cała logika retry/idempotencji — kod przeniesiony, nie przepisany; `onAuthExpired` i `requestLeave` zachowane.

- [ ] RED jednostkowy `deck-list-grouping.test.ts`: kolejność grup, stabilność kolejności w grupach, archiwum tylko pod flagą, filtr rodzaju, pusty zestaw danych. Wiążąca asercja:

```ts
const rows = [pub("B"), review("A"), draft("C"), pub("D")];
expect(groupDecksByState(rows).map((g) => [g.id, g.decks.map((d) => d.title)]))
  .toEqual([["review", ["A"]], ["published", ["B", "D"]], ["draft", ["C"]]]);
```

- [ ] RED e2e: zaktualizować wskazane spece — przed `generate-submit`/`new-lesson-submit`/`create-empty-submit` dodać otwarcie modala (`new-material-open` + wybór opcji; w `parent-edit-protection` 7 miejsc); asercje grup (sekcja „Wymaga Twojej uwagi" nad „Gotowe do nauki"); `deck-row-N` liczone naprzemiennie przez grupy; jedna asercja `deck-kind-filter`. Potwierdzić porażki przed implementacją.
- [ ] Zaimplementować grupowanie + modal (natywny `<dialog>`, fokus na otwarciu, powrót fokusu na przycisk otwarcia, Esc zamyka — zamknięcie blokowane gdy `generating` **lub** `pendingGenerationCommand`/`pendingEmptyCommand` ≠ null; reopen odtwarza stan oczekującego polecenia — dodać krok testowy reopen-retry w `generation-request-retry.spec`), wiersze zestawu wg specu §2.2 (ikona rodzaju, meta bez nowych pól — na razie sam rodzaj i stan; pola DTO wchodzą w Zadaniu 3), przycisk „Usuń z listy" lekcji zachowuje `aria-label` i dialog potwierdzenia.
- [ ] GREEN: nowe testy jednostkowe + wszystkie wskazane spece e2e + `pnpm test:e2e tests/e2e/generation-request-retry.spec.ts` (krytyczne: zachowanie retry po niepewnym wyniku sieciowym w modalu). Commit `feat: group deck list and move creation into dialog`.

## Zadanie 3: Meta wiersza zestawu — rozszerzenie `DeckSummaryDto`

**Pliki:** `packages/contracts/src/decks.ts`, `packages/server/src/modules/decks.ts`, `tests/integration/decks-management.test.ts`, `DecksPanel.tsx` (wyświetlanie meta), `parent.css`, `messages.ts` (wzorce „{n} słówek", „{n} ćwiczeń", „{names}", „sprawdzian {date}").

**Interfejsy:**

- `DeckSummaryDto += { itemCount?: number; assignedChildren?: { childId: string; displayName: string; testDate: string | null }[] }` — opcjonalne, z dokumentacją „brak pola = starszy serwer".
- `listDecks`: poza obecnym zapytaniem dwa zbiorcze — (a) licznik `itemRevisions` per `versionId` dla wersji reprezentatywnych (published ?? editable) mapowany na decki; (b) aktywne przypisania (`assignments.active = true`) z join `childProfiles` (displayName), pogrupowane per deck. Bez zapytań per wiersz. Świadoma decyzja: dla decku w stanie `review` `itemCount` liczy wersję **opublikowaną** (reprezentatywną dla dziecka), nie szkic pod oglądem — nie „naprawiać" tego przy implementacji. Kolejność `assignedChildren` jak istniejące `deckAssignments` (sort po `child_profiles.created_at, id`).

- [ ] RED integracyjny w `decks-management.test.ts`: deck opublikowany z 3 pozycjami i 2 przypisaniami (jedno z `testDate`) → `itemCount = 3`, `assignedChildren` z imionami i terminem; deck szkic bez przypisań → `itemCount` z wersji edytowalnej, `assignedChildren = []`; brak wersji → `itemCount = 0`; lekcja liczy ćwiczenia tak samo (wspólna tabela `item_revisions`). Zapisać oczekiwane porażki (pola nie istnieją).
- [ ] Implementacja DTO (Zod `.optional()` po obu stronach) + `listDecks` batchowo; walidacja schematem w testach kontraktowych jeśli istnieją (dopilnować zgodności `schemaVersion` — bez bumpu, zmiana addytywna).
- [ ] Wyświetlić meta w wierszu zestawu (kinds: słówka „{n} słówek", lekcja „{n} ćwiczeń"; przypisane dzieci skrócone do 2 + „+1"; najbliższy `testDate` gdy obecny). Serwer bez pól (np. stare buildy) → wiersz bez meta, bez błędów.
- [ ] GREEN: integracyjne + `pnpm test:unit packages/contracts`, `pnpm test:e2e tests/e2e/manual-deck-flow.spec.ts`, `pnpm typecheck`. W dzienniku odnotować analizę wpływu MCP (learning-overview nie czyta `/api/v1/parent/decks`; bez regeneracji JSON Schema konsumenta). Commit `feat: deck list meta through optional summary fields`.

## Zadanie 4: Karty dzieci

**Pliki:** modyfikacje `ChildEditor.tsx`, `parent.css`, `messages.ts`; spece `parent-flow`, `parent-edit-protection`.

- Zachować wszystkie testidy i akcje: `child-row-N` (pozostaje na elemencie `li` opakowującym kartę — selektory `li[data-testid^="child-row-"]` w `parent-flow.spec`), `child-learn-link` (href bez zmian), `child-edit`, `child-settings-N`, `child-edit-*`, `child-name`, `child-avatar`, `child-year`, `child-add`, `child-threshold-*`, `child-attempts`, `child-settings-save`, `child-attempt-row`. Zmiana wyłącznie markupu/klas: siatka kart (avatar z `avatarKey` przez istniejące mapowanie), „Rozpocznij naukę" primary, „+ Dodaj dziecko" karta przerywana rozwijająca istniejący formularz, panel wymowy zwijany bez zmian logiki.
- [ ] RED e2e: w `parent-flow.spec.ts` dodać asercję układu kart (widoczny avatar, primary „Rozpocznij naukę", przycisk dodawania jako karta); potwierdzić porażkę.
- [ ] Implementacja wizualna; brak zmian w logice CRUD, potwierdzeniach usuwania i zapisie progów.
- [ ] GREEN: `pnpm test:e2e tests/e2e/parent-flow.spec.ts tests/e2e/parent-edit-protection.spec.ts`, `pnpm typecheck`. Commit `feat: child profile cards layout`.

## Zadanie 5: Postępy — filtry, auto-load, karta „Opanowanie"

**Pliki:** nowe `build-skill-rows.ts` + `.test.ts`; modyfikacje `ProgressPanel.tsx`, `ParentApp.tsx`, `parent.css`, `messages.ts`; spece `progress-panel`, `mock-test-parent`, `kid-flow` (scenariusz A22 używa `progress-child`/`progress-deck`/`progress-load` i tekstów `progress-skill-*`).

**Interfejsy:**

- `buildSkillRows(progress: ProgressDto): ReadonlyArray<{skill: ReportSkill; total: number; known: number; segments: {mastered: number; needsConfirmation: number; practicing: number; notAssessed: number}}>` — `known` jak dotychczasowa reguła (mastered lub needs_confirmation bez `meaningChanged`, per item); `needs_reconfirmation` liczy się do `needsConfirmation` segmentu (wizualnie bursztyn jak dziś); suma segmentów = total; total=0 → wiersz z pustym paskiem i „0/0".
- Auto-load: `useEffect` na `[childId, deckId]` wywołuje `load()` gdy oba niepuste; guard kolejności (rosnący `requestSeq` w ref; odpowiedź stosowana tylko gdy najnowsza); stan ładowania (subtelny wskaźnik, testid `progress-loading`); błędy jak dotychczas. Przycisk „Pokaż postępy" (`progress-load`) usunięty.
- **401 (zmiana semantyczna, własne RED→GREEN):** `ParentApp` przekazuje nowy prop `onAuthExpired` do `ProgressPanel`; `load()` przy odpowiedzi 401 woła `onAuthExpired()` zamiast zostawiać tekst błędu (dziś `ProgressPanel` w ogóle nie obsługuje 401 — z auto-load bez przycisku byłby to martwy ekran bez powrotu do logowania).
- **Synchronizacja wyboru z listami:** efekt ustawia `childId` na pierwszy dostępny, gdy jest pusty albo nieobecny w `childrenList`; analogicznie `deckId` wobec `published` (dziś `useState` inicjalizuje raz — wejście w zakładkę zanim `refreshChildren`/`refreshDecks` dojdą zostawia pusty wybór na stałe; to samo po usunięciu dziecka).
- Przełącznik dziecka: chipy z avatarami, grupa `data-testid="progress-child"`, chipy `data-testid="progress-child-option"` z `aria-pressed`; select zestawu bez zmian (`progress-deck`); odznaka „Sprawdzian" z `progress.testDate` (format `dd.mm.rrrr`, helper z testem gdy formatowanie niestandardowe).
- Karta „Opanowanie": `data-testid="progress-skills"` zachowany, wiersze `progress-skill-<skill>` zachowane; każdy pasek `role="img"` z etykietą „x z N: opanowane a, do potwierdzenia b, w trakcie c, nie sprawdzono d"; jedna legenda pod kartą (teksty z `messages`).

- [ ] RED `build-skill-rows.test.ts`: segmenty/known/total z meaningChanged, needs_reconfirmation→bursztyn, total=0, suma=total.
- [ ] RED e2e `progress-panel.spec.ts`: usunąć kliknięcia `progress-load`, dodać oczekiwanie auto-load po zmianie chipa dziecka (`progress-child-option`) i selectu zestawu; asercja pasków (etykieta aria zawiera liczby) i legendy. W `kid-flow.spec.ts` (A22) zamienić `selectOption`+`progress-load` na chipy/auto-load, a tekstowe asercje `progress-skill-*` („w trakcie nauki: 2") na asercje etykiet aria pasków. Dodać przypadek 401: `page.route` fulfill 401 na `/api/v1/parent/progress` → panel wraca do ekranu logowania (`auth-secret` widoczny).
- [ ] Implementacja; chronić przed podwójnym fetchem przy montu+zmianie; puste stany (brak publikowanych zestawów) bez zmian. Test synchronizacji wyboru: e2e z opóźnionym fulfill `/api/v1/parent/children` (wejście w zakładkę Postępy przed dolą listy → chipy pojawiają się i wybór ustawia się sam).
- [ ] GREEN: jednostkowe + `pnpm test:e2e tests/e2e/progress-panel.spec.ts tests/e2e/mock-test-parent.spec.ts tests/e2e/kid-flow.spec.ts`, `pnpm typecheck`. Commit `feat: progress filters auto-load and mastery bars`.

## Zadanie 6: Postępy — aktywność, kartkówka, listy pomocnicze

**Pliki:** nowe `progress-lists.ts` + `.test.ts`; modyfikacje `ProgressPanel.tsx`, `MockTestReportPanel.tsx`, `parent.css`, `messages.ts`; spec `progress-panel`, `mock-test-parent`.

**Interfejsy:**

- `dueEntries(items: ProgressItemDto[]): ReadonlyArray<{skill: ReportSkill; target: string}>` — zastępuje konkatenację stringów; kolejność stabilna jak dziś.
- `formatHistoryWhen(receivedAt: string, now: Date): string` — „dziś, 17:09" / „wczoraj, 18:44" / „12.10, 17:03" (Intl pl-PL, kontrolowany `now` w testach).
- Karta aktywności: testidy `progress-activity*` i `progress-activity-day-<date>` bez zmian; kafelki odświeżone wizualnie; 4 liczby kluczowe (czas/dni/podejścia/odpowiedzi) + drobny rozkład per zestaw. „Kliknięcia" (interactions) znikają z widoku — świadoma decyzja designu (dane pozostają w DTO).
- Kartkówka: nagłówek `9/12 · 75%` + gwiazdki (istniejące helpery `mockTestScoreTone`/score mogą być importowane z `@learning/kid-ui` bez zmian); wiersze słów z ikoną `ParentIcon` i chipami per umiejętność — markup własny panelu rodzica (klasy `pp-*`), testidy `mock-report-*` bez zmian; nota „nie jest szkolną oceną" zachowana.
- „Do ćwiczeń": chipy `słowo + umiejętność`; „Pomyłki": wiersze `expected → answered (n×)` z licznikiem; „Historia": wiersze z ikoną wyniku (check/x/minus), czasem z `formatHistoryWhen` i tagiem „z wsparciem".

- [ ] RED `progress-lists.test.ts`: dueEntries (skill+target, kolejność, `DUE_STATUSES` bez zmian), formatHistoryWhen (dziś/wczoraj/data, przełom północy z kontrolowanym zegarem). RED e2e w `progress-panel.spec.ts`: usunąć asercję `Kliknięcia: 210` (linia ~106), zastąpić asercjami 4 liczb kluczowych (czas/dni/podejścia/odpowiedzi) i obecności kafelków.
- [ ] Implementacja wizualna; bez zmian źródeł danych i warunków pustości.
- [ ] GREEN: jednostkowe + `pnpm test:e2e tests/e2e/progress-panel.spec.ts tests/e2e/mock-test-parent.spec.ts`, `pnpm typecheck`. Commit `feat: progress activity mock-test and practice lists redesign`.

## Zadanie 7: Postępy — tabela słów i wymowa

**Pliki:** modyfikacje `ProgressItems.tsx`, `ProgressPanel.tsx` (wymowa), `parent.css`, `messages.ts` (legenda kropek); spec `progress-panel`.

- Tabela desktop: komórki statusu jako kolorowa kropka (`progress-status-*` klasy zamienione na `pp-dot-*`; testidy komórek nie istniały — asercje speków weryfikować); kolumny jak dotychczas + `meaningChanged` jako drobny bursztynowy dopisek pod znaczeniem; nagłówek tablicy sticky; legenda kropek pod tabelą. Układ mobilny (karty) odświeżony do tych samych statusów bez zmiany treści.
- Wymowa: wiersze słowo/pasek/wartość/chip pasma; `progress.pronunciationNote` i nazwa providera bez zmian; `progress-pronunciation` testid zachowany.
- [ ] RED e2e: w `progress-panel.spec.ts` dodać asercje legendy kropek (4 statusy) i obecności kropek w wierszach; potwierdzić porażkę.
- [ ] Implementacja; доступność: kropka + `sr-only` tekst statusu (czytnik ekranu czyta status, nie kolor).
- [ ] GREEN: `pnpm test:e2e tests/e2e/progress-panel.spec.ts`, `pnpm typecheck`. Commit `feat: word status dots and pronunciation bars`.

## Zadanie 8: Spójność edytorów, sprzątanie CSS, dokumentacja, weryfikacja końcowa

**Pliki:** `DeckEditor.tsx`, `lessons/LessonEditor.tsx`, `lessons/NewLessonForm.tsx`, `LeaveEditorDialog.tsx`, `DeckConflictPanel.tsx`, `AssignmentTestGoalFields.tsx` (wyłącznie klasy/ikony), `globals.css` (usunięcie martwych reguł po migracji), `docs/SPEC.md` (§5/§25 opis nowego układu), ewentualnie `docs/architecture.md` (adnotacja o opcjonalnych polach DTO).

- Edytory dostają tokeny (przyciski, karty, chipy) bez zmian struktury, testidów i logiki (leave-guard, konflikty, publikacja, pokrycie etapów). `lesson-parent-supervision` i `lesson-parent` przechodzą bez zmian — to detektor regresji.
- Sprzątanie: usunąć z `globals.css` reguły zastąpione przez `parent.css` (weryfikacja po pełnym przejściu speków; martwe klasy wyłącznie po potwierdzeniu braku użyć).
- Dokumentacja: SPEC §5/§25 zaktualizowane pod nowy układ; w PR — wpływ API→MCP→skill (brak zmian MCP, uzasadnienie).
- [ ] Pełna weryfikacja: `pnpm typecheck && pnpm test:unit && pnpm test:integration && pnpm build` oraz pełny pakiet e2e panelu: `pnpm test:e2e tests/e2e/parent-flow.spec.ts tests/e2e/progress-panel.spec.ts tests/e2e/mock-test-parent.spec.ts tests/e2e/manual-deck-flow.spec.ts tests/e2e/generation-request-retry.spec.ts tests/e2e/lesson-parent.spec.ts tests/e2e/lesson-archive.spec.ts tests/e2e/navigation.spec.ts tests/e2e/parent-edit-protection.spec.ts tests/e2e/lesson-real-flow.spec.ts tests/e2e/lesson-mock-test.spec.ts tests/e2e/kid-flow.spec.ts` (shard/izolacja wg konwencji).
- [ ] Ręczny smoke na `pnpm dev` (lub lokalnym compose): login → wszystkie 3 zakładki → modal tworzenia → edytor zestawu → Postępy z auto-load; sprawdzenie mobile 360 px i 200% tekstu (bez utraty treści i działań).
- [ ] Commit `feat: parent panel editors token consistency and cleanup`; następnie bramka `requesting-code-review` dla całego zakresu (Review Focus wyżej), potem `finishing-a-development-branch` (PR do `main`, squash przez właściciela).

## Kryteria ukończenia

- Wszystkie zadania z dowodami RED→GREEN w dzienniku; pełny zestaw komend z Zadania 8 zielony na HEAD gałęzi.
- Niezależny review całego zakresu (BASE=6faf279..HEAD) wykonany, uwagi Critical/Important rozwiązane, Minor odłożone w dzienniku.
- Dokumentacja (SPEC, w razie potrzeby architecture) zaktualizowana; wpływ na MCP/SKILL.md przeanalizowany i odnotowany w PR.

## Review planu (2026-10-14)

Niezależny recenzent-subagent (GLM-5.3, najmocniejszy dostępny model; skillsy `superpowers:*` niedostępne w środowisku — bramka wykonana ręcznie wg zasad AGENTS.md) zweryfikował plan wobec kodu na `6faf279`: werdykt **APPROVE_WITH_CHANGES**, 0 Critical / 7 Important / 7 Minor; wszystkie twierdzenia planu o kodzie potwierdzone (listy plików/testidów, DTO, schema, MCP no-impact, wzorce `<dialog>`). Naniesione poprawki: I1 obsługa 401 w Postępach przez nowy prop `onAuthExpired` (własne RED→GREEN), I2 `kid-flow.spec` w Zadaniu 5, I3 `parent-edit-protection.spec` w Zadaniu 2, I4 `deck-kind-N` z tekstem `sr-only`, I5 blokada zamknięcia modala w stanie niepewnym + reopen-retry, I6 synchronizacja wyboru dziecka/zestawu z opóźnionymi listami, I7 aktualizacja asercji „Kliknięcia"; Minory M1–M7 wliczone (nazwa `DeckDto`, szerokość 1040→960, `aria-current="true"`, `li[data-testid^="child-row-"]`, `deck-kind-filter`, zasada blokady, nota o reprezentatywnej wersji).
