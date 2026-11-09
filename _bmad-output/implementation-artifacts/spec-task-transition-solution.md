---
title: 'Szybsze przejścia między zadaniami'
type: 'bugfix'
created: '2026-10-17'
status: 'draft'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

**Zastąpiona propozycja:** Właściciel wybrał dostosowanie dopiero kolejnej sesji. Bieżący plan: `spec-fixed-training-session-plan.md`. Poniższy wariant batchowania zachowano jako materiał historyczny; nie jest planem do implementacji.

**Problem:** Przejście prezentacji wymaga czterech zależnych HTTP, odpowiedź trzech; nowe zadanie słówkowe około 30–31 sekwencyjnych SQL. Stara karta pozostaje bez czytelnego stanu oczekiwania. Właściciel zlecił przygotowanie rozwiązania przez BMAD.

**Approach:** Jeden cel: skrócić i jasno pokazać przejście. Dwa kroki implementacji: najpierw pomiary, UI i SQL; następnie połączenie końcowych sygnałów aktywności z komendą. Zwykła ścieżka prezentacji: 4→2 HTTP, odpowiedzi: 3→1, Dalej po feedbacku: nadal 1.

## Boundaries & Constraints

**Always:** Commit ekspozycji przed ujawnieniem; wspólna blokada sesji; serwerowy czas; identyczne zasady ocen/nagród; obsługa słówek, lekcji, kartkówki i mowy; zgodność starszego klienta.

**Never:** Przedwczesne wydawanie zadania przez prefetch; lokalna ocena; cache historii między żądaniami; obcięcie historii; zwykłe usunięcie await. Łączenie complete+next pozostaje poza tą propozycją: błąd planowania nie powinien cofać ukończenia prezentacji.

## I/O & Edge-Case Matrix

| Stan | Zachowanie docelowe | Retry/awaria |
| --- | --- | --- |
| Kliknięcie odpowiedzi | Natychmiast neutralne zaznaczenie wyboru i stan wysyłania | Kolor poprawności dopiero po wyniku |
| Dalej | Stabilna karta, przycisk z małym wskaźnikiem oczekiwania | Bez zmiany wysokości i podwójnej wysyłki |
| Brak sygnału w locie | Dwa końcowe sygnały w komendzie | Ten sam ID i payload przy retry |
| Sygnał w locie | Domknięcie istniejącej kolejki przed przypisaniem sekwencji batcha | Odtworzenie identycznego pending; pozostaje dotychczasowy timeout |
| Przejęcie na innym urządzeniu | Brak reaktywacji starego streamu | Konflikt aktywności nie daje punktów; odpowiedź według stanu zadania |
| Processing mowy/modelu | Pauza przed analizą, istniejący polling | Czas usługi nie daje nagród |

</frozen-after-approval>

## Code Map

Szczegółowa diagnoza: `spec-task-transition-latency.md`. Poniżej pliki i działania do realizacji.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/src/kid/kid-router.ts`, `packages/server/src/modules/sessions.ts` — pomiary SQL, blokady i planowania, bez danych dzieci.
- [ ] `packages/kid-ui/src/session/session-controller.ts`, `screens/LearnScreen.tsx`, `styles.css` — przed await neutralny wybór i stan wysyłania/przejścia, role=status/aria-busy; stałe wymiary.
- [ ] `packages/server/src/modules/sessions.ts`, `learning-snapshot.ts` — scalić 3 odczyty mediów do 1, 3 maksima aktywności do 1; współdzielić rewizje/projekcje w transakcji, zachować zakres wersji i fallback. Nie równoleglić SQL na jednym połączeniu.
- [ ] `packages/contracts/src/kid.ts`, `reward-activity.ts`, `apps/web/src/kid/kid-router.ts` — opcjonalny activityFinalization w JSON/multipart: stream, potwierdzona sekwencja, dwa nowe sygnały interaction/pause. Czas wyłącznie serwerowy.
- [ ] `packages/server/src/modules/reward-activity.ts`, `attempts.ts`, `lessons/lesson-attempts.ts`, `sessions.ts` — helper Tx pod wspólną blokadą, przed oceną; jeden czas przed analizą. Konflikt streamu nie daje nagrody. Deduplikacja komendy przed batchem: requestHash próby obejmuje finalizację; prezentacja zapisuje ID/hash w context zdarzenia przed sealed. Inny payload z tym samym ID daje conflict.
- [ ] `packages/kid-ui/src/session/session-controller.ts`, `api/client.ts` — zatrzymać heartbeat, zamrozić kolejkę, rozstrzygnąć pending/in-flight, następnie utworzyć batch z potwierdzonej sekwencji. Retry zachowuje ID/payload. Uwzględnić sygnały końca playback.
- [ ] `docs/architecture.md`, `docs/SPEC.md` — kontrakt i kolejność wdrożenia: serwer przed UI, stare komendy działają. API → MCP → skill: Kid commands nie są wystawiane przez learning-overview; przy niezmienionym czasie zachować jego schemat/skill, uzasadnić i sprawdzić raport.

**Acceptance Criteria:**
- Given aktywne zadanie, when kliknięto, then widoczny stan oczekiwania pojawia się do 100 ms na urządzeniu referencyjnym.
- Given brak sygnałów w locie, when prezentacja/odpowiedź kończy się poprawnie, then ślad HTTP ma odpowiednio 2/1 żądania przed nowym zadaniem/feedbackiem, poza późniejszymi sygnałami nowego zadania i mediami.
- Given identyczne fixture i sztuczne 250 ms na żądanie, when porównano stare i nowe ścieżki, then znikają dwa oczekiwania HTTP; czasy SQL mierzone osobno.
- Given ten sam seed, zegar i historia, when zoptymalizowano SQL, then plan, oceny, ekspozycje i nagrody są zgodne z bazą porównania, przy co najmniej czterech odczytach mniej na objętej ścieżce.
- Given utrata odpowiedzi, dwuklik lub drugie urządzenie, when ponowiono komendę, then nie powstaje dodatkowa próba, rozliczenie ani reaktywacja streamu.

## Implementation Notes

Propozycja; bez implementacji. Branch investigate/task-transition-latency, baza 66a07173350ba59b504d6d74f934473154f2b063. Zmiany kodu są odwracalne, brak planowanej migracji. In-flight activity nadal może opóźnić wyjątkową ścieżkę; nie obiecujemy usunięcia każdego timeoutu.

## Verification

Przy implementacji: fake clock/opóźnienia w session-controller/client; PostgreSQL w sessions, reward-activity, reward-activity-client, lesson-sessions; e2e kid-flow/lesson-kid; typecheck/build; niezależne review. Scenariusze: retry, pending, takeover, hidden/offline, mowa, koniec sesji. Porównać p50/p95 tej samej instancji i urządzenia. Dotychczasowe 96/96 testów nie weryfikuje tej propozycji.
