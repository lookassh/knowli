# Dziennik implementacji — redesign panelu rodzica

Plan: `docs/superpowers/plans/2026-10-14-parent-panel-redesign.md`. Baza wykonania: `1d5399d` (origin/main; plan pisałem na `6faf279` — różnica to #64, dotyczy wyłącznie `tests/e2e/kid-flow.spec.ts` +4 linie, bez kolizji). Worktree: `C:/Users/looka/.zcode/worktrees/knowli/parent-panel-redesign`, gałąź `feature/parent-panel-redesign`.

Środowisko: skillsy `superpowers:*` niedostępne — bramki (executing-plans, TDD, verification-before-completion, requesting-code-review, finishing-a-development-branch) wykonywane ręcznie wg zasad AGENTS.md; dowody poniżej.

## Setup

- [x] Worktree z `origin/main` (1d5399d), `.env` przez `node scripts/setup-worktree.cjs`, zależności (pnpm 10.34.6, frozen-lockfile).
- [x] Baseline: `vitest run apps/web/src/parent` → 37/37; `pnpm typecheck` → czysto.

## Zadanie 1 — rama aplikacji (commit 51e7bfb)

- RED: `navigation.spec.ts` „zakładki z ikonami i stanem aktywnym" → fail `svg not found` w tab-decks (właściwa przyczyna: brak ikon).
- GREEN: `ParentIcon.tsx` (29 ikon inline SVG, wzorzec KidIcon), `parent.css` (tokeny §2.5 specu), `ParentApp.tsx` (topbar + zakładki aria-current="true", ekran logowania jako karta). `messages.app.parentPanel`.
- Dowody: `test:e2e navigation.spec.ts` → 2 passed; `tsc apps/web` OK.
- Odstępstwo: brak.

## Zadanie 2 — modal i grupowanie (commit 9d5868d)

- RED unit: `deck-list-grouping.test.ts` (kolejność grup, stabilność, archiwum, filtr) → Cannot find module.
- RED e2e: `manual-deck-flow` „grupuje listę zestawów" → `deck-group-draft` not found.
- GREEN: `deck-list-grouping.ts`, `NewMaterialDialog.tsx` (natywny `<dialog>`, fokus/Esc/powrót fokusu), `DecksPanel.tsx` (grupy, chipy, ikona rodzaju z `sr-only` tekstem — asercja `deck-kind-N toHaveText("Lekcja")` przechodzi), helper e2e `parent-new-material.ts`; aktualizacja 9 speków.
- Spek testów: manual-deck-flow 12, generation-request-retry 11, parent-edit-protection 7, parent-flow, lesson-parent, lesson-real-flow, lesson-mock-test, lesson-archive, kid-flow — łącznie zielone (po naprawach selektorów poniżej).
- **Odstępstwa od planu** (uzasadnione):
  1. Zamykanie modala w trakcie `generating` pozostaje dozwolone (plan: blokada) — wymaga tego istniejący test „late acceptance after leaving the decks tab" (generation-request-retry:308). Zamiast blokady: stan niepewny (`pendingGenerationCommand`/`pendingEmptyCommand`) przeżywa zamknięcie, reopen wraca do kroku z „Ponów tworzenie" (nowy krok w speku retry, linia ~84).
  2. Pozycyjne `deck-row-N` w testach („najnowsza lekcja pierwsza") złamałoby grupowanie — wiersze dostają `data-deck-id`, testy wybrane po identyfikatorze; `deck-row-N` zachowane (numeracja przez grupy) i dalej testowana.
  3. Zapis szkicu lekcji nie aktualizuje `decks.title` (dopiero publikacja) — tytuł z edytora nie trafia do listy; testy klikają po `data-deck-id`.

## Zadanie 3 — meta DTO (commit 9abe216)

- RED integracyjny: `decks-management.test.ts` „listDecks podaje opcjonalne meta" → pola undefined.
- GREEN: `DeckSummaryDto += itemCount?/assignedChildren?` (+ `DeckAssignedChildDtoSchema`); `listDecks` — dwa zapytania zbiorcze (count per `item_revisions.deck_version_id`; aktywne przypisania z joinem profilów, sort jak `deckAssignments`), zero N+1. UI: meta wiersza (liczba z polską liczbą mnogą `polishPlural`, dzieci 2+„+1", najbliższy termin).
- Dowody: integracyjne 9/9; unit 45/45; e2e regresja „grupuje"+"pełny obieg" 2 passed. `tsc` server/contracts OK.
- Decyzja z planu potwierdzona: `itemCount` liczy wersję reprezentatywną (published ?? editable), dla review to publikowana.

## Zadanie 4 — karty dzieci (commit d4f2cfd)

- RED: parent-flow „karty profili" → `.pp-child-avatar` not found.
- GREEN: siatka kart (avatar/imię/meta/akcje), „Rozpocznij naukę" primary, „Dodaj dziecko" jako karta z przerywaną ramką — **odstępstwo**: formularz dodawania zawsze widoczny (plan: rozwijany), bo 10 miejsc e2e wypełnia `child-name` bezpośrednio; rozwijanie byłoby czystą regresją pokrycia bez wartości produktowej.
- Wspólny moduł `avatars.ts` (wykorzystany potem w chipach Postępów).
- Dowody: parent-flow 13/13.

## Zadanie 5 — Postępy: filtry, auto-load, 401, paski (commit 8a8a34a)

- RED unit: `build-skill-rows.test.ts` → Cannot find module. RED e2e: usunięte `progress-load`, asercje aria pasków, 401-test, kid-flow A22 na etykiecie aria.
- GREEN: `buildSkillRows` (reguła known 1:1 z dotychczasową `knownCount`; needs_reconfirmation→bursztyn; total=0 bezpieczne); chipy dziecka (`progress-child-option`, aria-pressed, avatary); select zestawu bez zmian; auto-load z guardem `requestSeq` (przestarzałe odpowiedzi ignorowane); synchronizacja wyboru z listami (pusty/nieobecny → pierwszy); **401 → nowy prop `onAuthExpired`** (zmiana semantyki, własny e2e z fulfill 401 → ekran logowania); odznaka „Sprawdzian: dd.mm.rrrr".
- Dowody: unit 49/49; progress-panel 4/4; mock-test-parent 2/2; kid-flow A22 („recall z należnego...") 1 passed.
- Poprawka testowa: `mock-test-world` zwraca `childName` (spec klika chip po imieniu z seeda).

## Zadanie 6 — aktywność, kartkówka, listy (commit ebf7fe8)

- RED unit: `progress-lists.test.ts` (dueEntries para skill+target; formatHistoryWhen) → 2 fails strefowe → implementacja liczy dni/godziny w UTC (stabilna etykieta niezależnie od strefy).
- GREEN: karta aktywności — kafelki 7 dni + 4 liczby kluczowe (czas/dni/podejścia/odpowiedzi); rozkład per zestaw drobnym wierszem; „Kliknięcia" świadomie poza widokiem (dane w DTO nietknięte, asercja `not.toContainText("Kliknięcia")`). „Do ćwiczeń" jako chipy; pomyłki z licznikiem; historia z ikoną wyniku i znacznikiem „dziś/wczoraj/data" + tag „z wsparciem". Kartkówka: wynik `9/12 · 75%` + gwiazdki jako nagłówek, kompaktowe wiersze z ikonami, nota zachowana. `MOCK_TEST_SOLUTION_ICONS` i import styles.css z kid-ui usunięte z panelu (ikony własne; `mockTestResultBadgeClass/Label/ScoreTone` nadal z kid-ui — kontrakt dotknięty tylko od strony prezentacji).
- Poprawka współdzielonego świata: unikalna nazwa dziecka w fixture (`Kartkówka xxxxxxxx`) — kolizje chipów przy dwóch seedach.
- Dowody: unit 52/52; progress-panel+mock-test-parent+mock-test 11/11.

## Zadanie 7 — tabela słów i wymowa (commit 8012cc6)

- RED: asercja legendy kropek w `progress-panel` → fail na 1280px.
- GREEN: `ProgressItems` — desktop tabela z kropkami statusu (`sr-only` tekst statusu przy kropce), legenda nad tabelą, sticky nagłówek zbędny (kropki kompaktowe); mobile karty bez zmian kontraktu; przełączanie układów przeniesione do `parent.css` (stare klasy `progress-items-table/cards` już nieużywane przez panel — czystka w Zadaniu 8). Wymowa: wiersz słowo/pasek/wartość/chip pasma + nota o usłudze.
- Dowody: progress-panel 4/4; `tsc` OK.

## Zadanie 8 — dokumentacja i pełna weryfikacja

- SPEC §5 (rama, modal, grupy, auto-load, 401) i §25 (kropki+legenda, 4 liczby kluczowe, „Kliknięcia" poza widokiem, przykład) zaktualizowane.
- `git diff --check` czysty.
- Dowody pełne: unit 110 plików / 1082 testów OK; integration 37 plików / 362 OK (UMIEM_TEST_RUN_ID=parent-redesign); typecheck OK; build OK; pełny pakiet 13 speków e2e — wynik odnotowany poniżej po zakończeniu runu.

## Review implementacji (niezależny subagent, GLM-5.3)

- Runda 1 (całość 1d5399d..87953e7): **APPROVE_WITH_CHANGES** — I1 duplikat parent.css (x2), I2 nieostylowane odznaki/ton kartkówki, I3 naruszenia ≥44px i kontrastu; M1–M6. Naprawione w 700e24f (+ usuwanie 13 martwych kluczy messages, fokus kroków modala, stabilny toLogin, plan+spec w gałęzi).
- Runda 2 (diff 700e24f): **REQUEST_CHANGES** — N1 resztka duplikatu tokenów, N2 data-tone „high" zamiast „good", N3 pp-btn-icon 38px na przyciskach destrukcyjnych; doszyto M3 (fokus na nagłówek przy zablokowanym submit). Naprawione w 058c755.
- Runda 3 (diff 058c755): **APPROVE**. Otwarty Minor: inline `style={{outline:"none"}}` mógłby być regułą CSS (kosmetyka, odłożone).
- Smoke po iteracjach naprawczych: 28/28 (progress-panel, generation-request-retry, manual-deck-flow); typecheck zielony.

## Pełna weryfikacja (HEAD=058c755+docs)

- unit: 110 plików / 1082 testów OK; integration: 37 / 362 OK; typecheck OK; build OK.
- e2e pakiet 13 speków panelu: 77/79 w pierwszym pełnym przebiegu → 2 naprawione (supervision: brak otwarcia modala — mój niedopatrzeń patch z Zadania 2; grupowanie: asercja zakładała pusty świat) → rerun 14/14; CI zweryfikuje pełny pakiet na czystym środowisku.
- git diff --check czysty.

## Wpływ API → MCP → skill

- API: `DeckSummaryDto` rozszerzone o pola **opcjonalne** (addytywne, bez bumpu schemaVersion). Endpointy bez zmian kształtu poza tym.
- MCP: `learning-overview` nie konsumuje `DeckSummaryDto` (parsuje `LearningOverviewDtoSchema` z osobnego endpointu) — brak wpływu; regeneracja JSON Schema konsumenta niepotrzebna.
- SKILL.md: bez zmian (narzędzia i ograniczenia odczytu nietknięte). Uzasadnienie do PR.

## Synchronizacja z main i rozwiązanie konfliktów (2026-10-15)

- Zaktualizowany base `origin/main` do `167579d` (#68; zawiera m.in. słownictwo obrazkowe z #65). Rozwiązałem konflikty w `ChildEditor.tsx`, `DecksPanel.tsx`, `ProgressPanel.tsx`, `packages/contracts/src/messages.ts` i `tests/e2e/progress-panel.spec.ts`.
- Zachowano nowe pola/ustawienia `canRead`, ostrzeżenia o wspólnym awatarze, informację dla profilu nieczytającego i nowe komunikaty audio. Wyboru `vocabularyFormat` nie dało się zostawić w usuniętym formularzu inline, więc został przeniesiony do formularza generowania w dialogu.
- RED: istniejący scenariusz `generation-request-retry` kończył się brakiem `deck-vocabulary-format` w dialogu (locator timed out). GREEN: po dodaniu pola do dialogu wybrany test przeszedł; żądanie ponowienia zachowało `vocabularyFormat: picture`.
- Weryfikacja: unit 119 plików / 1131 testów; integration 39 plików / 389 testów; typecheck; build; 13 speków panelu 81/81.
- Review subagenta całego kandydata względem `origin/main`: **REQUEST_CHANGES**. Trzy uwagi Important: style segmentów paska kolidowały z filtrem, historia wyświetlała czas UTC, a E2E utracił asercje 3 dni / 5 podejść / 84 odpowiedzi. Minor: brak tokenów ekranu auth, selektor kartkówki 38px i pozostawanie starego raportu po błędzie filtra.
- Naprawione uwagi Important: rozdzielone klasy filtra i pasków (segmenty nie kurczą się i nie mają paddingu), historia używa lokalnej strefy i testy konstruują lokalne daty; E2E przywraca asercje wartości kafelków. RED historii potwierdzony przed zmianą (oczekiwane „dziś, 00:10”, otrzymane „wczoraj, 22:10”).
- Weryfikacja poprawek: unit parent 11/11; typecheck; `progress-panel.spec.ts` 4/4; `manual-deck-flow.spec.ts --grep filtr` 1/1; `git diff --cached --check origin/main` czysty. Subagent w drugim review potwierdził geometrię 0/0, 100% i mieszaną (400px: [0,0,0,0], [400,0,0,0], [200,100,100,0]), północ i zmianę czasu DST w Europe/Warsaw oraz brak uwag Important. PR oceniony jako gotowy do merge. Trzy Minor pozostawiono jako odłożone: tokeny auth, wysokość selecta kartkówki 38px, stary raport po błędzie filtra.
