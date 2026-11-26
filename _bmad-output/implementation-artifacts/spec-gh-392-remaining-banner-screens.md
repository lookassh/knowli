---
title: 'gh-392: baner „Jeszcze N” liczy ekrany, nie tylko zadania oceniane'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: '38fb246982dabd2be148fe69ef180c14272d2903'
---

<intent-contract>

## Intent

**Problem:** Baner „Jeszcze N i koniec!” bierze `remainingAssessed` (budżet minus oceniane). Ekspozycja słówka i karta lekcji nie zużywają budżetu, więc po „Jeszcze 1” dziecko może zobaczyć jeszcze ekran nieoceniany i dopiero potem zadanie — wbrew SPEC §17 („nie dokłada potem niezapowiedzianych zadań”).

**Approach:** Sesje treningowe mają stały plan slotów zapisany przy starcie. Serwer liczy z planu `remainingScreens` — ekrany od bieżącego (włącznie) do wyczerpania budżetu, z tą samą regułą stopu i pomijania co wydawanie slotów — i dokłada je do Kid `TaskDto` jako pole opcjonalne. Kid UI pokazuje baner według `remainingScreens ?? remainingAssessed`.

## Boundaries & Constraints

**Always:** liczba na banerze ≥ faktyczna liczba ekranów do końca (nigdy mniej ekranów obiecanych niż pokazanych); historyjka lekcji pozostaje zapowiadanym wyjątkiem („… i historyjka!”), sloty historyjki nie dostają `remainingScreens`; `remainingAssessed` i pasek postępu bez zmian; reguła liczenia w `src/domain` jako czysta funkcja.

**Never:** zmiana planera ani kolejności slotów; zmiana tekstu banera; nowy endpoint; zmiana kartkówek (`mock_test`); dokładanie MCP/skill (Kid DTO nie jest częścią MCP).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ekspozycja przed ostatnim zadaniem | plan …, E, C (budżet: 1 zostało) | na E `remainingScreens=2`, na C `1` | — |
| Nieoceniany slot po wyczerpaniu budżetu | ostatni oceniany, za nim karta | karta nie liczona (nie zostanie wydana) | — |
| Mikrofon wyłączony | przyszły slot mowy pomijany | slot nie liczony jako ekran, ale zużywa budżet | — |
| Sesja bez planu (legacy) / zadanie następcze lekcji / historyjka | brak slotu dla `taskId` | pole pominięte; UI używa `remainingAssessed` | — |

</intent-contract>

## Code Map

- `packages/server/src/domain/training-session-plan.ts` -- typy slotów; nowa czysta `remainingPlanScreens`.
- `packages/server/src/modules/learning/vocabulary-plan-tasks.ts` -- pętla pomijania slotów mikrofonu; wydzielić predykat do ponownego użycia.
- `packages/server/src/modules/learning/sessions.ts:1127,1166` -- DTO słówek z planem (wznowienie i nowe wydanie); `issuedTaskDto` :1212.
- `packages/server/src/modules/learning/lessons/lesson-story-tasks.ts:153` `withStoryCounters` -- wspólne miejsce DTO lekcji z planem (wydanie i wznowienie); `isStorySlot` :129.
- `packages/contracts/src/kid.ts:500` -- `TaskDtoSchema`: dodać `remainingScreens` opcjonalne.
- `packages/kid-ui/src/session/session-controller.ts:2434` `remainingFor` -- źródło banera.
- Testy RED już dopisane (padają przed zmianą, nie zmieniaj ich oczekiwań): `packages/server/src/domain/training-session-plan.test.ts` (opis „remainingPlanScreens”), `packages/kid-ui/src/session/session-controller.test.ts` („remainingFor counts remaining screens”), `tests/integration/sessions.test.ts` (test z „#392”; integracja: `corepack pnpm test:integration tests/integration/sessions.test.ts -t 392`).

## Tasks & Acceptance

**Execution:**
- `packages/contracts/src/kid.ts` -- `remainingScreens: z.number().int().nonnegative().optional()`.
- `packages/server/src/domain/training-session-plan.ts` (+ test) -- `remainingPlanScreens(slots, taskId, remainingAssessed, skipped?)`.
- `vocabulary-plan-tasks.ts`, `sessions.ts` -- dołożyć pole w obu ścieżkach słówek.
- `lesson-story-tasks.ts` -- dołożyć pole dla slotów regularnych planu lekcji (+ test jednostkowy `withStoryCounters` w `lesson-story-tasks.test.ts`: karta przed ostatnim zadaniem liczona, slot historyjki bez pola).
- `session-controller.ts` (+ test) -- baner z `remainingScreens ?? remainingAssessed`.
- `tests/integration/sessions.test.ts` -- przebieg sesji z ekspozycjami przy małym budżecie.

**Acceptance Criteria:**
- Given plan słówek z ekspozycjami między ostatnimi zadaniami, when dziecko przechodzi sesję do końca, then liczba ekranów od pierwszego pokazania banera „Jeszcze N” do końca nie przekracza N.
- Given zadanie bez slotu w planie, when Kid UI liczy baner, then zachowanie jak dotąd (`remainingAssessed`).

## Design Notes

Ponowne zadanie „Skróć odpowiedź” nie jest slotem planu; oferowane jest tylko gdy `remainingWithThisTask > 3`, więc nie pada w oknie banera. Ujawnienie po „Nie pamiętam” jest na tym samym ekranie zadania, a stały plan nie wstawia dodatkowego wsparcia — nie dokłada ekranu.

## Verification

**Commands:**
- `corepack pnpm vitest run packages/server/src/domain/training-session-plan.test.ts packages/kid-ui/src/session/session-controller.test.ts` -- zielone
- `pnpm test:integration tests/integration/sessions.test.ts` -- zielone
- `pnpm check` -- zielone

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 17 findings — high 0, medium 3, low 7, false 5, maybe-false 2
- findings:
  - `[low]` `[reject]` intent: reveal po „Nie pamiętam” nietestowany — ujawnienie to stan tego samego ekranu zadania; stały plan nie wstawia wsparcia, więc nie ma dodatkowego ekranu.
  - `[low]` `[reject]` intent: zadania spoza planu (legacy, „Skróć”, historyjka) z `remainingAssessed` — legacy kończą się starym protokołem; „Skróć” wymaga `remainingWithThisTask > 3`, a budżet sesji = budżet planu; historyjka to zapowiedziany wyjątek.
  - `[false]` `[reject]` intent: kartkówki bez zmian — kartkówki mają wyłącznie sloty oceniane.
  - `[low]` `[reject]` intent: brak testu renderu banera — `SessionProgress` bez zmian, liczba z `remainingFor` pokryta testem kontrolera; pełne E2E uruchomione.
  - `[false]` `[reject]` intent: reguła stopu skopiowana — test integracyjny sprawdza dokładne odliczanie na prawdziwym wydawaniu; predykat pomijania współdzielony.
  - `[medium]` `[patch]` blind: miękki limit czasu liczy oceniane, baner ekrany — `planScreensFrom` w warunku limitu czasu słówek z planem.
  - `[medium]` `[patch]` edge: ta sama przyczyna (dwa wpisy) — jak wyżej.
  - `[low]` `[reject]` blind: predykat czyta bieżący stan mikrofonu — wyłączenie mikrofonu tylko zmniejsza liczbę ekranów (kierunek bezpieczny).
  - `[medium]` `[patch]` blind: `docs/architecture.md` nieaktualne — zaktualizowano „Baner” i API → MCP → skill.
  - `[low]` `[patch]` blind: komentarz `withStoryCounters` — zaktualizowano.
  - `[low]` `[reject]` blind: test domenowy tautologiczny — prawdziwe wydawanie pokrywa test integracyjny.
  - `[false]` `[reject]` blind: różna obsługa zepsutego planu przy wznowieniu — zgodne z istniejącym wzorcem lekcji; nowe wydanie nadal `conflict`.
  - `[low]` `[reject]` blind: test Kid UI w `describe` historyjki, brak przypadku `mock_test` — kosmetyka, `mock_test` niezmienione.
  - `[false]` `[reject]` blind: numery linii w Code Map — artefakt tego przebiegu.
  - `[maybe-false]` `[patch]` verification-gap: ścieżka wznowienia nietestowana — `nextTask` powtórzone i `toEqual(task)` w teście #392.
  - `[maybe-false]` `[patch]` verification-gap: lekcja bez asercji przez `nextTask` — nowy test w `tests/integration/lesson-sessions.test.ts` (kartę w oknie banera pokrywa test jednostkowy).
  - `[false]` `[reject]` verification-gap: plan lekcji krótszy niż budżet — start sesji ustawia `taskBudget = plan.taskBudget`.

## Auto Run Result

- Zmiana: opcjonalne `TaskDto.remainingScreens` liczone z planu sesji (`remainingPlanScreens`), baner Kid UI z `remainingScreens ?? remainingAssessed`, miękki limit czasu słówek respektuje obietnicę w ekranach.
- Pliki: `packages/contracts/src/kid.ts` (pole), `packages/server/src/domain/training-session-plan.ts` (reguła), `vocabulary-plan-tasks.ts` (`skipsPlanSlot`), `sessions.ts` (DTO słówek, limit czasu), `lesson-story-tasks.ts` (DTO lekcji), `session-controller.ts` (baner), `docs/architecture.md`, testy jednostkowe i integracyjne.
- Review: 6 poprawek (limit czasu, dokumentacja, komentarz, test wznowienia, test lekcji), 11 odrzuconych z uzasadnieniem w Review Triage Log, 0 odroczonych. Patched: medium 2 (limit czasu; dokumentacja), low 1, maybe-false 2.
- Rekomendacja kolejnego review: false (żadna poprawka high; poprawka limitu czasu pokryta regułą domenową, bez testu integracyjnego — plan ze slotami mowy wymaga historii dziecka).
- Weryfikacja: vitest zmienionych modułów i `*.architecture.test.ts` zielone; `pnpm test:integration` pełne (przed poprawkami) 1134 ok, po poprawkach `sessions` + `lesson-sessions` 68 ok; `pnpm test:e2e:shards --base-port=25800` zielone (mocked 578, real 128); `pnpm check`: typecheck i unit PASS, build FAIL na `SecurityFatalError` Next.js (blokada wersji Next, niezwiązana ze zmianą).
- Ryzyko: limit czasu przy pominiętych slotach mowy bez testu integracyjnego; brak sprawdzenia na urządzeniu.
