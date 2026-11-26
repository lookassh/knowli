---
title: 'gh-261: „Zmień profil” na ekranie zestawów'
type: 'feature'
created: '2026-11-26'
status: 'done'
baseline_revision: '39204eab9fa4d79ae1a1cfb95eb547216b2e3b2e'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/docs/agents/kid-ui.md', '{project-root}/docs/agents/testing.md']
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Po wyborze profilu ekran zestawów nie pozwala wrócić do wyboru profilu; pomyłkowe stuknięcie profilu rodzeństwa kończy się nauką na cudzym koncie.

**Approach:** Dyskretna akcja „Zmień profil” przy powitaniu na `DeckScreen`, widoczna tylko przy więcej niż jednym profilu, wołająca istniejące `controller.switchProfile()` (nie dotyka sesji na serwerze).

## Boundaries & Constraints

**Always:** tylko wspólne komponenty (`ActionButton`), tokeny CSS; cel ≥ 48 px; tekst `messages.kid.switchProfile`; testid `kid-switch-profile` (jak na podsumowaniu).

**Always (proces):** ścisłe RED-GREEN — najpierw testy E2E, uruchom je i zapisz w raporcie, że padają z powodu braku akcji (RED); dopiero potem kod (GREEN). Pojedynczy spec: `$env:UMIEM_E2E_WEB_MODE='dev'; corepack pnpm exec playwright test <plik> --project=mocked` albo dla `kid-flow.spec.ts`: `$env:UMIEM_E2E_BUCKET='1'; ... --project=real -g <nazwa testu>` (wymaga Dockera; inna sesja może używać portów — w razie konfliktu ustaw `UMIEM_E2E_PORT`, zob. `tests/e2e/global-setup.ts`).

**Never:** brak nowego endpointu, zmian kontraktu, kończenia/usuwania sesji; brak surowego `<button>`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Dwa profile | ekran zestawów | akcja widoczna, klik → ekran „Kto się dziś uczy?” bez startu sesji | brak |
| Jeden profil | ekran zestawów | akcji nie ma | brak |
| Zły profil ma aktywną sesję | powrót → inny profil → start | sesja złego profilu nadal `active` w bazie | brak |

</intent-contract>

## Code Map

- `packages/kid-ui/src/screens/DeckScreen.tsx` -- nagłówek z `kid-greeting`; dodać prop `onSwitchProfile?`.
- `packages/kid-ui/src/KidApp.tsx:154` -- case `deck`; przekazać `onSwitchProfile` tylko gdy `screen.profiles.length > 1`.
- `packages/kid-ui/src/session/session-controller.ts:2389` -- `switchProfile()` (epoch++, ekran profili, bez wywołań API sesji) — reuse, bez zmian.
- `packages/kid-ui/src/styles.css:535,628` -- `.kid-greeting`; układ powitania z akcją.
- `tests/e2e/helpers/kid-fixtures.ts:255` -- `openDeckScreen` (jeden profil) — dodać opcję profili.
- `tests/e2e/kid-decks-layout.spec.ts` (mocked) -- geometria i widoczność.
- `tests/e2e/kid-flow.spec.ts` (real) -- przepływ z bazą.

## Tasks & Acceptance

**Execution:**
- `tests/e2e/kid-decks-layout.spec.ts` -- test: 1 profil → brak akcji; 2 profile → akcja ≥48 px, w kolumnie, bez przepełnienia w portrait/landscape/tablet/desktop; klik → ekran profili bez POST `/sessions`.
- `tests/e2e/kid-flow.spec.ts` -- test: sesja Oli aktywna → wybór Oli (pomyłka) → Zmień profil → Ewa → start → w bazie sesja Oli `active`, Ewy `active`.
- `packages/kid-ui/src/screens/DeckScreen.tsx`, `KidApp.tsx`, `styles.css` -- implementacja.

**Acceptance Criteria:**
- Given dwa profile, when dziecko na ekranie zestawów stuknie „Zmień profil”, then widzi wybór profilu i nie rozpoczęto sesji.
- Given jeden profil, when ekran zestawów, then brak akcji.
- Given aktywna sesja profilu A, when wybór A → powrót → B → start, then sesja A dalej aktywna, B ma nową sesję.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `corepack pnpm check` -- expected: zielone
- `corepack pnpm test:e2e:shards --base-port=27000` -- expected: wszystkie przechodzą

## Auto Run Result

Status: done. Niezależny review: brak defektów; zastosowano uwagę o `row-gap` w `.kid-greeting-row`. `pnpm test:e2e:shards --base-port=27000`: mocked 588 passed / 13 skipped, real-1…4 PASS.
