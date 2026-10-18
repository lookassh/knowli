# Profile navigation B progress

Status: implementation in progress; B1–B3 projection/data work is implemented locally. B4 list-reader integration is being completed by the supervising agent.

## Data model and migration

Migration `0019_policy_scoped_learning_projections` adds a per-child readiness marker, replaces the active projection key with `(child, skill_version, policy)`, and preserves the former projection table as `child_skill_progress_legacy` for migration backup only. Runtime readers do not fall back to the legacy table. A successful per-child rebuild replays every credible policy/skill history and issued-task fact, rebuilds sealed target exposure MIN/MAX, sets `proj-3` readiness, and removes that child's legacy backup rows in the same transaction. An empty backup table may be removed by a separate later migration; rollback still requires a database backup/snapshot.

New exposures update `first_exposure_at` by atomic MIN and `last_exposure_at` by atomic MAX in the same transaction that seals the source event. Issued-task facts and policy-scoped progress are maintained by the shared projection writer. Latest credible review time is selected by maximum assessment `receivedAt`, rather than the currently finalized attempt's potentially older timestamp. Parent reports explicitly choose the latest non-null credible `last_reviewed_at`, with policy id as a deterministic tie-breaker.

## RED/GREEN and verification

`history-policy-scope.test.ts` first failed because the old snapshot reader returned a `mastered` row from another policy. After adding explicit policy scoping, it passes. A second test races two first-issue writes for one policy/skill and verifies SQL MIN keeps the earlier timestamp.

`progress-rebuild.test.ts` now switches to learning-v1, asserts that the first task is a new exposure (learning-v2 progress does not leak), completes the exposure flow, and then evaluates a real v1 task. Both rebuild integration tests pass. The test also checks dry-run immutability, apply idempotence, downgrade behavior, and active/processing guards.

Verified locally:

- `corepack pnpm --filter @learning/server typecheck` — passed.
- `UMIEM_TEST_RUN_ID=nav-b corepack pnpm test:integration tests/integration/progress-rebuild.test.ts tests/integration/history-policy-scope.test.ts` — 2 files, 4 tests passed.

An earlier broader focused batch had failures from raw-SQL fixtures using the old primary key and missing policy facts. Fixture updates are being coordinated separately. The list-reader replacement, full contract suite, build, Drizzle snapshot consistency, and final review remain outstanding.
