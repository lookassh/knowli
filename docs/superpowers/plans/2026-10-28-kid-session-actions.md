# Kid Session Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Usunąć migający komunikat przejścia i „Pomiń”, skrócić „Nie pamiętam” i ustawić je obok „Sprawdź”, zachowując neutralną kontynuację po awarii.

**Architecture:** Zmiana należy do `packages/kid-ui`; katalog `packages/contracts/src/messages.ts` dostarcza etykiety. Wspólny `ExerciseFrame` otrzymuje opcjonalny układ akcji formularza. Serwer pozostaje właścicielem ocen, ujawnień i transakcji; klient używa obecnych operacji bez nowych zależności między modułami.

**Tech Stack:** React, TypeScript, CSS Modules, Vitest/Testing Library, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-28-kid-session-actions-design.md`

## Global Constraints

- Dokładna etykieta: „Nie pamiętam”; bez ikony.
- Jeden rząd akcji formularza: „Sprawdź” główne, „Nie pamiętam” pomocnicze.
- Cele dotykowe co najmniej 48 px, główna akcja co najmniej 54 px.
- Brak nowych zależności, zmian API, schematu bazy i reguł oceniania.
- Zachować `transitioning`, blokadę wysyłek, obsługę offline i widoczne błędy; usunąć tylko komunikat przejścia.
- Nie zastępować zwykłego „Pomiń” przez „Dalej”. „Dalej” bez oceny jest drogą wyjścia z problemu technicznego.
- Nauka ujawnia odpowiedź po autoryzacji serwera; kartkówka nie ujawnia rozwiązania.
- Nie instalować ponownie zależności: `node_modules` i `.env` są przygotowane.
- Pracować na `feature/kid-session-actions` w worktree `C:/Users/looka/.codex/worktrees/kid-session-actions/knowli`, baza `5163dfd`.

## Review Focus

1. Wolne żądanie i podwójny klik: brak paska przejścia, dokładnie jedna wysyłka (zadanie 1).
2. Puste pole, Enter i kliknięcie „Nie pamiętam”: brak przypadkowego submitu i poprawne blokady (zadanie 2).
3. Odmowa mikrofonu, cisza, niepewne STT i awaria oceniania: dziecko może kontynuować bez deklarowania błędnej wiedzy (zadanie 3).
4. Kartkówka i druga przeglądarka: „Nie pamiętam” nie ujawnia rozwiązania i nie psuje wznowienia (zadanie 3).
5. Klawiatura ekranowa, niski viewport i feedback: przyciski osiągalne, bez poziomego overflow i trwałego zasłonięcia treści (zadanie 4).

## Zadanie 1: Przejście bez migającego komunikatu

**Pliki:** `packages/kid-ui/src/screens/LearnScreen.tsx`, `packages/contracts/src/messages.ts`, `tests/e2e/kid-layout-stability.spec.ts`.

**Interfejsy:** zachować stan kontrolera `transitioning` i publiczne metody; usunąć renderowanie `kid-transitioning` i nieużywaną etykietę `messages.kid.transitioning` po sprawdzeniu referencji.

- [ ] W teście z opóźnioną odpowiedzią API oczekiwać `getByTestId("kid-transitioning").toHaveCount(0)` przez cały czas oczekiwania; zachować asercje geometrii i wykazać jedną wysyłkę mimo ponownego kliknięcia.
- [ ] Uruchomić `pnpm exec playwright test tests/e2e/kid-layout-stability.spec.ts`; potwierdzić porażkę nowej asercji z powodu obecnego paska.
- [ ] Usunąć element komunikatu i jego martwe referencje. Nie usuwać statusu przetwarzania odpowiedzi ani komunikatów offline/błędu.
- [ ] Powtórzyć ten sam spec; wszystkie przypadki mają przejść.
- [ ] Commit: `fix(kid-ui): remove transient transition notice`.

## Zadanie 2: Wspólny rząd akcji pisemnych

**Pliki:** `packages/kid-ui/src/exercises/ExerciseFrame.tsx`, `ExerciseFrame.module.css`, nowy `ExerciseFrame.test.tsx` obok nich; `WrittenView.tsx`, `LetterCompletionView.tsx`, `lesson/LessonGapView.tsx`, `lesson/LessonSentenceView.tsx`; `packages/contracts/src/messages.ts`; `packages/kid-ui/src/exercises/written-controls.test.tsx`, `lesson/lesson-views.test.tsx`, `packages/kid-ui/src/screens/keyboard-navigation.test.tsx`.

**Interfejsy:** dodać opcjonalny prop `actionLayout?: "stacked" | "inline"` do `ExerciseFrame`, domyślnie `"stacked"`. Wariant `inline` łączy istniejące `actions` i `secondaryActions` w jednym rzędzie. Zachować `dock`, sloty i domyślne zachowanie pozostałych widoków.

- [ ] Dodać testy komponentów: dwa przyciski „Sprawdź”/„Nie pamiętam”, brak `kid-skip`; „Nie pamiętam” wywołuje tylko `onNotRemember`, nie `onSubmitText`. Puste pole blokuje „Sprawdź”, lecz pozwala użyć „Nie pamiętam”; busy/nagrywanie blokuje obie akcje. Enter z treścią wysyła raz.
- [ ] Test ramy ma sprawdzić wybór `inline` i domyślne `stacked`, a także zastąpienie akcji przez `dock` bez ukrytych klikalnych duplikatów.
- [ ] Uruchomić `pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises packages/kid-ui/src/screens/keyboard-navigation.test.tsx`; potwierdzić porażki nowych asercji.
- [ ] Wprowadzić wariant ramy i CSS. Główna kolumna elastyczna, pomocnicza dopasowana do tekstu; bez stałych szerokości przycinających tekst, z minimum 54/48 px. Rezerwacja miejsca dla docka ma odpowiadać układowi jednego rzędu. Ustawić `inline` we wskazanych formularzach, usunąć z nich „Pomiń” i skrócić wspólną etykietę.
- [ ] Powtórzyć testy; zachować reset/fokus przy retry, istniejące ograniczenia pisowni i wartość wpisanego tekstu.
- [ ] Commit: `feat(kid-ui): place recall help beside submit`.

## Zadanie 3: Usunięcie pozostałych przycisków i neutralna droga po awarii

**Pliki:** `packages/kid-ui/src/exercises/{ListeningView,PictureRecallView,PictureSpeechView,SpeechView}.tsx`, `packages/kid-ui/src/screens/{LearnScreen,AnswerFeedback,SpeechFeedbackCard}.tsx`, komentarze w `lesson-feedback-view.ts`; w razie potrzeby `exercises/types.ts` i `session/session-controller.ts`; `packages/contracts/src/messages.ts`. Testy: nowy `packages/kid-ui/src/exercises/session-actions.test.tsx`, istniejący `session/session-controller.test.ts`, `tests/e2e/{kid-flow,mock-test,picture-vocabulary,speech-recording-ux}.spec.ts`.

**Interfejsy:** zachować `notRemember(): Promise<void>` i `skip(): Promise<void>` kontrolera. Neutralne „Dalej” korzysta z `skip()` / `{ modality: "skip" }`; nie wywołuje `notRemember()` ani nie ujawnia odpowiedzi. Pomocnicza akcja nie jest dostępna przy zwykłym merytorycznym retry. Jawny stan problemu z mikrofonem/technicznym wynikiem określa dostępność w `LearnScreen` i widokach; nie wykrywać błędów przez dopasowywanie tekstów komunikatów.

- [ ] Testy komponentów obejmą wszystkie wymienione widoki i oba tryby sesji: brak przycisku o nazwie „Pomiń”; zwykłe zadanie i zwykły błędny wynik nie mają neutralnego „Dalej”.
- [ ] Dodać scenariusze odmowy/braku mikrofonu, ciszy po nagrywaniu, niepewnego STT oraz technicznego `not_assessed` lekcji. Sprawdzić dostępną próbę ponowienia i neutralną kontynuację, jedną wysyłkę `skip`, brak `dont_remember`, brak ujawnienia oraz zwolnienie aktywnego nagrywania. Nie klasyfikować poprawnej treści z niedostępną oceną wymowy jako błędu wiedzy.
- [ ] Uruchomić `pnpm exec vitest run --config vitest.unit.config.ts packages/kid-ui/src/exercises/session-actions.test.tsx packages/kid-ui/src/session/session-controller.test.ts`; potwierdzić porażki nowych scenariuszy.
- [ ] Usunąć pozostałe zwykłe przyciski i dodać wyłącznie techniczną akcję „Dalej” z nowym selektorem `kid-technical-next`. Zachować neutralny zapis serwera, blokady busy/offline i anulowanie nagrywania. W razie braku jawnego stanu technicznego rozszerzyć tylko lokalny stan kontrolera i propsy, bez zmiany DTO.
- [ ] Uaktualnić testy E2E używające dawnych selektorów. Scenariusz wiedzy przechodzi przez rzeczywistą odpowiedź albo „Nie pamiętam”; scenariusz techniczny przez `kid-technical-next`. Testów semantyki `skip` i współbieżności nie zamieniać na `dont_remember`: zachować sprawdzenie kontraktu przez jawne wywołanie API w realnym specu lub istniejącym teście integracyjnym. W kartkówce sprawdzić brak ujawnienia i poprawne wznowienie w drugiej przeglądarce.
- [ ] Powtórzyć testy jednostkowe i wskazane cztery specy Playwright; wszystkie mają przejść. Pozostawić testy serwerowego `skip`, historię i DTO.
- [ ] Commit: `feat(kid-ui): remove skip actions and preserve technical continuation`.

## Zadanie 4: Geometria, dokumentacja i pełna weryfikacja

**Pliki:** `tests/e2e/{kid-responsive,kid-ui-layout,kid-feedback-dock,kid-feedback-layout,kid-layout-stability}.spec.ts`, `docs/SPEC.md` sekcje 12.8, 15.1 i kartkówki oraz pozostałe aktualne wzmianki o przycisku znalezione przez `rg`; niniejszy plan.

**Interfejsy:** bez nowego speca E2E, wykorzystać istniejące partycje. Testy geometrii sprawdzają rzeczywiste prostokąty, nie tylko widoczność.

- [ ] Przed zmianą CSS dodać geometrię dla recall, pisowni, luk literowych i formularzy lekcji: szerokości 360, 600, 840 px, desktop 1280 px, telefon 844×390 i symulowana klawiatura przez istniejący helper viewportu. Oba przyciski w jednym rzędzie, „Sprawdź” szersze, wysokości ≥54/48 px, brak poziomego overflow, treść i akcje osiągalne. Sprawdzić również dock po wyniku i powrót do retry.
- [ ] Uruchomić celowane specy, potwierdzić, że nowe asercje wykrywają dotychczasowy układ; po zadaniach 2–3 oczekiwać PASS. Zastąpić dawne oczekiwania geometrii „Pomiń”, zachowując pozostałe asercje.
- [ ] Uaktualnić SPEC: bieżący UI nie oferuje zwykłego pominięcia, etykieta „Nie pamiętam”, neutralna kontynuacja po przeszkodzie technicznej; zachować opis historycznego/kontraktowego wyniku `skip`. Zanotować: API → MCP → skill bez zmian, bo DTO, endpointy i semantyka serwerowa pozostają takie same, zmienia się dostępność akcji klienta.
- [ ] Uruchomić `pnpm test:unit` i `pnpm typecheck`; oczekiwać kodu 0. Nowe błędy naprawić w zakresie zmiany.
- [ ] Uruchomić `pnpm test:e2e:shards`; oczekiwać zielonego pełnego suite na produkcyjnym buildzie. Ten przebieg obejmuje build, więc nie dublować go bez powodu.
- [ ] Przejrzeć diff względem `origin/main`, zgodność projektu i pozostałe referencje `kid-skip`, `kid-feedback-skip`, `kid-lesson-skip`, `kid-transitioning`, `messages.kid.skip`. Rozróżnić martwy UI od potrzebnej obsługi kontraktu/historii. Potwierdzić brak zmian API/bazy, a przy rozszerzeniu zakresu dobrać testy integracyjne.
- [ ] Commit: `test(kid-ui): verify simplified session actions across viewports` (wraz z aktualizacją dokumentacji).
- [ ] Raport: wykonane sprawdzenia, granice zmiany, brak odbioru fizycznego telefonu. Bez push do `main`, merge, wdrożenia i osobnego PR dokumentacyjnego; utworzenie PR uzgodnić z właścicielem.

## Stan przygotowania

Worktree i lokalna gałąź istnieją. Baseline `written-controls.test.tsx`: 6/6 PASS. Kod produktu nie został zmieniony. Plan sprawdzono samodzielnie pod kątem pokrycia zaakceptowanego projektu, interfejsów i scenariuszy awarii; realizacja pozostaje do zlecenia po przeglądzie planu.
