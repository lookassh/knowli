---
title: 'Diagnoza opóźnienia przejść między zadaniami'
type: 'bugfix'
created: '2026-10-17'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Problem:** Właściciel zgłasza 1–2 sekundy oczekiwania po kliknięciu między ekranami zadań. Zakres bieżącego polecenia obejmuje diagnozę przez BMAD i utworzenie lokalnego brancha.

**Approach:** Prześledzić zależności od kliknięcia do renderowania kolejnego zadania, wskazać potwierdzone mechanizmy oczekiwania oraz odróżnić je od niezmierzonych kosztów wdrożonej instancji. Poniższa propozycja naprawy pozostaje szkicem do osobnego zatwierdzenia.

## Boundaries & Constraints

**Always:** Zachować zapis ekspozycji przed ujawnieniem treści, blokadę sesji, idempotencję prób, kolejność sygnałów aktywności i prawidłowe wykluczanie czasu oczekiwania z nagród. Używać fikcyjnych danych przy odtwarzaniu.

**Never:** Prefetch wydający nowe zadanie i zapisujący ekspozycję przed rzeczywistym przejściem; lokalne przewidywanie oceny; mechaniczne usunięcie await sygnałów bez rozwiązania ich kolejności i rozliczenia czasu.

## I/O & Edge-Case Matrix

| Sytuacja | Obecna ścieżka | Wymaganie dla przyszłej naprawy | Awaria |
| --- | --- | --- | --- |
| Dalej na prezentacji | interaction → pause → complete-presentation → next | Zmniejszyć liczbę oczekiwań HTTP, zachować terminalne zamknięcie prezentacji | Ponowienie nie tworzy drugiego zamknięcia |
| Odpowiedź wyboru/tekstu | interaction → pause → attempts → feedback | Szybka lokalna informacja o przyjęciu kliknięcia, wynik z serwera | Brak fałszywej oceny |
| Dalej po feedbacku | next → render | Zmierzyć i skrócić planowanie nowego zadania | Zachować kartę i możliwość ponowienia |
| Sygnał aktywności w toku | Wspólna kolejka promise | Zachować sekwencje i odtwarzanie utraconego żądania | Bez zawyżenia czasu nauki |

</frozen-after-approval>

## Code Map

- `packages/kid-ui/src/session/session-controller.ts:668` — completePresentation: dwa oczekiwane sygnały aktywności, potem zamknięcie i next, łącznie cztery żądania po kliknięciu.
- `packages/kid-ui/src/session/session-controller.ts:756` — submitAnswer: dwa sygnały przed wysłaniem odpowiedzi. pendingChoice jest przypisywane dopiero po sygnałach; widoczne oznaczenie wyniku dopiero po odpowiedzi serwera.
- `packages/kid-ui/src/session/session-controller.ts:647` — continueLearning po feedbacku oczekuje tylko na next; nie przypisywać mu dwóch sygnałów z innych ścieżek.
- `packages/kid-ui/src/session/session-controller.ts:1372` — kolejka sygnałów: zależność od wcześniejszych heartbeat/takeover/playback i powtórzenie pending przed kolejnym sygnałem.
- `packages/kid-ui/src/api/client.ts:95` — timeout pojedynczego activity wynosi 2000 ms; nie jest stałą pauzą każdego przejścia.
- `packages/kid-ui/src/screens/LearnScreen.tsx:225` — stara treść pozostaje podczas busy; wskaźnik loading-step występuje wyłącznie przy task=null.
- `packages/server/src/modules/sessions.ts:915` — nextTask pod blokadą sesji. Analiza zwykłej ścieżki nowego zadania słówkowego daje około 30–31 sekwencyjnych SQL bez BEGIN/COMMIT; istniejący issued około 6. Liczba zależy od gałęzi.
- `packages/server/src/modules/sessions.ts:1116` — completePresentation; wraz z rozliczeniem nagród co najmniej około 19 SQL na analizowanej ścieżce bez aktywnych streamów; ze streamem więcej.
- `packages/server/src/modules/learning-snapshot.ts:43` oraz `skill-history.ts:22` — rekonstrukcja historii i powtórzone odczyty części danych planera. Możliwy wzrost kosztu wraz z historią wymaga pomiaru.
- `packages/server/src/modules/reward-activity.ts:109` — sygnały mają transakcję, blokadę sesji i advisory lock profilu; nie są wyłącznie lekkim logowaniem.
- `docs/architecture.md` — sekcje ekspozycji, protokołu zadań i historii; zachować barierę commit przed ujawnieniem.

## Tasks & Acceptance

**Execution — propozycja kolejnego etapu:**
- [ ] `packages/kid-ui/src/session/session-controller.test.ts` — kontrolowany pomiar sekwencji z opóźnionym transportem; osobno prezentacja, odpowiedź i Dalej po feedbacku.
- [ ] `apps/web/src/kid/kid-router.ts`, `packages/server/src/modules/sessions.ts` — pomiary czasu endpointu, planowania i oczekiwania na blokady bez logowania treści odpowiedzi lub danych dzieci.
- [ ] `packages/server/src/modules/sessions.ts`, `learning-snapshot.ts` — na podstawie pomiarów ograniczyć powtarzane odczyty, zachowując aktualność w transakcji.
- [ ] `packages/kid-ui/src/session/session-controller.ts`, `packages/server/src/modules/reward-activity.ts` — zaprojektować ograniczenie oddzielnych żądań aktywności przed odpowiedzią/zamknięciem, np. przez obsługę potrzebnych operacji w transakcji komendy. Przed zmianą kontraktu sprawdzić API → MCP → skill.
- [ ] `packages/kid-ui/src/screens/LearnScreen.tsx` — jednoznaczny stan oczekiwania natychmiast po kliknięciu z zachowaniem stabilnego układu i blokady wielokrotnej wysyłki.

**Acceptance Criteria:**
- Given aktywna prezentacja, when dziecko klika Dalej, then UI od razu potwierdza obsługę kliknięcia, a kolejny prompt pojawia się po wymaganym zapisie serwera.
- Given wolny lub zawodny transport sygnałów aktywności, when dziecko odpowiada, then awaria nie zawyża czasu nagród i nie duplikuje próby.
- Given identyczny materiał i historia, when porównujemy pomiary przed i po zmianie, then raport podaje czas do reakcji UI i czas do nowego zadania osobno, dla każdej ścieżki.

## Implementation Notes

Diagnoza na `66a07173350ba59b504d6d74f934473154f2b063`, branch `investigate/task-transition-latency`. Nie zmieniano kodu aplikacji. BMAD: krok badania bmad-build, w tym niezależna analiza serwera.

Potwierdzone: serializacja HTTP i SQL oraz brak osobnego widocznego stanu ładowania dla już wyświetlanej karty. Przy hipotetycznym czasie 250–500 ms na żądanie cztery zależne żądania dają 1–2 s; to przykład rachunkowy, nie pomiar wdrożenia. Brak nagrania Network/Performance i czasów SQL z instancji użytkownika, więc nie przypisujemy całego opóźnienia jednemu endpointowi.

## Verification

- `corepack pnpm test:unit packages/kid-ui/src/session/session-controller.test.ts packages/kid-ui/src/api/client.test.ts` — 96/96, 2 pliki, zakończone sukcesem 2026-10-17.
- Istniejące testy `locks ... before waiting for activity telemetry` potwierdzają busy przed oczekiwaniem; `sends the answer after reward transport timeouts...` potwierdza kontynuację po timeoutach; testy kolejki chronią sekwencje i ponawianie identycznego payloadu.
- Przejrzano ścieżki UI, API, SQL i CSS; brak timera wprowadzającego stałe 1–2 s przy zwykłym przejściu. Polling dotyczy processing i jest osobną ścieżką.
- Nie przeprowadzono pomiaru działającej instancji ani akceptacji na urządzeniu dziecka. Testy jednostkowe nie mierzą jej wydajności.
