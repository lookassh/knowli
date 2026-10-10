# SDD ledger — plan: docs/superpowers/plans/2026-10-10-test-readiness.md

Base: e2db65104842e417e4d422dbc29a8044156a3f9b
Owner approved spec, configurable count, and detailed plan on 2026-10-10. Inline execution; independent reviewer only at end.
Workspace verified: existing linked worktree e035; branch feature/test-readiness.
Ruling: use pinned pnpm 10.34.6 through npx — system pnpm 11 ignores repo overrides and cannot install frozen lockfile — no dependency changes.
Ruling: translated task headings to Task N so native scripts can extract briefs — contents unchanged — no product impact.
Pre-flight: Task 1 contracts/count/mode → Tasks 2–6 consume identical names. Report types declared in Task 1, populated in Task 4.
Pre-flight: Task 2 uses close helper completed in Task 4; timeout finalization tests belong to Task 4, not premature completion in Task 2.
Pre-flight: Task 3 AttemptDto completed/null → Task 5 branches on session mode, not null feedback alone.
Pre-flight: Task 4 scope+report → Task 6 renders pinned version and full denominator, no live recalculation.
Tasks: 1 in progress; 2–7 pending. Baseline pending.
Task 1: RED contracts 13 failures, PostgreSQL 2 failures (missing fields); GREEN 13 unit + 2 PostgreSQL. Baseline 347 unit/typecheck pass. Ruling: shared skill status schema moved to common to avoid contracts import cycle; public values unchanged.
Task 1: complete (commits e2db651..a5cb03c, tests: npx --yes pnpm@10.34.6 test:integration tests/integration/mock-test-settings.test.ts →    Duration  4.12s (transform 281ms, setup 0ms, import 707ms, tests 274ms, environment 0ms))
Task 2: RED missing planner + 2 integration behavior failures; GREEN 8 planner tests and frozen plan/start/next on PostgreSQL. Ruling: training deck switches now require explicit close, as approved spec states; updated old regression to preserve active session on conflict.
Task 2: complete (commits a5cb03c..d4d01d8, tests: npx --yes pnpm@10.34.6 test:integration tests/integration/mock-tests.test.ts →    Duration  4.71s (transform 277ms, setup 0ms, import 690ms, tests 891ms, environment 0ms))
Task 3: RED 5 missing-feedback/terminal-state behaviors; GREEN 32 PostgreSQL regression tests, 368 unit, typecheck; additional cross-deck exposure test. All transport retries and finalized GETs retain null feedback; empty response unassessed, dont_remember difficulty.
Task 3: complete (commits d4d01d8..266805f, tests: npx --yes pnpm@10.34.6 test:integration tests/integration/mock-tests.test.ts →    Duration  6.04s (transform 278ms, setup 0ms, import 679ms, tests 2.19s, environment 0ms))
Task 4: RED report APIs missing/timeout behaviors; GREEN 61 PostgreSQL regressions + 370 unit + typecheck. Additional concurrency RED: two distinct clientAttemptIds both finalized because task was read before session lock. Fixed with task reread under lock; GREEN one accepted. Ruling: snapshot immutable closed report also protected by SQL trigger; pinned audioAssetId in slots for review.
