---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# Codebase Concerns

**Analysis Date:** 2026-10-21

## Tech Debt

**Single process assumptions:**
- Issue: Authentication throttling is process-local, and the code explicitly assumes one web instance.
- Files: `packages/server/src/modules/auth.ts`, `docs/architecture.md`
- Impact: Multiple web replicas do not share failed-login state, so an attacker can bypass the intended five-failure window by spreading attempts across replicas.
- Fix approach: Move the limiter to shared PostgreSQL state with an atomic update, or document and enforce single-instance deployment until horizontal scaling is supported.

**Dual schema sources:**
- Issue: Drizzle `packages/server/src/db/schema.ts` is authoritative, while `docs/schema.sql` remains a separate initial design and SQL migrations contain constraints Drizzle cannot express.
- Files: `packages/server/src/db/schema.ts`, `packages/server/drizzle/0001_guards_and_seed.sql`, `docs/schema.sql`
- Impact: Schema changes can drift unless every change is reviewed against both TypeScript and migration SQL.
- Fix approach: Keep a migration/schema consistency check in CI and treat `docs/schema.sql` as generated or clearly non-authoritative.

**Operational verification backlog:**
- Issue: The implementation plan still requires a complete Compose smoke, backup/restore verification, and real-device/real-child speech validation.
- Files: `docs/implementation-plan.md`, `docs/deploy.md`, `docs/operations/progress-rebuild.md`
- Impact: Passing unit and integration suites does not prove deployment recovery, microphone behavior, or pronunciation quality in production conditions.
- Fix approach: Run and record the listed smoke, restore, device, and provider checks before declaring the MVP operational.

## Known Bugs

**Unresolved end-to-end regressions recorded in project history:**
- Symptoms: Historical progress records repeated failures in `speech-recording-ux.spec.ts` and `parent-flow.spec.ts`, plus intermittent PostgreSQL readiness/setup failures.
- Files: `docs/superpowers/progress/2026-10-11-kid-decks-scrollable-list.md`, `docs/superpowers/progress/2026-10-11-deck-mastery-stars.md`
- Trigger: Full browser runs and parallel database/container setup.
- Workaround: Run isolated E2E contexts with unique runner IDs and ports; confirm current main before treating old reports as active defects.

## Security Considerations

**Unauthenticated Kid API boundary:**
- Risk: Kid profile/deck reads intentionally rely on a trusted private deployment and accept a `childId`; exposing the service publicly would make identifiers and learning data discoverable without child authentication.
- Files: `apps/web/src/kid/kid-router.ts`, `docs/architecture.md`, `docs/deploy.md`
- Current mitigation: Parent Mode protects parent operations, mutating Kid requests require same-origin checks, and deployment guidance keeps the service private.
- Recommendations: Require an explicit access gateway before internet exposure; add a narrowly scoped child/session capability if public hosting becomes a requirement.

**Backup confidentiality:**
- Risk: `pg_dump` and media archives are written as ordinary local files and protected only by filesystem access and SHA-256 integrity checks; they are not encrypted.
- Files: `deploy/backup.sh`, `deploy/restore.sh`, `docs/deploy.md`
- Current mitigation: Secrets are excluded from repository files and restore requires an explicit `--yes` for the production project.
- Recommendations: Encrypt backups at rest, define retention and off-host storage permissions, and document key recovery separately from the archive.

**Proxy trust for security headers:**
- Risk: Cookie security and same-origin validation trust `x-forwarded-proto` and `x-forwarded-host`; a misconfigured or directly exposed proxy can weaken HTTPS/cross-site assumptions.
- Files: `apps/web/src/http/security.ts`, `docs/deploy.md`
- Current mitigation: SameSite cookies, HttpOnly cookies, Origin checks, and deployment behind Coolify HTTPS.
- Recommendations: Restrict direct access to the web container and document the trusted proxy boundary; add production checks for forwarded-header configuration.

## Performance Bottlenecks

**Large synchronous domain modules:**
- Problem: Core lesson/session modules contain very large orchestration paths and transaction-heavy flows.
- Files: `packages/server/src/modules/lessons/lesson-drafts.ts`, `packages/server/src/modules/lessons/lesson-attempts.ts`, `packages/server/src/modules/attempts.ts`
- Cause: Generation, validation, persistence, retries, and response shaping are handled in long functions.
- Improvement path: Preserve transaction boundaries but split pure planning, persistence, and provider orchestration into separately measurable functions; add query timing around the profile/deck paths.

**Media reads load complete blobs:**
- Problem: Local media retrieval reads the whole file into memory for every request.
- Files: `packages/server/src/providers/media/local.ts`, `apps/web/src`
- Cause: `readFile` returns a full `Uint8Array`, which is suitable for small MVP assets but scales with concurrent audio/image requests.
- Improvement path: Add bounded streaming/range support after measuring real asset sizes, while retaining opaque storage keys and ready-state authorization.

## Fragile Areas

**Exposure and attempt ordering:**
- Files: `packages/server/src/modules/attempts.ts`, `packages/server/src/modules/events.ts`, `packages/server/src/db/schema.ts`
- Why fragile: Correctness depends on locking, sealed events, idempotency, and writing exposure before returning child-visible content across multiple transactions.
- Safe modification: Change one operation at a time and retain R01/R03/R04 concurrency and idempotency regressions in `tests/integration/`.
- Test coverage: Strong regression coverage exists, but real multi-browser and production PostgreSQL execution remain operational checks.

**Provider adapters and child feedback:**
- Files: `packages/server/src/providers/openai-compatible/grader.ts`, `packages/server/src/providers/openai-compatible/session-activity.ts`, `packages/server/src/providers/azure`, `packages/kid-ui/src/media/browser.ts`
- Why fragile: Timeouts, provider response shape, microphone lifecycle, and unknown recognition outcomes cross server/client boundaries; a false positive is materially worse than an unevaluated result.
- Safe modification: Keep provider parsing isolated, preserve neutral fallbacks, and update contract plus E2E tests together.
- Test coverage: Fake-provider tests cover transport shapes; real Azure pronunciation, device permissions, and child speech quality are not validated in repository tests.

**Deployment migration ordering:**
- Files: `deploy/compose.yaml`, `deploy/Dockerfile`, `deploy/migrate.ts`, `packages/server/drizzle`
- Why fragile: Web and worker depend on a one-shot migration container and shared volumes; a failed or partially applied migration prevents the stack from becoming healthy.
- Safe modification: Test migrations on the target PostgreSQL version and verify restart/rollback behavior in an isolated Compose project before changing startup dependencies.
- Test coverage: Compose smoke is specified but not evidenced as part of this mapping.

## Scaling Limits

**One web and one worker instance:**
- Current capacity: Deployment and auth comments assume one web process and one worker process.
- Limit: In-memory login limiting and worker polling/lease behavior require coordinated shared state before replicas can be added.
- Scaling path: Keep leases and rate limits database-backed, then load-test concurrent sessions and generation/media jobs before enabling replicas.

**Database-backed queue and history growth:**
- Current capacity: Graphile Worker, learning events, attempts, exposures, and projections share PostgreSQL.
- Limit: Large history and JSONB activity reports can increase indexes, vacuum work, and reporting latency.
- Scaling path: Monitor table/index growth, enforce retention for `activity_report` as designed, and add archival/partitioning only from measured production data.

## Dependencies at Risk

**External speech and AI providers:**
- Risk: Azure/OpenAI-compatible endpoints determine availability, latency, model response shape, and cost; concrete model quality and pricing are not treated as verified contracts.
- Impact: Speech feedback or generation may become unavailable or unevaluated while text sessions should continue.
- Migration plan: Keep ports and fake adapters stable, validate structured output and timeouts, and add/maintain provider-specific adapters behind `packages/server/src/ports/ai.ts`.

## Missing Critical Features

**Public access boundary:**
- Problem: Internet exposure/access gateway is intentionally undecided.
- Blocks: Safe use outside the trusted home network.

**Production evidence for speech and recovery:**
- Problem: Real-device speech calibration and documented backup restore remain required evidence.
- Blocks: Claiming complete, reliable MVP operation for pronunciation and disaster recovery.

## Test Coverage Gaps

**Real deployment and device behavior:**
- What's not tested: Target PostgreSQL Compose migration/restart, encrypted/verified backup policy, physical mobile microphone/keyboard behavior, and real provider pronunciation quality.
- Files: `deploy/compose.yaml`, `deploy/backup.sh`, `packages/kid-ui/src/media/browser.ts`, `docs/implementation-plan.md`
- Risk: Deployment-only failures, permissions issues, or misleading speech feedback can escape automated tests.
- Priority: High

**Replica and abuse scenarios:**
- What's not tested: Login throttling across multiple web processes, forwarded-header misconfiguration, and public exposure of unauthenticated Kid reads.
- Files: `packages/server/src/modules/auth.ts`, `apps/web/src/http/security.ts`, `apps/web/src/kid/kid-router.ts`
- Risk: Security assumptions fail when deployment differs from the single-instance private-network model.
- Priority: Medium

---

*Concerns audit: 2026-10-21*
