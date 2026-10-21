---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# Coding Conventions

**Analysis Date:** 2026-10-21

## Naming Patterns

**Files:**
- TypeScript modules use lower-kebab or lower-case descriptive names (`packages/server/src/learning-time.ts`, `apps/web/src/parent/parent-router.ts`); React components use PascalCase (`apps/web/src/parent/DeckEditor.tsx`). Tests append `.test.ts`, `.test.tsx`, or `.spec.ts`.

**Functions:**
- Functions and handlers use camelCase, with factories named `create...` and environment parsers named `...FromEnv` (`packages/server/src/config.ts`, `apps/worker/src/loop.ts`).

**Variables:**
- Local values and parameters use camelCase; constants use UPPER_SNAKE_CASE for exported or fixture-wide values (`packages/kid-ui/src/session/session-controller.test.ts`).

**Types:**
- Interfaces, type aliases, DTOs, and classes use PascalCase; discriminated unions and enum-like values use lower-case string literals (`packages/contracts/src/*.ts`).

## Code Style

**Formatting:**
- TypeScript is strict and uses semicolon-terminated statements, double-quoted imports/strings, trailing commas in multiline literals, and two-space indentation. Shared compiler settings are in `tsconfig.base.json`.

**Linting:**
- No repository ESLint or Prettier configuration was detected. Keep formatting consistent with nearby files and rely on `pnpm typecheck` plus tests for enforced quality checks.

## Import Organization

**Order:**
1. External packages (`vitest`, `@learning/*`, React/Next)
2. Type-only imports
3. Relative implementation imports

**Path Aliases:**
- Workspace packages use `@learning/contracts`, `@learning/server`, and `@learning/kid-ui`; integration Vitest adds `@` for `apps/web/src` in `vitest.integration.config.ts`.

## Error Handling

**Patterns:**
- HTTP/domain boundaries throw typed `AppError` values with stable error codes (`apps/web/src/http/errors.ts`, `apps/web/src/http/security.ts`).
- Validate input at boundaries with Zod and convert failures to `AppError("validation")` (`apps/web/src/integrations/learning-overview-route.ts`, `apps/web/src/kid/kid-router.ts`).
- Provider and configuration failures throw explicit `Error` messages; technical failures are mapped to safe user-facing messages and logged centrally (`packages/server/src/providers/azure/stt.ts`, `apps/web/src/http/errors.ts`).
- Async failures are tested with `rejects.toThrow`, `rejects.toMatchObject`, or explicit fallback assertions.

## Logging

**Framework:** console

**Patterns:**
- Logs are limited to process/API boundaries and prefixed with component tags (`[api]`, `[worker]`, `[health]`) in `apps/web/src/http/errors.ts`, `apps/worker/src/main.ts`, and `apps/worker/src/tasks.ts`.
- Do not log secrets, child recordings, or private database details; integration tests explicitly assert redaction (`apps/web/src/integrations/learning-mcp-server.test.ts`).

## Comments

**When to Comment:**
- Comments explain architectural constraints, privacy rules, or why a test fixture exists; routine code is self-describing. Examples are in `packages/contracts/src/messages.ts` and `packages/kid-ui/src/session/session-controller.test.ts`.

**JSDoc/TSDoc:**
- Short module comments and inline rationale are used where behavior is security- or contract-sensitive. Formal JSDoc is not required broadly.

## Function Design

**Size:** Keep domain helpers focused and pure where practical; split transport, validation, and orchestration across modules such as `apps/web/src/kid/kid-router.ts` and `packages/server/src/domain/`.

**Parameters:** Prefer typed object parameters for multi-field inputs and `Partial<T>` override helpers in tests (`packages/kid-ui/src/session/session-controller.test.ts`).

**Return Values:** Use explicit DTOs and discriminated result/status objects; avoid serializing database rows directly. Nullable values are represented explicitly (`packages/contracts/src/*`, `packages/server/src/providers/azure/stt.ts`).

## Module Design

**Exports:** Prefer named exports for functions, schemas, constants, and types. Default exports are uncommon and mainly configuration files.

**Barrel Files:** Workspace package entrypoints re-export public contracts; internal modules import through package aliases where available (`packages/contracts/src/index.ts`, `packages/server/src/index.ts`).

---

*Convention analysis: 2026-10-21*
