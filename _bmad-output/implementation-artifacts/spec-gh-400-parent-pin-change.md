---
title: 'gh-400: zmiana PIN-u rodzica z unieważnieniem wszystkich sesji'
type: 'feature'
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

**Problem:** Po setupie nie ma w aplikacji drogi zmiany PIN-u/hasła rodzica; `logoutParent` kasuje tylko bieżący token, a `docs/deploy.md` myląco twierdzi, że zmiana PIN-u wymaga zalogowania (jakby istniała).

**Approach:** Przypadek użycia `changeParentSecret` w module `family` (weryfikacja obecnego sekretu z limiterem prób, nowy hash scrypt, w jednej transakcji CAS na `parent_credentials` + usunięcie wszystkich `parent_sessions`), procedura oRPC `auth.changeSecret` (POST `/api/v1/parent/secret`, czyści cookie sesji, 204) i okno „Zmień PIN” w ramie panelu; po sukcesie rodzic widzi ekran logowania.

## Boundaries & Constraints

**Always:** serwerowa weryfikacja sesji i obecnego sekretu; reguły długości `assertSecretShape` (4–200); limit 5 nieudanych prób / 15 min (kubełek per sesja, nie wspólny kubełek logowania); Origin/CSRF (`sameOriginMiddleware`); usunięcie wszystkich sesji w tej samej transakcji co zapis hasha; ciastko urządzenia traci ważność przez nowy hash (HMAC kluczem hasha); teksty UI w `messages.ts`.

**Never:** zmiana `requireParent` (#413); reset PIN-u bez obecnego; nowa tabela/migracja; zmiany MCP.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | ważna sesja, poprawny obecny, nowy 4–200 | 204 + czyszczące cookie; wszystkie sesje 401; login starym → invalid_credentials, nowym → OK; stare ciastko urządzenia nieznane | — |
| WRONG_CURRENT | zły obecny | 401 `invalid_credentials`, nic nie zmienione, sesje żyją | po 5 porażkach `rate_limited` (429) |
| NO_SESSION | brak/nieważne cookie | 401 `unauthorized` | — |
| BAD_NEW | nowy < 4 znaki | 400 `validation`, nic nie zmienione | — |
| RACE | sesja/hash zmienione równolegle | transakcja wycofana | `unauthorized` / `conflict` |

</intent-contract>

## Code Map

- `packages/server/src/modules/family/auth.ts` -- `hashSecret`, `verifySecret`, `assertSecretShape`, `limiterFor`, `hashToken`, `signDevice/knownDeviceId` (HMAC kluczem hasha); nowa funkcja obok `logoutParent`; NIE ruszać `requireParent`.
- `packages/server/src/modules/family/index.ts`, `packages/server/src/index.ts` -- eksport.
- `apps/web/src/parent/orpc-contract.ts` (~235, ~589) -- grupa `auth`, wzorzec `logout` (detailed 204 + set-cookie).
- `apps/web/src/orpc/parent-router.ts` (~553) -- `parentAuthOs`, `requireParentSession`, `clearingSessionCookie`.
- `apps/web/src/parent/ParentShell.tsx`, `ParentApp.tsx` -- menu ⋯ (telefon) / nagłówek (≥600 px); `signOutLocally`.
- `packages/contracts/src/messages.ts` -- `auth.*`.
- `tests/integration/auth-profiles.test.ts` -- wzorzec testów; nowy plik `tests/integration/parent-secret-change.test.ts` → kosz 1 w `tests/integration-buckets.ts`.
- `docs/deploy.md:52`, `docs/architecture.md:304` -- dokumentacja.

## Tasks & Acceptance

**Execution:**
- `tests/integration/parent-secret-change.test.ts` -- RED: scenariusze z macierzy na PostgreSQL + przez HTTP (`handleParentApi`).
- `packages/server/src/modules/family/auth.ts` -- `changeParentSecret(services, token, currentSecret, newSecret)`.
- `apps/web/src/parent/orpc-contract.ts`, `apps/web/src/orpc/parent-router.ts` (+ test routera) -- `auth.changeSecret`.
- `apps/web/src/parent/ChangeSecretDialog.tsx`, `ParentShell.tsx`, `ParentApp.tsx`, `messages.ts` -- okno z polami: obecny, nowy, powtórz nowy.
- `docs/deploy.md`, `docs/architecture.md` -- sprostowanie.

**Acceptance Criteria:**
- Given zalogowany rodzic w panelu, when otworzy „Zmień PIN”, poda obecny i dwa razy nowy, then widzi ekran logowania i loguje się nowym PIN-em.
- Given niezgodne powtórzenie nowego PIN-u, when zatwierdzi, then widzi błąd bez wywołania API.

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 19 findings — high 0, medium 3, low 13, false 3, maybe-false 0 (intent audit: descriptive, 2 rows)
- findings:
  - `[low]` `[reject]` intent: limiter per sesja (R1b) zamiast kubełków logowania — świadomy wybór (Design Notes), opisany w architecture §13.
  - `[low]` `[reject]` intent: „ląduje na logowaniu” tylko w E2E mocked; łańcuch serwera pokrywa test integracyjny HTTP — prawdziwe E2E usunęłoby sesje równoległych speców.
  - `[medium]` `[patch]` verification-gap: brak testu, że zły obecny PIN zostawia okno — dodany mocked E2E 401 invalid_credentials.
  - `[medium]` `[patch]` verification-gap/edge/blind: unauthorized/conflict zostawiają martwy panel — okno wylogowuje przy tych kodach; E2E dla unauthorized.
  - `[low]` `[patch]` verification-gap/edge: kolejność w koszu — poprawiona.
  - `[low]` `[reject]` edge/blind: Map limitera rośnie o klucze sesji — jak istniejące kubełki urządzeń; jedna rodzina, jeden proces.
  - `[low]` `[reject]` edge/blind: posiadacz sesji ma +5 prób — sesja i tak daje pełny dostęp rodzica.
  - `[low]` `[reject]` edge: nowy == obecny wylogowuje wszystkich — nieszkodliwe, z woli rodzica.
  - `[low]` `[patch]` edge/blind: currentSecret bez max — kontrakt `.max(200)` na obu polach.
  - `[false]` `[reject]` edge: wygasła sesja w wąskim oknie — `requireParentSession` sprawdza sesję milisekundy wcześniej.
  - `[medium]` `[patch]` edge: test równoległej zmiany może flakować z invalid_credentials — test go dopuszcza.
  - `[low]` `[reject]` blind: urządzenia tracą ochronę #306 po zmianie — wymagane przez AC; opisane w architecture §13.
  - `[low]` `[patch]` blind: brak lokalnej kontroli długości — dodana.
  - `[low]` `[patch]` blind: architecture §13 bez zmian — uzupełnione.
  - `[false]` `[reject]` blind: brak kontroli sesji przed scrypt — router woła `requireParentSession` najpierw; transakcja pilnuje wyścigu.
  - `[low]` `[patch]` blind: przycisk tylko-ikona — Tooltip.
  - `[false]` `[reject]` blind: leave guard przy otwarciu okna — wzorzec jak logout; sukces zawsze wylogowuje.
  - `[low]` `[patch]` blind: niespójne słownictwo — hint „PIN-em lub hasłem”.
  - `[low]` `[reject]` blind: brak testów UI rate_limited/validation — ta sama ścieżka setError co invalid_credentials, pokryta E2E.

## Auto Run Result

Status: done. Zmiana: `changeParentSecret` (family), `POST /api/v1/parent/secret` (oRPC), `ChangeSecretDialog` + wejścia w ParentShell, docs deploy/architecture. Testy: integracja `parent-secret-change.test.ts` (6), router, mocked E2E `parent-change-secret.spec.ts`, listy `parent-shell-layout.spec.ts`. Poprawki: 10 (3 medium, 7 low); odłożone: 0. Follow-up review: false (brak high; poprawki medium to testy/UX zweryfikowane testami). Ryzyka: limiter w pamięci (jak logowanie); `next build` wypisuje jednorazowy komunikat o podatności Next.js (decyzja właściciela, nie uruchomiono upgrade).

## Design Notes

- Proces: RED-GREEN — najpierw test integracyjny i test routera, uruchom i pokaż, że padają (brak eksportu/procedury), potem minimalny kod.
- Kolejność w `changeParentSecret`: `assertSecretShape(newSecret)` → odczyt wiersza `parent_credentials` (brak → `setup_required`) → `limiter.reserve("session:" + hashToken(token))` → `verifySecret` (zły → `invalid_credentials`) → `limiter.succeed` → `hashSecret(newSecret)` → transakcja: `UPDATE parent_credentials SET password_hash = new WHERE id = 1 AND password_hash = old RETURNING` (0 wierszy → `conflict`), `DELETE FROM parent_sessions RETURNING token_hash`; brak hasha bieżącego tokenu wśród usuniętych → `unauthorized` (rollback). Kubełek per sesja: błędne próby zalogowanej sesji nie blokują logowania na innych urządzeniach.
- Router: `parentAuthOs.auth.changeSecret` + `sameOriginMiddleware`, `requireParentSession` jak w logout, odpowiedź 204 z `clearingSessionCookie`. Wejście `{ currentSecret: string.min(1), newSecret: string.min(1) }.strict()` — długość pilnuje serwer.
- Klient: wywołanie przez `callParent(() => parentClient.auth.changeSecret(...))`, NIE przez `useMutation` — globalny handler 401 w query-client wylogowałby rodzica przy złym obecnym PIN-ie (`invalid_credentials` = 401). Po sukcesie `signOutLocally()`.
- UI: pozycja „Zmień PIN” w menu ⋯ (telefon) przed „Wyloguj się”; od 600 px przycisk-ikona (nowa ikona `key` w `ParentIcon`) obok menu wyglądu z `aria-label`; okno Mantine `Modal` z trzema `PasswordInput` (`autoComplete` current/new-password), niezgodne powtórzenie → komunikat bez wywołania API. `data-testid`: `change-secret`, `change-secret-current`, `change-secret-new`, `change-secret-repeat`, `change-secret-submit`, `change-secret-error`. Akcję chroni `leaveGuard.requestLeave` jak logout.
- E2E: NIE zmieniaj prawdziwego PIN-u w E2E — usunięcie wszystkich sesji wywaliłoby równoległe specy. Krótki spec w partycji `mocked` (`tests/e2e/spec-projects.ts`) z API zaślepionym w przeglądarce (`page.route`, wzór: istniejące specy `mocked` panelu rodzica): otwarcie okna, niezgodne powtórzenie → błąd bez żądania, sukces (204) → ekran logowania; plus geometria (cel ≥ 48 px / brak przepełnienia nagłówka) jeśli `parent-shell-layout.spec.ts` tego nie pokrywa — dopisz nowy testid do jego list.

## Verification

**Commands:**
- `pnpm test:integration tests/integration/parent-secret-change.test.ts` -- zielone
- `corepack pnpm vitest run apps/web/src/orpc/parent-router.test.ts` -- zielone
- `pnpm check` -- zielone
- `pnpm test:e2e:shards --base-port=26200` -- zielone
