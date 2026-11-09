---
title: 'Karta pracy dziecka w panelu rodzica'
type: 'feature'
created: '2026-10-16'
status: 'done'
route: 'dispatch'
baseline_commit: 'f436a540ebdaaa05da304a18943c28e20c1d1bf8'
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/daily-round.md'
  - '{project-root}/_bmad-output/specs/spec-nagrody-za-nauke/acceptance-scenarios.md'
  - '{project-root}/docs/architecture.md'
---

<frozen-after-approval reason="approved scope — do not modify unless human renegotiates">

## Intent

**Problem:** Rodzic potrzebuje sprawdzić pracę dziecka przed własną decyzją o nagrodzie. Obecny raport czasu nie pokazuje zestawów, odpowiedzi ani rundy.

**Approach:** Dodaj chronioną kartę dla dziecka i lokalnej daty, opartą na rozliczonym czasie, sesjach, krokach i odpowiedziach. Pokaż przykłady, braki i status rundy jako fakty, bez oceny uczciwości ani cofania punktów.

## Boundaries & Constraints

**Always:** Serwer wymaga Parent Mode i zwraca tylko dane wskazanego dziecka. Filtruj lokalny dzień według utrwalonej strefy; nie przeliczaj historii po jej zmianie. Czas pochodzi z rozliczonych odcinków. Zachowaj przypięte nazwy zestawów, stany sesji/kroków, skip, „Nie pamiętam”, brak oceny i krótkie przykłady. Szybkość pokazuj wyłącznie jako fakt. Brak wpisu nie dowodzi braku nauki; brak rekordu rundy pokazuj neutralnie „Nie uruchomiono / brak zapisu”, bez wnioskowania o niedostępności; runda nie tworzy danych o mastery.

**Never:** Nie pokazuj audio, surowych klawiszy/ruchów, tokenów sesji ani danych innego dziecka. Nie etykietuj oszustwa, nie licz score uczciwości i nie odbieraj punktów. Bez wymiany Xbox, automatyzacji Microsoft i zmian raportu MCP.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dzień z pracą | Parent, dziecko i lokalna data | Czas rozliczony, sesje, zestawy, kroki i przykłady | `401` bez Parent Mode; `404` dla nieistniejącego dziecka |
| Pusty dzień/runda | Poprawny odczyt bez sesji lub bez wiersza rundy | Neutralny pusty stan; brak wniosku o nauce lub niedostępności | Nie twórz fikcyjnego statusu ani danych |

</frozen-after-approval>

## Code Map

- `apps/web/src/parent/parent-router.ts` — `requireParentSession` chroni każde żądanie; istniejący `/reward-activity/:childId` zwraca tylko czas/sesje/pauzy. Dodaj osobny GET z `no-store`.
- `apps/web/src/parent/ParentApp.tsx`, `ProgressPanel.tsx` — dodanie karty oraz wzorzec filtrów, auto-load, ochrona przed starym wynikiem i obsługa 401.
- `MockTestReportPanel.tsx`, `mock-report-words.ts` — przykłady odpowiedzi; nie przenoś ocen kartkówki na rundę.
- `packages/server/src/modules/reward-activity.ts` — rozliczone segmenty/settlements są źródłem czasu i strefy.
- `packages/server/src/db/schema.ts` — sesje, `sessionTasks`, `attempts`, settlementy i przypięte wersje; odpowiedzi/feedback służą do przykładów, assessment nie zawsze istnieje.
- `packages/server/src/modules/daily-round.ts`, `sessions.ts` — `dailyRoundDate` i tryb rundy; brak trwałego rekordu niedostępności (Open Question).
- `packages/contracts/src/reward-activity.ts` — nie zmieniaj obecnego DTO czasu; dodaj osobny strict Parent DTO. Wzorce testów: `tests/integration/reward-activity.test.ts`, `lesson-parent-api.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/parent-work-card.ts`, `index.ts` — strict DTO z walidacją.
- [x] `packages/server/src/modules/parent-work-card.ts` — raport dla jednego dziecka/dnia; tylko rozliczony czas i zapisane fakty.
- [x] `apps/web/src/parent/parent-router.ts` — chroniony `GET`, walidacja UUID/daty, `no-store`.
- [x] `ParentApp.tsx`, nowy `WorkCardPanel.tsx`, `parent.css`, `packages/contracts/src/messages.ts` — filtr dziecka/dnia oraz dostępne stany ładowania/błędu/pusto.
- [x] `tests/integration/parent-work-card.test.ts`, test UI i `tests/e2e/parent-work-card.spec.ts` — tryby nauki i rundy, przykłady/braki, daty, izolacja dzieci i Parent auth.

**Acceptance Criteria:**
- Given rodzic wybiera dziecko i dzień, when otwiera kartę, then widzi rozliczony czas oraz sesje/zestawy według nazw przypiętych wersji.
- Given są odpowiedzi, pominięcia, „Nie pamiętam”, brak oceny lub niewydane kroki, when rodzic przegląda dzień, then widzi oddzielone fakty i krótkie przykłady bez etykiety oszustwa.
- Given runda jest aktywna, ukończona lub przerwana, when rodzic ją przegląda, then widzi zapisany stan/kroki bez wnioskowania o mastery.
- Given brak Parent Mode, nieprawidłowe dziecko/data lub pusty dzień, when API/UI obsługuje odczyt, then dane są odrzucone albo pokazany jest neutralny pusty stan bez wycieku danych.
- Given raport jest odczytany, when sprawdzane są punkty i learning-overview, then ich dane/znaczenie pozostają bez zmian.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Reviewer finding | Disposition | Evidence / action |
|---|---|---|
| Edge case: clearing the selected date during a pending request could leave loading visible. | Fixed | Empty child/date now invalidates the pending request and clears report, error, and loading state; unit/typecheck pass. |
| Verification gap: no authenticated route success-path assertion. | Fixed | Integration test now logs in Parent Mode and asserts HTTP 200, report body, and `Cache-Control: no-store`; integration suite passes. |
| Round answered count included completed exposure and skipped steps. | Fixed | Count is now limited to `state === "answered"`; route/domain suite passes. |
| An attempt assessed for one skill but unassessed for another was summarized as wholly unassessed. | Fixed | DTO now includes `mixed`; parent UI renders a factual mixed-status label. |
| Lesson exercise types fell back to generic label. | Fixed | Added Polish labels for choice, short answer, transform, and notice lesson exercises. |
| Sessions with no settled time, attempts, or round record could be absent. | Fixed | Sessions whose stored timezone local start date matches the requested day are included, including zero-step sessions. |
| Attempts are loaded for the child then filtered by date in memory; this may become expensive with long history. | Accepted risk | Correctness is date-filtered using each session's stored timezone and this family-scale read path; optimize with bounded SQL/date partitions if profile history becomes large. |
| Review questioned whether the card should expose a direct correctness label. | Not changed | Scope requires recorded answers and facts and avoids mastery inference; existing feedback, answer examples, and assessment presence are surfaced without inventing an additional judgment field. |
| Blind hunter: report exposes assessment presence but not correctness. | false | The approved card reports work facts rather than a correctness score; stored feedback is separately mapped to parent-readable labels, and mock-test results remain in the existing mock-test report. |
| Blind hunter: steps lack their full prompt/context. | false | The accepted scope calls for pinned deck names, step types, and short answer examples; it does not require reproducing prompts or answer keys in this report. |
| Blind hunter: an empty active round hides its deck and step counts. | false | The service returns the pinned deck title and zero-valued step/answer counts for an existing round, and the panel renders them. |
| Blind hunter: the no-round text conflates an unstarted round with unavailable data. | false | This is the owner's explicit decision: show “Nie uruchomiono / brak zapisu” without inferring the reason. |
| Blind hunter: responseSeconds includes pauses. | false | It is elapsed server time from task issue to answer receipt, and the UI says “Odpowiedź po … s”; it does not label this as active-study time. |
| Blind hunter: session timestamps are not displayed. | low / rejected | Sessions are returned in start-time order with mode and state; displaying exact timestamps is a cosmetic extension outside the acceptance criteria. |
| Blind hunter: the panel test did not exercise report loading or filter changes. | patch / fixed | Added Playwright interaction coverage for the selected child's report, child/date changes, neutral empty-day/no-round, loading, and API error states. Targeted E2E passes. |
| Blind hunter: the module reads all child attempts before filtering to a date. | defer / carried | The same performance risk is already recorded above as accepted for family-scale history; retain the existing deferral and optimize with bounded date partitions if history grows. |
| Edge hunter: overlapping intervals inflate a session total. | false | Application writes one active stream per child, serializes signals and settlements under row/session locks, and closes the current interval before a replacement stream starts; overlapping intervals are not reachable through this flow. |
| Edge hunter: overlapping intervals inflate the daily total across sessions. | false | A child has one active session and one active reward stream; session end closes the stream before another session can start, so the reported overlap is unreachable through application operations. |
| Verification-gap reviewer: no interaction test proves selected filters fetch and display the matching report. | patch / fixed | `tests/e2e/parent-work-card.spec.ts` stubs the parent API, checks the initial report, changes child and date, and asserts the new query and rendered result; targeted Playwright test passes. |
| Implementation audit: no integration assertion covered a nonexistent child (404). | patch / fixed | Added a missing-profile assertion to the parent work-card integration test; focused integration passes. |

## Design Notes

Sumy dzienne należy liczyć według strefy snapshotu rozliczenia, nie bieżącej konfiguracji rodziny. Zaokrąglona prezentacja minut nie zmienia sekund źródłowych. Dla rundy feedback jest zapisywany do obsługi bieżącego zadania, ale historia opanowania nie zawiera ocen z rundy; UI powinno raportować wykonanie i odpowiedź, nie wynik mastery.

## Verification

**Commands:**
- `corepack pnpm vitest run --config vitest.integration.config.ts tests/integration/parent-work-card.test.ts` — expected: report data, local-day boundaries and Parent authorization pass.
- `corepack pnpm vitest run --config vitest.unit.config.ts packages/contracts/src/parent-work-card.test.ts apps/web/src/parent/work-card.test.tsx` — expected: strict DTO and empty/loading/error/filter behavior pass.
- `corepack pnpm exec playwright test tests/e2e/parent-work-card.spec.ts` — expected: filter changes, matching report, empty/no-round, loading, and error states pass.
- `corepack pnpm typecheck` — expected: all TypeScript projects pass.
- `git diff --check` — expected: no whitespace errors.

**Results:** Testy integracyjne 2/2, testy jednostkowe 3/3, `corepack pnpm typecheck` i `git diff --check` przeszły także po poprawkach review. Nowy endpoint jest wyłącznie chronionym API rodzica; nie zmienia `learning-overview`, JSON Schema MCP ani skilla Hermesa.
