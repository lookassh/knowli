# Ustawienie trybu nagrywania dla profilu dziecka — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only with explicit owner approval. Before completion, use superpowers:requesting-code-review.

**Goal:** Rodzic wybiera `hold` lub `toggle` dla profilu dziecka, a Kid UI stosuje zapisany tryb bez przełącznika na ekranie ćwiczenia.

**Architecture:** Dodajemy preferencję `recording_mode` do `child_profiles`, walidujemy ją w kontraktach rodzica i zwracamy w istniejącym Kid Profile DTO. Panel rodzica zapisuje ją przez istniejący PATCH profilu, a kontroler sesji ustawia tryb z wybranego profilu; istniejący `SpeechRecordButton` zachowuje obsługę obu gestów.

**Tech Stack:** TypeScript strict, Zod, Drizzle, PostgreSQL, React, Next.js, Vitest, Playwright i istniejące migracje SQL; bez nowych zależności.

**Spec:** `docs/superpowers/specs/2026-10-11-parent-recording-mode-setting-design.md`.

## Global Constraints

- Nowe i istniejące profile domyślnie używają `hold`.
- `hold` oznacza przytrzymanie przycisku, a `toggle` osobne naciśnięcie, aby rozpocząć i zatrzymać nagranie.
- Widok dziecka dostaje tryb z profilu pobranego przez Kid API. Nie zapisuje ani nie zmienia trybu lokalnie.
- Kid UI konsumuje wyłącznie publiczny DTO; nie importuje kodu serwerowego ani Next.js.
- Audio dziecka nadal jest przetwarzane krótkotrwale w pamięci zgodnie z dotychczasowymi wymaganiami.
- Poprzednia wartość `umiem.recordingMode` w `localStorage` nie jest importowana.
- Ustawienie nie zmienia oceny odpowiedzi, kwalifikacji, ujawnień, limitu czasu nagrania ani przechowywania audio.

## Review Focus

1. Profil dziecka bez jawnego wyboru po migracji → API i UI zwracają `hold`; test migracji/integracji w Task 1.
2. PATCH zmienia wyłącznie tryb → inne pola profilu i historia pozostają bez zmian; integracja Task 1.
3. Dwa profile z różnymi trybami w tej samej przeglądarce → po zmianie profilu przycisk używa właściwego gestu; test kontrolera i E2E w Task 3.
4. Nieznana wartość trybu → kontrakt ją odrzuca, a constraint PostgreSQL blokuje zapis; testy kontraktu i integracji w Task 1.
5. Pozostała stara wartość `localStorage=toggle` → nie nadpisuje trybu profilu; test kontrolera i E2E w Task 3.

## Mapa plików

- `packages/server/src/db/schema.ts` i `packages/server/drizzle/0005_child_recording_mode.sql` wraz z metadanymi Drizzle: trwałe pole i kontrola `hold | toggle`.
- `packages/contracts/src/decks.ts`, `kid.ts`, `messages.ts` i ich testy: wartości DTO oraz polskie etykiety panelu.
- `packages/server/src/modules/profiles.ts`, `kid.ts` oraz testy kontraktów/integracji: odczyt, walidacja i zapis profilu.
- `apps/web/src/parent/ChildEditor.tsx` i `tests/e2e/parent-flow.spec.ts`: kontrolka w formularzu profilu i zapis przez istniejące PATCH.
- `packages/kid-ui/src/storage.ts`, `session/session-controller.ts`, `screens/LearnScreen.tsx`, `exercises/SpeechRecordButton.tsx` oraz testy kontrolera/E2E: tryb z Kid Profile DTO i usunięcie lokalnego przełącznika.
- `docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md` i `docs/superpowers/specs/2026-10-10-speech-recording-ux-design.md`: aktualizacja kontraktów i zastąpienie wcześniejszej decyzji o preferencji lokalnej.
- `docs/superpowers/progress/2026-10-11-parent-recording-mode-setting.md`: dziennik bazy, dowodów RED/GREEN, komend, review i odstępstw.

---

### Task 1: Zapis ustawienia w profilu i kontraktach API

**Files:**
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/drizzle/0005_child_recording_mode.sql`
- Modify: `packages/server/drizzle/meta/_journal.json` and generated `0005_snapshot.json`
- Modify: `packages/contracts/src/decks.ts`, `packages/contracts/src/kid.ts`
- Modify: `packages/server/src/modules/profiles.ts`, `packages/server/src/modules/kid.ts`
- Test: `packages/contracts/src/child-profile.test.ts`
- Test: `tests/integration/auth-profiles.test.ts`
- Test: `tests/integration/recording-mode-migration.test.ts`

**Interfaces:**
- Produces `RecordingModeSchema = z.enum(["hold", "toggle"])` and `RecordingModeDto = z.infer<typeof RecordingModeSchema>` in `contracts/src/decks.ts`.
- `ChildDto` contains required `recordingMode`; `ChildPatch` accepts optional `recordingMode`; creation input stays unchanged.
- `KidProfileDto` contains required `recordingMode` and `listKidProfiles()` returns the database value.
- `updateChild(services, childId, input)` updates only supplied fields and returns the current preference.

- [ ] **Step 1: Add failing contract tests** for valid `hold`/`toggle`, rejection of unknown mode, `ChildPatch` mode-only updates, and required mode in parent/kid DTOs.
- [ ] **Step 2: Run the focused contract tests and confirm RED.**

Run: `npx --yes pnpm@10.34.6 exec vitest run packages/contracts/src/child-profile.test.ts`

Expected: FAIL because recording mode is not part of the schemas yet.

- [ ] **Step 3: Add failing PostgreSQL integration coverage** for default `hold`, parent PATCH to `toggle`, Kid Profile DTO readback, mode-only PATCH preserving name/avatar/policy/history, and direct SQL writes of unknown values/`NULL` rejected by the mode constraint and `NOT NULL` constraint.
- [ ] **Step 4: Run the focused integration test and confirm RED.**

Run: `npx --yes pnpm@10.34.6 exec vitest run --config vitest.integration.config.ts tests/integration/auth-profiles.test.ts`

Expected: FAIL because the column and DTO fields do not exist.

- [ ] **Step 5: Add a separate migration-history integration case** that creates a temporary database in the integration PostgreSQL container, applies migrations `0000`–`0004` from a temporary migration folder, inserts a profile with existing name/avatar data, applies migration `0005`, and verifies `recording_mode='hold'` plus preservation of the existing profile fields. Clean up the temporary database and migration folder in `finally`.

Run: `npx --yes pnpm@10.34.6 exec vitest run --config vitest.integration.config.ts tests/integration/recording-mode-migration.test.ts`

Expected: FAIL because migration `0005_child_recording_mode.sql` does not exist.

- [ ] **Step 6: Add `recordingMode` to the Drizzle child profile schema** as `text().notNull().default("hold")` with a named CHECK allowing only `hold`/`toggle`; generate and inspect migration `0005_child_recording_mode.sql` and its snapshot/journal updates.

Run: `npx --yes pnpm@10.34.6 --filter @learning/server db:generate --name child_recording_mode`

Expected: migration adds a NOT NULL column defaulting to `hold` and a CHECK constraint; review generated SQL before keeping it.

- [ ] **Step 7: Implement the contracts and profile modules** using the shared enum, mapping the required field from rows, and including it in only supplied PATCH fields. Do not accept it in `ChildInput`.
- [ ] **Step 8: Run contract and PostgreSQL integration tests to confirm GREEN.**

Run: `npx --yes pnpm@10.34.6 exec vitest run packages/contracts/src/child-profile.test.ts` and `npx --yes pnpm@10.34.6 exec vitest run --config vitest.integration.config.ts tests/integration/auth-profiles.test.ts`

Expected: both commands PASS; the separate migration case confirms an existing pre-0005 profile receives `hold` without losing its fields.

- [ ] **Step 9: Commit** `feat: persist recording mode on child profile`.

### Task 2: Ustawienie w panelu rodzica

**Files:**
- Modify: `packages/contracts/src/messages.ts`
- Modify: `apps/web/src/parent/ChildEditor.tsx`
- Test: `tests/e2e/parent-flow.spec.ts`

**Interfaces:**
- Parent profile editor exposes a labeled control with `hold` (“Przytrzymaj, aby mówić”) and `toggle` (“Naciśnij, aby rozpocząć i zatrzymać”).
- Save uses the existing `PATCH /api/v1/parent/children/:id` and includes `recordingMode` only when changed.

- [ ] **Step 1: Add failing E2E assertions** that the editor shows the saved default `hold`, allows selecting `toggle`, saves it, reopens with `toggle`, and preserves other child fields.
- [ ] **Step 2: Run the focused E2E test and confirm RED.**

Run: `npx --yes pnpm@10.34.6 exec playwright test tests/e2e/parent-flow.spec.ts`

Expected: FAIL because the setting control is absent.

- [ ] **Step 3: Add concise Polish labels** to the shared messages catalog and add the mode control to the existing child profile edit form.
- [ ] **Step 4: Extend `editChanged` and the PATCH payload** to track/save `recordingMode`, while preserving current validation, busy state, error handling, and focus restoration.
- [ ] **Step 5: Run the focused parent E2E test to confirm GREEN.**

Run: `npx --yes pnpm@10.34.6 exec playwright test tests/e2e/parent-flow.spec.ts`

Expected: PASS, including saving and reopening the persisted per-child value.

- [ ] **Step 6: Commit** `feat: add parent recording mode setting`.

### Task 3: Tryb profilu w Kid UI i usunięcie przełącznika dziecka

**Files:**
- Modify: `packages/kid-ui/src/storage.ts`
- Modify: `packages/kid-ui/src/session/session-controller.ts`
- Modify: `packages/kid-ui/src/screens/LearnScreen.tsx`
- Modify: `packages/kid-ui/src/exercises/types.ts`
- Modify: `packages/kid-ui/src/exercises/SpeechRecordButton.tsx`
- Modify: `packages/kid-ui/src/exercises/SpeechView.tsx`, `WrittenView.tsx`
- Modify: `packages/contracts/src/messages.ts`
- Test: `packages/kid-ui/src/session/session-controller.test.ts`
- Test: `tests/e2e/speech-recording-ux.spec.ts` and `tests/e2e/kid-flow.spec.ts` where profile navigation requires regression coverage.
- Create: `docs/superpowers/progress/2026-10-11-parent-recording-mode-setting.md`

**Interfaces:**
- `LearningScreen.recordingMode` remains `"hold" | "toggle"`, but its source becomes the selected `KidProfileDto.recordingMode`.
- `LocalPreferences` retains unrelated profile/session/microphone storage; it no longer reads or writes `umiem.recordingMode`.
- Existing `SpeechRecordButton` keeps both interaction behaviors and receives only the selected profile's mode.

- [ ] **Step 1: Replace old local-mode assertions and add failing controller tests** for direct `initialChildId` selection, selecting profiles with distinct modes, using each mode in learning, and ignoring a stale `umiem.recordingMode=toggle` local value when the selected profile says `hold`. Preserve existing tests for hold/toggle gestures, cancellation, and microphone cleanup.
- [ ] **Step 2: Run the focused controller tests and confirm RED.**

Run: `npx --yes pnpm@10.34.6 exec vitest run packages/kid-ui/src/session/session-controller.test.ts`

Expected: FAIL because the controller reads and writes the local recording preference.

- [ ] **Step 3: Replace the old child-facing mode-toggle E2E case** with failing assertions for parent-selected `hold` and `toggle`, profile-specific behavior after switching children, and absence of “Wolisz nacisnąć raz? Zmień tryb” after starting/refreshing an exercise. Use fake media only; keep traces off for recording-flow tests. Keep existing gesture and cancellation assertions.
- [ ] **Step 4: Run the focused controller and speech UX tests and confirm RED** before changing implementation.

Run: `npx --yes pnpm@10.34.6 exec vitest run packages/kid-ui/src/session/session-controller.test.ts` and `npx --yes pnpm@10.34.6 exec playwright test tests/e2e/speech-recording-ux.spec.ts`

Expected: new profile-driven controller and E2E assertions fail; old local-mode tests have been replaced, and speech feedback behavior remains unchanged.

- [ ] **Step 5: Remove the local recording preference key, reader, and writer** while retaining all other local preferences. Type `LearningScreen`, `ExerciseProps`, and `SpeechRecordButton` with the shared `RecordingModeDto` contract instead of `storage.ts`; remove `onRecordingModeChange`/`onModeChange` from `ExerciseHandlers`, `SpeechRecordButtonProps`, and component wiring; keep the selected `recordingMode` prop used to render the existing gesture behavior. Remove the obsolete child-facing `recordModeToggle` and `recordModeHold` messages.
- [ ] **Step 6: Initialize/update the controller's recording mode from the selected profile** on initial route selection, profile selection, and return to profile selection; remove the user-driven `setRecordingMode` path and the inline change link.
- [ ] **Step 7: Run focused controller, speech UX, and kid-flow tests to confirm GREEN.**

Run: `npx --yes pnpm@10.34.6 exec vitest run packages/kid-ui/src/session/session-controller.test.ts` and `npx --yes pnpm@10.34.6 exec playwright test tests/e2e/speech-recording-ux.spec.ts tests/e2e/kid-flow.spec.ts`

Expected: PASS; both modes follow the selected profile, stale local preference has no effect, the link is absent, and gesture/cancellation regressions remain green.

- [ ] **Step 8: Update product and architecture docs** (`docs/SPEC.md`, `docs/architecture.md`, `docs/folder-structure.md`, `docs/implementation-plan.md`, and the earlier speech UX design) to describe profile persistence, Kid DTO delivery, migration default, and removal of device-local mode storage. Do not edit `docs/schema.sql` as a second authoritative schema.
- [ ] **Step 9: Run final checks**: `npx --yes pnpm@10.34.6 test:unit`, `npx --yes pnpm@10.34.6 test:integration`, `npx --yes pnpm@10.34.6 test:e2e`, `npx --yes pnpm@10.34.6 typecheck`, `npx --yes pnpm@10.34.6 build`, and `git diff --check`. Update the execution progress log created in setup with exact results; do not claim checks that were not run.
- [ ] **Step 10: Commit** `docs: align recording mode contracts with parent setting` and record any verification gaps.

## Execution Setup

- [ ] Create `docs/superpowers/progress/2026-10-11-parent-recording-mode-setting.md` before Task 1. Record approval of this spec/plan, clean worktree state, `BASE_SHA=b6d4f679a6d1f543e51c3ef5e8546f255528f226`, scripts, baseline `pnpm test:unit` and `pnpm typecheck`, and a checkbox per task. During work, record each RED result, GREEN result, command output summary, commit, review, and deviation before marking that step complete.
- [ ] Confirm `HEAD` is the approved plan commit on `feature/parent-recording-mode-setting`, and that the worktree has no unrelated changes before creating the progress log.

## Review Corrections

- [x] Reordered Task 3 so controller and E2E RED are recorded before implementation; replacement tests explicitly remove old local-setting expectations while keeping gesture/cancellation coverage.
- [x] Added a separate migration-history test against a temporary database that stops at migration 0004 before applying 0005; added explicit `NOT NULL` coverage for direct SQL writes.
- [x] Added `exercises/types.ts`, `SpeechView.tsx`, and `WrittenView.tsx` to the Task 3 wiring scope, including removal of both stale child-toggle message keys.
- [x] Moved progress-log creation into execution setup and added initial-route `initialChildId` coverage.

## Handoff

Implement inline in this worktree after owner approval, using `superpowers:executing-plans` before the first code change. Delegated implementation requires explicit owner approval. Before reporting completion, request an independent whole-scope review with the strongest available non-Astra reviewer, resolve Critical/Important findings with evidence, then run `verification-before-completion` and `finishing-a-development-branch`. The existing `origin/main` base is `b6d4f679a6d1f543e51c3ef5e8546f255528f226`; do not use the historical speech recording branch as the base.
