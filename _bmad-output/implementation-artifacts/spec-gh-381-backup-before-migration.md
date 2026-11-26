---
title: 'gh-381: backup przed migracją, harmonogram, kopia poza host, rotacja'
type: 'chore'
created: '2026-11-26'
status: 'done'
baseline_revision: '39204eab9fa4d79ae1a1cfb95eb547216b2e3b2e'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      Brak testu automatycznego dla wyboru nagrań w smoke.mjs inspect (sortowanie przed slice).
    evidence: |-
      Narzędzie ręczne wymagające działającego stacku; brak uprzęży testów dla deploy/*.mjs. Sprawdzone ręczną próbą odtworzenia 2026-11-26.
    location: >-
      deploy/smoke.mjs:318
    severity: low
---

<intent-contract>

## Intent

**Problem:** Aktualizacja (`git pull` + `up -d --build`) odpala migracje na jedynej bazie rodziny bez bramki backupu, a harmonogram, kopia poza host i rotacja są tylko sugestią; nie ma runbooka nieudanej migracji.

**Approach:** Twarda reguła i runbook w `docs/deploy.md`; w `docs/backup-restore.md` cron (backup → rotacja → kopia poza host), datowany test odtworzenia. Jedyny nowy kod: `deploy/backup-rotate.sh` (rotacja liczbowa, tylko kompletne kopie), z testem vitest pisanym najpierw (RED).

## Boundaries & Constraints

**Always:** rotacja nigdy nie usuwa najnowszych N kompletnych kopii (katalog `knowli-*` z `SHA256SUMS`); odrzuca N < 1 i brak katalogu; kopie powstają z prawami tylko dla właściciela (dane dzieci). Test odtworzenia tylko na lokalnych kontenerach testowych.

**Never:** żadnej zmiany produkcji ani połączenia z VM; bez zmian API/MCP/skill; bez nowego schedulera w aplikacji.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| rotacja | 5 kompletnych, keep=3 | zostają 3 najnowsze | — |
| za mało kopii | 2 kompletne, keep=3 | nic nie usunięte | — |
| niekompletna nowsza | najnowszy katalog bez SHA256SUMS | nie liczy się do N, nie jest usuwany | — |
| niekompletna stara | stary katalog bez sum, starszy niż N-ta kompletna | usunięty | — |
| obce pliki | `backup.log`, inny katalog | nietknięte | — |
| zły argument | keep=0 / brak / nie-liczba / brak katalogu | nic nie usunięte | exit ≠ 0, komunikat |

</intent-contract>

## Code Map

- `deploy/backup.sh` -- tworzy `backups/knowli-YYYYmmdd-HHMMSS/{db.dump,media.tgz,SHA256SUMS,manifest.json}`; `SHA256SUMS` powstaje po obu plikach (znacznik kompletności); dodać `umask 077`.
- `deploy/restore.sh` -- odtworzenie do `knowli-restore` (port) lub `knowli --yes`; bez zmian.
- `deploy/compose.yaml` -- `migrate` przed web/worker (`service_completed_successfully`).
- `packages/server/src/db/client.ts:31` `migrateDatabase` -- drizzle `migrate` wykonuje wszystkie oczekujące migracje w jednej transakcji (drizzle-orm `pg-core/dialect.js` `migrate`), potem `ensureLearningPolicy` osobno.
- `tests/worktree-scripts.test.ts` -- wzorzec testu skryptu na katalogu tymczasowym (`execFileSync`).
- `vitest.unit.config.ts` -- `tests/*.test.ts` w zakresie unit.

## Tasks & Acceptance

**Execution:**
- `tests/deploy-backup-rotate.test.ts` -- test macierzy I/O przez `bash deploy/backup-rotate.sh` -- ściśle RED-GREEN: najpierw test, uruchom go i zapisz w raporcie, że pada (brak skryptu), dopiero potem skrypt.
- `deploy/backup-rotate.sh` -- rotacja wg macierzy -- GREEN.
- `deploy/backup.sh` -- `umask 077` -- kopie z danymi dzieci tylko dla właściciela.
- `docs/deploy.md` -- reguła „backup przed `up --build`” (compose i Coolify) + runbook nieudanej migracji.
- `docs/backup-restore.md` -- cron, rotacja, kopia poza host (pull). Sekcję z wynikiem datowanej próby odtworzenia (2026-11-26) dopisuje sesja nadrzędna po własnej próbie na kontenerach testowych — implementer jej nie pisze i nie uruchamia Dockera. Nie usuwaj pliku `.env` w korzeniu (należy do trwającej próby).

**Acceptance Criteria:**
- Given procedura aktualizacji w `docs/deploy.md`, when właściciel ją czyta, then pierwszy krok to `deploy/backup.sh`, a sekcja runbooka opisuje: migrate padł (rollback transakcji, powrót kodu), migracja przeszła a wersja zła (restore z kopii sprzed deployu).
- Given `docs/backup-restore.md`, when właściciel konfiguruje host, then ma gotową linię cron z backupem, rotacją i kopią poza host oraz wpis z datą 2026-11-26 próby odtworzenia.

## Verification

**Commands:**
- `corepack pnpm vitest run tests/deploy-backup-rotate.test.ts tests/docs-architecture-drift.test.ts` -- expected: pass
- `pnpm check` -- expected: pass

## Auto Run Result

Status: done

- Zmiana: twarda reguła backupu przed aktualizacją i runbook nieudanej migracji (`docs/deploy.md`); kompletność kopii, rotacja, cron, kopia poza host (pull), datowany test odtworzenia 2026-11-26 (`docs/backup-restore.md`); `deploy/backup-rotate.sh` + test; `deploy/backup.sh` umask 077 i atomowe SHA256SUMS jako ostatni krok; `deploy/smoke.mjs inspect` sortuje przed wyborem nagrań.
- RED-GREEN: test rotacji przed skryptem padł 5/11 (exit 127), po skrypcie 11/11; po review 12/12.
- Weryfikacja: vitest rotacji + drift dokumentacji 18/18; próba backup→restore na kontenerach testowych PASS (drugie podejście, po poprawce inspect).
- Follow-up review: false (brak poprawek high; poprawki medium dotyczą dokumentacji i są proste).
- Ryzyka: nie sprawdzono na stacku Coolify, runbooka B na projekcie knowli ani linii cron/rsync na prawdziwych hostach.
