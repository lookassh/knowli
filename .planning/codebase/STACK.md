---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# Technology Stack

**Analysis Date:** 2026-10-21

## Languages

**Primary:**
- TypeScript 5.8 - web app, worker, contracts, server domain and adapters (`apps/`, `packages/`)
- SQL - PostgreSQL schema and reviewed Drizzle migrations (`packages/server/drizzle/`)

**Secondary:**
- Python 3.11+ - packaged Umiem MCP contract validator (`integrations/umiem-mcp/`)
- CSS - parent and kid UI styles (`apps/web/src/parent/`, `packages/kid-ui/src/`)

## Runtime

**Environment:**
- Node.js 22.23.3 Alpine in production (`deploy/Dockerfile`)
- Python >=3.11 for the MCP consumer (`integrations/umiem-mcp/pyproject.toml`)

**Package Manager:**
- pnpm 10.34.6 (`package.json`, `pnpm-lock.yaml`)
- Lockfile: present
- uv lockfile present for Python (`integrations/umiem-mcp/uv.lock`)

## Frameworks

**Core:**
- Next.js 15.3, React 19.1, TypeScript strict - App Router web host (`apps/web/package.json`)
- Drizzle ORM 0.45 and Drizzle Kit 0.31 - PostgreSQL access and migrations (`packages/server/package.json`)
- Zod 4 - runtime validation and public contracts (`packages/contracts/`, `packages/server/`)

**Testing:**
- Vitest 4.1 - unit and PostgreSQL integration suites (`vitest.*.config.ts`)
- Playwright 1.63 - browser E2E with fake media/providers (`playwright.config.ts`)
- Python unittest and jsonschema - MCP contract tests (`integrations/umiem-mcp/`)

**Build/Dev:**
- pnpm workspaces - monorepo package boundaries (`pnpm-workspace.yaml`)
- Docker Compose and multi-stage Dockerfile - PostgreSQL, web, worker and migration deployment (`deploy/compose.yaml`, `deploy/Dockerfile`)
- Graphile Worker - durable PostgreSQL-backed background jobs (server dependencies and `docs/architecture.md`)

## Key Dependencies

**Critical:**
- `pg` 8.16 - PostgreSQL driver (`apps/web/package.json`, `packages/server/package.json`)
- `@modelcontextprotocol/sdk` 1.32.1 - Streamable HTTP MCP server (`package.json`, `apps/web/`)
- `sharp` 0.35.5 - image processing (`packages/server/package.json`)
- `tsx` 4.19.2 - worker TypeScript runtime (`apps/worker/package.json`)

**Infrastructure:**
- PostgreSQL 17.11 Alpine - primary database and job queue (`deploy/compose.yaml`)
- Local persistent media store - audio and images under `MEDIA_ROOT` (`packages/server/src/providers/media/local.ts`)

## Configuration

**Environment:**
- `DATABASE_URL` is required by web, worker and migrations; `MEDIA_ROOT` selects shared media storage (`.env.example`)
- Provider configuration uses server-side `OPENAI_*`, `AZURE_SPEECH_*`, `UMIEM_*` variables; secrets are never exposed as `NEXT_PUBLIC_*` (`.env.example`)
- `.env` exists in the repository root as environment configuration; its contents are not part of this analysis.

**Build:**
- `apps/web/next.config.ts`, root `tsconfig*.json`, package `tsconfig.json` files
- `vitest.unit.config.ts`, `vitest.integration.config.ts`, `playwright.config.ts`
- `deploy/Dockerfile` enables Next standalone output for the web image

## Platform Requirements

**Development:**
- Node.js/pnpm, PostgreSQL (integration tests use Docker), Python/uv for MCP tests, and Docker for compose-backed flows (`package.json`, `tests/integration/global-setup.ts`)

**Production:**
- Docker/Coolify or equivalent host running web, worker, one-shot migrations and PostgreSQL with persistent `knowli-db` and `knowli-media` volumes (`deploy/compose.yaml`)

---

*Stack analysis: 2026-10-21*
