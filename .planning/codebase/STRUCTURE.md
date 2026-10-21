---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# Codebase Structure

**Analysis Date:** 2026-10-21

## Directory Layout

```text
knowli/
├── apps/
│   ├── web/                 # Next.js UI, API and MCP host
│   └── worker/              # Node worker for durable background work
├── packages/
│   ├── contracts/           # Public DTOs, Zod schemas and messages
│   ├── kid-ui/              # Portable child React application
│   └── server/              # Domain, use cases, database and adapters
├── integrations/umiem-mcp/  # Versioned Python MCP consumer contract/skill
├── tests/                   # PostgreSQL integration, Playwright E2E, fixtures
├── deploy/                  # Compose, image, migration and backup scripts
├── docs/                    # Product, architecture and operational contracts
├── scripts/                 # Workspace/setup/schema utility scripts
└── .planning/codebase/      # Generated codebase mapping documents
```

## Directory Purposes

**`apps/web/`:** Next.js App Router application. Pages are under `apps/web/src/app/`; parent components and routers under `apps/web/src/parent/`; Kid host/API under `apps/web/src/kid/`; shared HTTP security/errors under `apps/web/src/http/`; MCP under `apps/web/src/integrations/`.

**`apps/worker/`:** Background process. Use `apps/worker/src/main.ts` for lifecycle, `composition.ts` for dependencies, `loop.ts` for scheduling, and `tasks.ts` for mapping passes to server use cases.

**`packages/contracts/`:** Public client/server boundary. Add DTO/schema families to `packages/contracts/src/` and export them from `packages/contracts/src/index.ts`; keep secrets, answer keys and database row shapes out.

**`packages/kid-ui/`:** Host-agnostic child UI. Screens belong in `src/screens/`, exercise views in `src/exercises/`, lesson views in `src/exercises/lesson/`, session behavior in `src/session/`, and browser/device implementations in `src/media/`.

**`packages/server/`:** Server-side modular monolith. Place pure rules in `src/domain/`, use cases in `src/modules/`, persistence in `src/db/`, provider contracts in `src/ports/`, adapters in `src/providers/`, and policy versions in `src/policies/`. Drizzle migrations belong in `packages/server/drizzle/`.

**`tests/`:** Cross-package verification. PostgreSQL/fake-provider tests are in `tests/integration/`; browser flows are in `tests/e2e/`; reusable synthetic worlds are in `tests/fixtures/`.

**`integrations/umiem-mcp/`:** Consumer-side Python validator, generated schema, manifest and Hermes skill. The server remains in `apps/web/src/app/api/mcp/`.

## Key File Locations

**Entry Points:**
- `apps/web/src/app/layout.tsx`: web shell, locale and metadata.
- `apps/web/src/app/(kid)/page.tsx`: default child host page.
- `apps/web/src/app/parent/page.tsx`: parent application entry.
- `apps/worker/src/main.ts`: worker process entry.
- `packages/server/src/index.ts`: server package exports.
- `packages/contracts/src/index.ts`: contract exports.
- `packages/kid-ui/src/index.ts`: portable UI exports.

**Configuration:**
- `package.json`: workspace scripts and root dependencies.
- `pnpm-workspace.yaml`: workspace package discovery.
- `tsconfig.base.json` and package `tsconfig.json` files: strict TypeScript compilation boundaries.
- `vitest.unit.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`: test runners.
- `deploy/compose.yaml`: web, worker, database and persistent volume topology.

**Core Logic:**
- `packages/server/src/domain/`: evaluation, scheduling, progress, speech and lesson rules.
- `packages/server/src/modules/`: profiles, decks, sessions, attempts, generation, reporting and lessons.
- `apps/web/src/parent/parent-router.ts`: explicit parent API operation table.
- `apps/web/src/kid/kid-router.ts`: explicit Kid API operation table.
- `packages/kid-ui/src/session/session-controller.ts`: client session lifecycle and exposure/attempt coordination.

**Testing:**
- `packages/server/src/domain/*.test.ts`: focused deterministic rule tests.
- `packages/contracts/src/*.test.ts` and `packages/kid-ui/src/**/*.test.ts`: package-level contract/UI tests.
- `tests/integration/*.test.ts`: database and fake-provider behavior.
- `tests/e2e/*.spec.ts`: Playwright parent and child flows.

## Naming Conventions

**Files:**
- TypeScript modules use lowercase kebab-case for utility/domain files (`session-controller.ts`, `parent-router.ts`).
- React components use PascalCase (`KidApp.tsx`, `LessonEditor.tsx`, `PictureRecallView.tsx`).
- Tests append `.test.ts`/`.test.tsx`; E2E tests use `.spec.ts`.
- Next route files are named `route.ts` and pages `page.tsx` under App Router directories.

**Directories:**
- Runtime boundaries are plural (`apps`, `packages`, `tests`).
- Server capabilities are grouped by responsibility (`domain`, `modules`, `ports`, `providers`).
- Subject-specific lesson code is nested under `domain/lessons/subjects/<subject>/`.

## Where to Add New Code

**New Feature:**
- Public request/response and validation: `packages/contracts/src/<feature>.ts`, then export through `packages/contracts/src/index.ts`.
- Server use case: `packages/server/src/modules/<feature>.ts`; pure rules go in `packages/server/src/domain/`.
- Parent/Kid HTTP exposure: add an explicit route or router branch under `apps/web/src/app/api/v1/` and `apps/web/src/parent/` or `apps/web/src/kid/`.
- UI: parent components under `apps/web/src/parent/`; child screens/exercises under `packages/kid-ui/src/`.
- Cross-process background work: add a server operation and map it in `apps/worker/src/tasks.ts`.
- Tests: package tests beside implementation; database tests in `tests/integration/`; browser acceptance in `tests/e2e/`.

**New Component/Module:**
- New subject: implement `SubjectModule` under `packages/server/src/domain/lessons/subjects/<subject>/` and register it in `packages/server/src/domain/lessons/subjects/index.ts`.
- New external service: define a port in `packages/server/src/ports/`, implement the adapter under `packages/server/src/providers/`, and wire it in `apps/web/src/composition.ts`/`apps/worker/src/composition.ts`.
- New media behavior: use `packages/server/src/providers/media/` and `packages/kid-ui/src/media/` according to whether it is server storage or client platform behavior.

**Utilities:**
- Domain-wide pure helpers: `packages/server/src/domain/`.
- Shared API/UI constants and messages: `packages/contracts/src/`.
- Web-only HTTP helpers: `apps/web/src/http/`.

## Special Directories

**`packages/server/drizzle/`:** SQL migrations and metadata; generated/managed by Drizzle and committed as deployment inputs.

**`apps/web/public/`:** Static PWA assets and icons; committed and served by Next.js.

**`tests/fixtures/`:** Synthetic, approved fixtures only; do not place child recordings or secrets here.

**`deploy/`:** Deployment assets and operational scripts; changes affect Compose/Coolify runtime topology and migration/backup behavior.

**`integrations/umiem-mcp/skills/`:** Installed-consumer skill documentation; update it with any MCP contract change.

---

*Structure analysis: 2026-10-21*
