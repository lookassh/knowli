# Dziennik: ustabilizowanie flaków CI (Postgres integracyjne + 2 specy e2e)

Data: 2026-10-11 · Gałąź: `feature/ci-flake-stabilization` (BASE `e048504`) · Skill prowadzący: `systematic-debugging` → TDD per poprawka.

## Diagnoza (dowody)

### Tryb A — `tests`/`e2e` pad w setupie: ECONNRESET na `CREATE SCHEMA`

Runy: 38165633810 (tests, po #47), 38162378766 + 38161481573 (e2e). Wszystkie 3 próby retry failedają w ~3,5 s każda — `pg_isready` zgłasza gotowość niemal natychmiast po `docker run`.

**Przyczyna źródłowa (udowodniona):** gotowość sprawdzana przez `docker exec pg_isready` (unix socket). Entrypoint obrazu postgres w fazie inicjalizacji stawia serwer tymczasowy **tylko na unix sockecie** — `/usr/local/bin/docker-entrypoint.sh:297`: `set -- "$@" -c listen_addresses='' -p 5432` (zweryfikowane w obrazie postgres:17-alpine). W tej fazie port TCP 5432 — jedyna droga migracji przez opublikowany port hosta — nie słucha; na linuksowym runnerze port-proxy acceptuje połączenie, po czym wysyła RST → `read ECONNRESET` (errno -104) na pierwszym zapytaniu. Retry odtwarza kontener i wchodzi w ten sam wyścig.

**Eksperyment lokalny (15 świeżych kontenerów):** `pg_isready` (unix) zielieje **60–75 ms przed** pełnym handshake'em po porcie hosta — okno istnieje na każdej platformie; Docker Desktop na Windows kolejkuje połączenia w oknie (0/15 porażek handshake), natywny Linuks CI — nie. To wyjaśnia, czemu flak jest specyficzny dla CI.

### Tryb B — `tests` czerwone mimo 183/183 zielonych: nieobsłużony 57P01

Run: 38166712755 re-run (job 114552290382). Log: „Vitest caught 1 unhandled error … 20 passed (20), 183 passed (183)" + „Uncaught Exception … terminating connection due to administrator command", klient pg podłączony do bazy `recording_mode_<uuid>`, zserializowany z `err.client` (sygnatura `makeIdleListener` z pg-pool).

**Przyczyna źródłowa (udowodniona ze źródła pg-pool 3.14):** `Pool.end()` → `_pulseQueue()` → `_remove()` usuwa klienta z listy **zsynchronizowanie** i woła asynchroniczne `client.end()` — obietnica końca puli rozwiązuje się, **zanim sockety klientów są zamknięte**. `finally` testu wykonuje natychmiast `DROP DATABASE … WITH (FORCE)`, którego SIGTERM trafia półotwarte backendy → FATAL 57P01 wraca na żywy socket → pg-pool re-emituje na `pool.emit('error')` → brak listenera → uncaughtException → exit 1 mimo zielonych testów. Jedyny źródło SIGTERM na tej bazie w całym kodzie to własny teardown testu.

**Eksperyment lokalny (300 iteracji dokładnej sekwencji):** 0 nieobsłużonych — na Windows FIN zamyka socket szybciej niż biegnie DROP; na Linuksie CI okno jest szersze. Mechanizm potwierdzony deterministycznym testem regresji (patrz niżej): `pg_terminate_backend` na kliencie puli bez guarda = dokładnie ten błąd.

### Tryb C — flaki e2e

- **C1 `kid-flow-screens.spec.ts:91`** (run 38166108864 shard 1): `toBeVisible()` z file-wide timeoutem **1500 ms** po prawdziwej nawigacji `<a href="/parent">`. Snapshot z artefaktu pokazuje stronę w trakcie przejścia; `next dev` kompiluje trasę on-demand — lokalnie pierwsza kompilacja trasy to 1,6–2,4 s (zmierzone), na CI pod obciążeniem więcej. 1,5 s nie miało marginesu.
- **C2 `speech-recording-ux.spec.ts:192`** (run 38166108864 shard 3; także 38162891307): `mouse.down()` po `setViewportSize` + `boundingBox()` — surowe eventy myszy trafiają w punkt, nie w element; layout po resize dosiada się asynchronicznie, pointerdown ląduje poza przyciskiem i `aria-pressed` trwa false przez 20 s (44 poll-e, przycisk idle/ready/nie-disabled — handler nigdy nie dostał zdarzenia).
- **C3 `parent-flow.spec.ts:246` socket hang up** (1 wystąpienie, pre-sharding): hipoteza — keep-alive race `page.request` na połączeniu zamkniętym po stronie serwera. Bez dowodu; **nie naprawione** (zakaz maskowania bez zrozumienia przyczyny) — do obserwacji; jeśli wróci, pobrać trace + logi `next dev`.

## Zmiany (commity)

| Commit | Zakres | Co |
| --- | --- | --- |
| `919f88b` | `packages/server/src/db/ready.ts` (+test, eksport), oba `global-setup.ts` | `waitUntilDatabaseReady`: poll connect+SELECT 1 po URL hosta; setupy czekają na handshake zamiast `pg_isready`. RED→GREEN (4 testy jednostkowe probe-wstrzykiwane). |
| `48c02e7` | `tests/integration/helpers.ts`, `database-teardown.test.ts`, `recording-mode-migration.test.ts` | `waitForDatabaseIdle` (pg_stat_activity przed DROP) + `openQuietDatabase`/guard na współdzielonej puli. RED→GREEN (2 testy integracyjne, w tym deterministyczna reprodukcja 57P01 przez `pg_terminate_backend`). |
| `9c44467` | `tests/e2e/kid-flow-screens.spec.ts`, `speech-recording-ux.spec.ts` | Timeout 10 s na asercjach po nawigacji do `/parent`; `stableBoundingBox` przed surowym gestem myszy. |

## Weryfikacja (lokalnie, Docker 29.7.2)

- `pnpm typecheck` ✅
- `pnpm test:unit` ✅ 492/492 (488 istniejących + 4 nowe)
- `pnpm test:integration` ✅ **21 plików / 185 testów** (183 + 2 nowe), **zero unhandled errors**; w logu widać guard zamieniający 57P01 w ostrzeżenie
- e2e (izolowany świat, 2 przebiegi): `speech-recording-ux` + `kid-flow-screens` ✅ 10/10, drugi przebieg speech ✅ 4/4
- `pnpm build` ✅

Potwierdzenie na CI: zielony run PR (3 shardy e2e + tests). Charakter zmian: A/B usuwają przyczynę (warunek gotowości/kolejność teardownu), C podnosi jakość warunków oczekiwania — flakowatość trzeba obserwować na kolejnych runach.

## Odstępstwa

- C3 nie naprawione (brak dowodu przyczyny; 1 wystąpienie pre-sharding).
- Tryb B nie odtworzył się lokalnie eksperymentalnie (0/300 na Windows) — mechanizm potwierdzono źródłowo + deterministycznym testem regresji z `pg_terminate_backend`.
