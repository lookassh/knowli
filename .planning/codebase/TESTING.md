---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# Testing Patterns

**Analysis Date:** 2026-10-21

## Test Framework

**Runner:**
- Vitest `^4.1.11` for unit and integration tests; configs: `vitest.unit.config.ts`, `vitest.integration.config.ts`.
- Playwright `^1.63.0` for browser E2E; config: `playwright.config.ts`.
- MCP Python integration tests use `unittest` via `package.json` script and `integrations/umiem-mcp/tests`.

**Assertion Library:** Vitest `expect` and Playwright `expect`.

**Run Commands:**

```bash
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:mcp
```

## Test File Organization

**Location:** Unit tests are co-located beside implementation in `packages/*/src` and `apps/*/src`; integration tests are centralized in `tests/integration`; E2E tests are in `tests/e2e`.

**Naming:** Use `*.test.ts`/`*.test.tsx` for Vitest and `*.spec.ts` for Playwright. Helpers and fixtures live under `tests/e2e/helpers`, `tests/integration`, and `tests/fixtures`.

**Structure:**

```
packages/*/src/**/*.test.ts      # pure contracts, domain, UI logic
apps/*/src/**/*.test.ts[x]       # app and worker unit tests
tests/integration/*.test.ts      # PostgreSQL-backed API/domain tests
tests/e2e/*.spec.ts              # full browser flows
```

## Test Structure

**Suite Organization:**

```typescript
describe("component or behavior", () => {
  it("describes the observable result", () => {
    expect(value).toEqual(expected);
  });
});
```

**Patterns:**
- Use Polish descriptions where the behavior is user-facing and English for lower-level domain/provider tests (`packages/contracts/src/messages.test.ts`, `packages/server/src/domain/confusion-priority.test.ts`).
- Build small fixture factories and override only scenario-specific fields (`packages/kid-ui/src/session/session-controller.test.ts`).
- Use `beforeEach` to reset fake state and `afterEach` for timers/mocks; restore timers with `vi.useRealTimers()` (`apps/worker/src/loop.test.ts`).
- Assert negative paths, privacy, idempotency, concurrency, and technical failures alongside happy paths.

## Mocking

**Framework:** Vitest `vi` mocks/spies and hand-written fakes.

**Patterns:**

```typescript
vi.mock("@learning/server", () => ({
  runDueGenerationWork: vi.fn(async () => ({ processed: 0 })),
}));
const provider = { transcribe: vi.fn() };
vi.mocked(provider.transcribe).mockRejectedValue(new Error("failure"));
```

**What to Mock:** External providers, network/fetch, media devices, clocks/timers, and worker dependencies. Use fake adapters from `tests/integration/fakes.ts` and `packages/server/src/providers/fake.ts`.

**What NOT to Mock:** Core deterministic domain rules and contract schemas. Integration tests use real PostgreSQL rather than an ORM mock; E2E uses fake providers but real web/worker processes.

## Fixtures and Factories

**Test Data:**

```typescript
function attemptDto(overrides: Partial<AttemptDto> = {}): AttemptDto {
  return { attemptId: "...", state: "completed", ...overrides };
}
```

**Location:** Reusable worlds are in `tests/fixtures`; integration builders are in `tests/integration/helpers.ts`; E2E setup helpers are in `tests/e2e/helpers`.

## Coverage

**Requirements:** No explicit coverage threshold or coverage script was detected. Maintain targeted coverage of acceptance criteria and regressions R01–R07.

**View Coverage:** No repository command is configured; use Vitest's standard coverage tooling only if the relevant provider is installed.

## Test Types

**Unit Tests:** Pure contracts, parsers, domain algorithms, UI state, media adapters, and worker loops; configured in `vitest.unit.config.ts` with Node environment and `passWithNoTests`.

**Integration Tests:** Real PostgreSQL in Docker, one container per run, serial file execution, and per-test cleanup (`vitest.integration.config.ts`, `tests/integration/global-setup.ts`).

**E2E Tests:** Playwright starts PostgreSQL, Next dev server, and worker through `tests/e2e/global-setup.ts`; tests run one worker, Polish locale, fake media input, and retain traces only on failure (`playwright.config.ts`).

## Common Patterns

**Async Testing:** Await promises directly and use `await expect(promise).rejects...`; gates/promises model races and lifecycle behavior (`packages/kid-ui/src/session/session-controller.test.ts`, `apps/worker/src/loop.test.ts`).

**Error Testing:** Assert stable `AppError` codes or safe public messages rather than provider internals (`packages/server/src/modules/deck-cover.test.ts`, `apps/web/src/integrations/learning-mcp-route.test.ts`).

**Regression Testing:** Name tests after the user-visible or invariant behavior, and include malformed input, retries, permission denial, stale/concurrent updates, and privacy boundaries (`tests/e2e/privacy.spec.ts`, `tests/integration/learning-overview-concurrency.test.ts`).

---

*Testing analysis: 2026-10-21*
