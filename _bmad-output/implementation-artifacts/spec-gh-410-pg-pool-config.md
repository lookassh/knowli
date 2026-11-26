---
title: 'gh-410: jawna konfiguracja puli PostgreSQL i deadline flush recordera kosztów'
type: 'chore'
created: '2026-11-26'
status: 'done'
baseline_revision: '9dc0d5b4376a66b776bf3b9e3da7f6b206a67833'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `createDatabase` tworzy `new Pool({ connectionString })` bez limitów (10 połączeń, brak timeoutu nawiązania i `statement_timeout`), a `flush()` recordera kosztów czeka bez końca — przy zawieszonej bazie zamknięcie workera/web nie dochodzi do `pool.end`.

**Approach:** Parametry puli z env przez `CONFIG_DEFAULTS`/`withConfigDefaults`, parsowane `databasePoolSettingsFromEnv(env, "web" | "worker")` i przekazywane opcjonalnym drugim argumentem `createDatabase`; recorder dostaje deadline `flush()` (domyślnie 5 s) z logiem samego kodu `usage_flush_timeout`.

## Boundaries & Constraints

**Always:** zła wartość liczbowa = błąd startu `<NAZWA> must be a positive integer` (jak `positiveIntEnv`); `statement_timeout` tylko dla puli długo żyjących procesów web i worker; `flush()` nadal nigdy nie rzuca i nie działa w transakcji.

**Never:** limit `statement_timeout` dla `migrateDatabase` i skryptów CLI (`rebuild-progress`, `integration-tokens`, `regenerate-ui-audio`, `report-orphan-media`) — wołają `createDatabase` bez ustawień; zmiana limitów współbieżności workera (#411); ograniczanie rozmiaru `pending` (poza zakresem); nowe zależności.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| domyślne web | `withConfigDefaults({})`, `"web"` | `{ max: 10, connectionTimeoutMillis: 10000, statement_timeout: 30000 }` | — |
| domyślne worker | `withConfigDefaults({})`, `"worker"` | `{ max: 10, connectionTimeoutMillis: 10000, statement_timeout: 120000 }` | — |
| nadpisanie | `UMIEM_WORKER_DB_POOL_MAX=4` | `max: 4` tylko dla workera | — |
| zła wartość | `0`, `-1`, `1.5`, `abc` | błąd startu | `UMIEM_…  must be a positive integer` |
| flush przy zawieszonej bazie | insert nigdy się nie kończy | `flush()` wraca po deadline, log `usage_flush_timeout` | nie rzuca |
| zamknięcie przy niedostępnej bazie | serwer TCP przyjmuje i milczy | `shutdownWorker` kończy się w skończonym czasie | log kodu |

</intent-contract>

## Code Map

- `packages/server/src/db/client.ts:21` -- `createDatabase`; dodać opcjonalne `settings` (podzbiór `PoolConfig`).
- `packages/server/src/config.ts:382` -- `positiveIntEnv` do reużycia; nowy `databasePoolSettingsFromEnv`.
- `packages/server/src/config-defaults.ts` -- nowe klucze `UMIEM_DB_CONNECT_TIMEOUT_MS`, `UMIEM_{WEB,WORKER}_DB_POOL_MAX`, `UMIEM_{WEB,WORKER}_DB_STATEMENT_TIMEOUT_MS`.
- `packages/server/src/index.ts` -- eksport parsera.
- `apps/web/src/composition.ts:57`, `apps/worker/src/composition.ts:42` -- przekazanie ustawień (po walidacji, przed pulą).
- `packages/server/src/providers/usage/drizzle-recorder.ts:133` -- `flush` z deadline.
- `apps/worker/src/shutdown.ts` -- bez zmian; test zamykania z prawdziwą pulą na milczący serwer TCP.
- `.env.example`, `docs/provider-config.md` -- dokumentacja zmiennych.

## Tasks & Acceptance

**Execution:**
- `packages/server/src/config-defaults.test.ts` -- testy parsera (domyślne, nadpisanie, odrzucenie) -- RED.
- `packages/server/src/providers/usage/drizzle-recorder.test.ts` -- test deadline flush -- RED.
- `apps/worker/src/shutdown.test.ts` -- zamknięcie przy niedostępnej bazie -- RED.
- implementacja w plikach z Code Map, dokumentacja.

**Acceptance Criteria:**
- Given worker z prawdziwą pulą na milczący serwer, when `shutdownWorker` po `record`, then kończy się < 5 s i loguje `usage_flush_timeout`.
- Given `pnpm check`, then zielony.

## Review Triage Log

- Przegląd 1 (subagent ze świeżym kontekstem + ponytail-review): high 0 / medium 2 / low 3.
  - medium, patch: `pool.end()` czeka na klienta porzuconego przez flush (zamrożona baza) → deadline 3 s w `shutdownWorker`, log `step: pool.end, code: timeout`, test.
  - medium, patch: `connectionTimeoutMillis` w pg-pool obejmuje też czekanie na wolne miejsce w pełnej puli → domyślnie 10 s, opis w docs i `.env.example`.
  - low, patch: docs obiecywały flush przy zamknięciu web, a web nie obsługuje sygnału → zdanie zawężone do workera.
  - low, patch: asymetria 30 s web / 120 s worker przy blokadach → nota w docs.
  - low, patch: brak dowodu, że `statement_timeout` dociera do serwera → test integracyjny `SHOW statement_timeout`.

## Design Notes

`max` 10 dla obu procesów = dotychczasowa wartość pg (bez zmiany zachowania; suma 20 przy domyślnym `max_connections` 100), osobne zmienne pozwalają stroić procesy niezależnie. Transakcje nie obejmują wywołań providerów (rozdział A/B), więc 30 s na web wystarcza z zapasem także na oczekiwanie na blokadę; worker 120 s, bo uzgodnienia mediów/runów robią większe transakcje.

## Verification

**Commands:**
- `corepack pnpm vitest run packages/server/src/config-defaults.test.ts packages/server/src/providers/usage apps/worker/src/shutdown.test.ts` -- zielone.
- `corepack pnpm check` -- zielony.
