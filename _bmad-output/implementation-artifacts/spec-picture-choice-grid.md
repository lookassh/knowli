---
title: 'Obrazkowy wybór odpowiedzi bez przewijania'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'ced8cf420e2919d67cd45b60f95a11cd1dfa20ed'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/docs/SPEC.md'
  - '{project-root}/docs/architecture.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** W „Posłuchaj i wybierz” pionowa lista podpisanych opcji wymusza przewijanie, mimo wolnego miejsca na telefonie. Podpisy są zbędne dla dzieci znających cyfry, a jabłka utrudniają szybkie odczytanie liczby.

**Approach:** Zastąpić listę elastyczną siatką dwóch kolumn: trzecia opcja po lewej, czwarta po prawej w drugim rzędzie. Pokazywać tylko wizualizację, zachować podpis jako nazwę dostępną, a liczby w kafelkach wyświetlać cyframi. Typowy widok telefonu mieści odpowiedzi bez przewijania.

## Boundaries & Constraints

**Always:** Zachowaj natywne przyciski, klawiaturę, polskie nazwy dostępne, widoczny feedback i stabilny obszar wyniku. Obsłuż 2–4 opcje; serwer dodaje tylko różne, niezarezerwowane dystraktory. Przy powiększeniu lub niskim widoku pozostaw przewijanie. Cyfry dotyczą tylko kafelków tego ćwiczenia.

**Never:** Nie usuwaj etykiet z kontraktu ani danych odpowiedzi; nie zmieniaj zasad ekspozycji, punktacji, sesji ani innych ćwiczeń; nie deklaruj odbioru na fizycznym Galaxy S25 bez próby na urządzeniu.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 3 choices | Trzy opcje | Układ `A B / C`, bez przewijania w typowym widoku | Niski widok zachowuje scroll |
| 4 choices | Cztery różne opcje | Układ 2×2, bez przewijania w typowym widoku | Odrzuć duplikaty i niepoprawne dystraktory |
| Number / zoom | Cyfra albo powiększenie | Cyfra w kafelku; focus i wszystkie akcje pozostają dostępne | Niski viewport może przewijać |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/kid.ts` — obecne maksimum 3 dla `picture_listening`; podnieść do 4.
- `packages/server/src/domain/picture-recognition-options.ts` — wybór/deduplikacja wizualnych dystraktorów i klucze ujawnień; zwiększyć limit, zachować filtrowanie i rotację.
- `packages/kid-ui/src/exercises/PictureListeningView.tsx`, `visuals/NumberVisual.tsx`, `visuals/MeaningVisualView.tsx` — przyciski, dostępne nazwy i cyfrowy wariant renderera.
- `packages/kid-ui/src/styles.css` — obecny przewijalny układ listy; dopasować elastyczną siatkę do viewportu.
- `tests/e2e/picture-choice-layout.spec.ts`, `picture-vocabulary.spec.ts`, `packages/server/src/domain/picture-recognition-options.test.ts`, `packages/kid-ui/src/visuals/NumberVisual.test.ts` — geometria, interakcja, dystraktory i cyfry.
- `docs/architecture.md` — odnotować układ oraz brak fizycznego odbioru S25; `learning-overview` nie jest konsumentem promptów Kid.

## Tasks & Acceptance

**Execution:**
- [x] Kontrakt Kid i `picture-recognition-options.ts` — dopuścić 4 opcje; zachować walidację, deduplikację, rotację i semantykę ujawnień.
- [x] Widok, renderer `NumberVisual` i style Kid UI — elastyczna siatka bez widocznych podpisów, z polską nazwą dostępną; cyfrę używać tylko w kafelku.
- [x] Testy jednostkowe/E2E z Code Map — sprawdzić 3/4 opcje, geometrię, klawiaturę, feedback, cyfry, nazwy, zoom i fallback.
- [x] `docs/architecture.md` — opisać zmianę i brak próby na fizycznym S25.

**Acceptance Criteria:**
- Given 3 lub 4 odpowiedzi, when otwiera się ćwiczenie, then kafelki tworzą `A B / C [D]`, bez widocznych podpisów i przewijania w typowym widoku telefonu.
- Given odpowiedź liczbowa, when jest renderowana w kafelku, then pokazuje dużą cyfrę zamiast jabłek.
- Given kafelek lub błędny/poprawny wynik, when dziecko używa technologii asystującej albo klawiatury, then opcja ma polską nazwę, działa wybór i widoczny feedback nie zasłania wizualizacji.
- Given zoom albo niski viewport, when siatka nie mieści się, then odpowiedzi oraz akcje pozostają osiągalne przez przewijanie.
- Given zmiana promptu Kid API, when ocenia się MCP, then `learning-overview` i skill Hermesa pozostają bez zmian, bo nie konsumują promptów Kid.

## Implementation Notes

## Spec Change Log

## Review Triage Log
- `false` — Żądanie aktualizacji JSON Schema/skilla MCP: pliki MCP walidują `learning-overview`, który nie zawiera `TaskPrompt`; spec jawnie potwierdza brak wpływu tego promptu Kid.
- `maybe-false` / `defer` — Zgodność starszego klienta picture obsługującego najwyżej trzy opcje: serwer wymaga `supportsPictureVocabulary`, lecz nie rozróżnia limitu opcji. Nie wiadomo, czy taka wersja jest wdrożona i może wznowić sesję po aktualizacji; rozstrzygnie to audyt wdrożonych klientów.
- `patch` — Pokrycie geometrii czterech kafelków: istniejący E2E sprawdza 2×2 w niskim widoku z przewijaniem, więc nie dowodzi braku przewijania w typowym telefonie ani minimalnych wymiarów kafelków. Dodano test typowego viewportu.
- `low` / `patch` — Test geometrii trzech opcji dopuszcza 12 px nadmiarowej wysokości mimo asercji braku przewijania; zaostrzono asercję do braku nadmiaru.
- `false` — Test generatora nie sprawdza odrębności czterech odpowiedzi: istniejące asercje weryfikują komplet czterech różnych etykiet i wizualizacji, a osobny przypadek odrzuca kolizje semantyczne i wizualne.
- `patch` — Brak integracyjnej ścieżki sesji dla czterech opcji: test generatora nie pokrywa planowania/materializacji promptu; rozszerzono test sesji, by sprawdzał cztery opcje i przesłanie czwartej.

- `medium` / `patch` — Zrzut ujawnił, że wizualizacje mogły wystawać poza obrys kafelków przy niższym widoku; ograniczono ich rozmiar do kafelka i dodano asercje geometrii.
- `low` / `patch` — Siatka trzech kafelków rozkładała wolną przestrzeń między wierszami i nadmiernie odsuwała trzeci kafelek; wiersze mają teraz wysokość kafelka i są wyrównane od góry.
## Design Notes

Trzy kafelki tworzą `A B / C`, cztery `A B / C D`; trzeciego nie centruj, by nie sugerować wyróżnienia. Podpis pozostaje nazwą przycisku dla czytników ekranu.

## Verification

- Testy jednostkowe uruchomione przez lokalny binarny `node_modules/.bin/vitest.CMD`: 26/26 dla kontraktu, wyboru dystraktorów i renderera liczby.
- Test integracyjny uruchomiony przez lokalny binarny Vitest: `tests/integration/sessions.test.ts` — 44/44, w tym wygenerowanie czterech opcji i wybór czwartej.
- Playwright: `tests/e2e/picture-choice-layout.spec.ts` oraz `tests/e2e/picture-vocabulary.spec.ts` — 13/13. Sprawdzono 3/4 kafelki, geometrię, nazwy dostępnościowe, klawiaturę, feedback, zoom, niski widok i dark mode.
- TypeScript: wszystkie sześć konfiguracji workspace przeszło (`tsconfig.json`, contracts, server, web, worker, kid-ui). `git diff --check` bez uwag.
- `pnpm` próbował odtworzyć zależności, po czym przerwał z `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; użyto istniejących lokalnych binariów. Nie instalowano ani nie usuwano zależności.
- Obejrzano zrzuty 390×844, 360×640 i dark mode; wizualizacje mieszczą się w kafelkach. Odbiór na fizycznym Galaxy S25/PWA nie został wykonany.