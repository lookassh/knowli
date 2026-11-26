---
title: 'gh-413: requireParent jako sam odczyt, czyszczenie sesji rodzica w workerze'
type: 'refactor'
created: '2026-11-26'
status: 'done'
baseline_revision: '39204eab9fa4d79ae1a1cfb95eb547216b2e3b2e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `requireParent` przy każdym żądaniu rodzica otwiera transakcję z DELETE wygasłych `parent_sessions` + SELECT — zapis/WAL na ścieżce, która powinna być samym odczytem (polling panelu co 1 s).

**Approach:** `requireParent` robi jeden SELECT z warunkiem `expires_at > now`. Wygasłe wiersze usuwa nowy przypadek użycia `cleanupExpiredParentSessions` (obszar `family`, partie ograniczone), wołany przez worker najwyżej raz na godzinę obok `cleanupExpiredActivityReports`; leniwe czyszczenie przy logowaniu zostaje.

## Boundaries & Constraints

**Always:** wygasła sesja → `unauthorized`; ważna → przyjęta; logout i zmiana PIN-u bez zmian; surowy token nigdy w bazie; błąd czyszczenia nie psuje przelotu generacji (osobny try/catch).

**Never:** zmiana kontraktu API/MCP; nowe tabele, indeksy, kolejki; usuwanie sesji ważnych.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ważna sesja | token, expiresAt > now | `requireParent` resolves | — |
| Wygasła sesja | token, now ≥ expiresAt | `unauthorized`, wiersz NIE jest usuwany przez requireParent | — |
| Worker cleanup | 2 wygasłe + 1 ważna, batch 1 | zwraca 2, zostaje 1 ważna | — |
| Błąd cleanupu sesji | rzuca | przelot zwraca wynik generacji, czyszczenie raportów nadal wołane | log błędu |

</intent-contract>

## Code Map

- `packages/server/src/modules/family/auth.ts` -- `requireParent` (transakcja DELETE+SELECT), `loginParent` (leniwy DELETE — zostaje); miejsce na `cleanupExpiredParentSessions`.
- `packages/server/src/modules/family/index.ts` -- barrel obszaru family; dopisać eksport.
- `packages/server/src/index.ts` -- publiczny barrel `@learning/server` (eksport family obok `requireParent`).
- `packages/server/src/testing.ts` -- barrel testów integracyjnych.
- `packages/server/src/modules/learning/session-activity.ts:733` -- wzór `cleanupExpiredActivityReports` (partia 500).
- `apps/worker/src/tasks.ts` -- godzinny blok czyszczenia; `apps/worker/src/tasks.test.ts` -- mocki `@learning/server`.
- `tests/integration/auth-profiles.test.ts:193` -- test „wygasła sesja … leniwie usuwana” zmienia oczekiwanie.
- `docs/architecture.md:371` -- opis leniwego usuwania przy weryfikacji → zaktualizować.

## Tasks & Acceptance

**Execution:**
- [x] (napisane, RED potwierdzony) `tests/integration/auth-profiles.test.ts` -- test: requireParent odrzuca wygasłą bez usuwania; cleanup usuwa tylko wygasłe w partiach -- RED.
- [x] (napisane, RED potwierdzony) `apps/worker/src/tasks.test.ts` -- worker woła `cleanupExpiredParentSessions` raz na godzinę, błąd nie psuje przelotu -- RED.
- [x] `packages/server/src/modules/family/auth.ts` -- SELECT z `gt(expiresAt, now)`; nowy `cleanupExpiredParentSessions` -- GREEN.
- [x] barrele + `apps/worker/src/tasks.ts` -- eksport i wywołanie.
- [x] `docs/architecture.md` -- opis porządkowania.

**Acceptance Criteria:**
- Given wygasła sesja, when worker wykona przelot czyszczenia, then wiersz znika bez żadnego żądania rodzica.
- Given żądanie rodzica, when `requireParent`, then wykonuje się wyłącznie SELECT (brak DELETE/transakcji).

## Verification

**Commands:**
- `corepack pnpm vitest run apps/worker/src/tasks.test.ts` -- pass
- `pnpm test:integration tests/integration/auth-profiles.test.ts` -- pass
- `corepack pnpm vitest run packages/server/src/**/*.architecture.test.ts` -- pass
- `pnpm check` -- pass

## Auto Run Result

Status: done
- Zmiana: `requireParent` to jeden SELECT z `expires_at > now`; `cleanupExpiredParentSessions` (family, partie 500) wołany przez worker raz na godzinę, osobny try/catch; login czyści leniwie z `lte`.
- Pliki: auth.ts, family/index.ts, server index.ts, worker tasks.ts (+test), auth-profiles integracja, architecture.md §13.
- Review: 6 patchy (low), 0 odroczonych, reszta odrzucona z uzasadnieniem powyżej. followup_review_recommended: false (brak high/medium).
- Weryfikacja: RED potwierdzony przed kodem (3 integracyjne + 1 worker); po zmianie: vitest worker+server 3482/3482, architecture 71/71, integracja auth-profiles + parent-secret-change 28/28, `pnpm check` PASS (wcześniejszy przebieg padł raz na sieciowym checku advisory Next.js w buildzie — niezależne od diffu, kolejny przebieg PASS).
- Ryzyka: brak E2E; plan DELETE…IN(SELECT LIMIT) niemierzony na dużej tabeli (jedna rodzina).
