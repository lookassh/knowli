---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
<!-- refreshed: 2026-10-21 -->

# Architecture

**Analysis Date:** 2026-10-21

## System Overview

```text
┌──────────────────────────────────────────────────────────────┐
│ Next.js web process (`apps/web/src/app`)                     │
│ Parent UI, Kid host, HTTP API, MCP Streamable HTTP           │
└───────────────┬───────────────────────┬──────────────────────┘
                │ composition            │ shared DTOs
                ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Server application (`packages/server/src`)                    │
│ modules/use cases → domain rules → ports/adapters             │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
                ▼                       ▼
       PostgreSQL/Drizzle       AI, speech, image, media adapters

┌──────────────────────────────────────────────────────────────┐
│ Worker (`apps/worker/src`)                                   │
│ durable generation/media passes over the same database        │
└──────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Web routes | Next App Router pages and thin API route handlers | `apps/web/src/app/` |
| Web composition | Process singleton and dependency wiring | `apps/web/src/composition.ts` |
| Parent/Kid routers | Explicit endpoint dispatch and auth boundary | `apps/web/src/parent/parent-router.ts`, `apps/web/src/kid/kid-router.ts` |
| Contracts | Public Zod schemas, DTOs and shared UI messages | `packages/contracts/src/` |
| Kid UI | Portable React learning client | `packages/kid-ui/src/` |
| Server modules | Application use cases and transactional orchestration | `packages/server/src/modules/` |
| Domain | Pure learning, grading, scheduling and lesson rules | `packages/server/src/domain/` |
| Worker | Long running generation/media and cleanup work | `apps/worker/src/` |
| MCP integration | Learning overview tools over the web process | `apps/web/src/integrations/`, `integrations/umiem-mcp/` |

## Pattern Overview

**Overall:** Modular monolith with ports and adapters, explicit HTTP dispatch, and a separate worker process sharing PostgreSQL.

**Key Characteristics:**
- `packages/server/src/domain/` receives clocks and configuration as arguments and does not read environment variables directly.
- `packages/server/src/modules/` coordinates persistence, transactions, DTO construction and provider calls.
- Provider SDKs are isolated behind `packages/server/src/ports/` and `packages/server/src/providers/`.
- `packages/contracts/src/` is the public client/server boundary; database rows and private answer keys are not DTOs.
- Lessons are subject modules registered through `packages/server/src/domain/lessons/registry.ts`, keeping the lesson engine subject-independent.

## Layers

**Presentation and transport:**
- Purpose: Render parent/Kid screens and expose API/MCP requests.
- Location: `apps/web/src/app/`, `apps/web/src/parent/`, `apps/web/src/kid/`, `apps/web/src/integrations/`
- Contains: Next pages, route handlers, explicit routers, security/error wrappers.
- Depends on: `@learning/contracts`, `@learning/server`, and `@learning/kid-ui`.
- Used by: Browser clients and the Hermes MCP client.

**Portable client:**
- Purpose: Run child learning flows independently of Next.js.
- Location: `packages/kid-ui/src/`
- Contains: `KidApp`, screens, exercise views, session controller, media adapters and layout.
- Depends on: `@learning/contracts` and injected `KidApi`/platform adapters.
- Used by: `apps/web/src/kid/KidLearningHost.tsx`; future hosts can reuse it.

**Contracts:**
- Purpose: Validate and type public requests/responses.
- Location: `packages/contracts/src/`
- Contains: Zod schemas, DTOs, limits and shared Polish messages.
- Depends on: Zod only for runtime validation.
- Used by: web, Kid UI, server and MCP contract tooling.

**Application/server:**
- Purpose: Implement authenticated use cases and persistence workflows.
- Location: `packages/server/src/modules/`
- Contains: profiles, decks, generation, sessions, attempts, lessons, reporting, speech and integrations.
- Depends on: domain, database, contracts and ports.
- Used by: web composition and worker composition.

**Domain:**
- Purpose: Keep learning decisions deterministic and testable.
- Location: `packages/server/src/domain/`, `packages/server/src/policies/`
- Contains: evaluation, scheduling, independence, progress projections, feedback, lesson engine and subject modules.
- Depends on: contracts for selected public input types; no web or provider SDKs.
- Used by: server modules and focused unit tests.

**Persistence and adapters:**
- Purpose: Store state and connect external services.
- Location: `packages/server/src/db/`, `packages/server/src/providers/`
- Contains: Drizzle schema/client, migrations, media store, OpenAI/Azure/image/fake providers.
- Depends on: PostgreSQL, Drizzle and provider SDKs.
- Used by: modules through composition and ports.

## Data Flow

### Parent Request Path

1. Next route obtains the process services singleton (`apps/web/src/app/api/v1/parent/[...path]/route.ts`, `apps/web/src/composition.ts`).
2. `withApi` handles response/error normalization and `handleParentApi` checks parent session and same-origin mutations (`apps/web/src/parent/parent-router.ts`, `apps/web/src/http/security.ts`).
3. The router parses a contract command and calls a server use case such as `packages/server/src/modules/decks.ts` or `packages/server/src/modules/lessons/lesson-api.ts`.
4. The use case applies domain rules, writes through Drizzle and returns a public DTO.

### Kid Learning Path

1. `apps/web/src/kid/KidLearningHost.tsx` mounts `packages/kid-ui/src/KidApp.tsx` with a configured API client.
2. `packages/kid-ui/src/session/useLearningSession.ts` and `session-controller.ts` request profiles/decks/session tasks through `packages/kid-ui/src/api/`.
3. `apps/web/src/app/api/v1/kid/[...path]/route.ts` delegates to `apps/web/src/kid/kid-router.ts`.
4. Server session/attempt modules reserve and close exposures before returning disclosed content, then persist attempts and projections.

### Generation and Media Path

1. Parent generation creates a durable run in `packages/server/src/modules/generation.ts` and returns an accepted response.
2. `apps/worker/src/loop.ts` calls `apps/worker/src/tasks.ts`, which claims due work and invokes server generation/media use cases.
3. Provider ports produce validated content or immutable media; `packages/server/src/providers/media/local.ts` stores blobs without clobbering existing assets.
4. Parent reads generation status and reviews/publishes a draft through the parent API.

**State Management:** PostgreSQL is authoritative for sessions, attempts, history and projections. Kid UI keeps only transient session state and local platform preferences; server session context is authoritative.

## Key Abstractions

**`Services`:** Dependency bundle assembled separately for web and worker (`packages/server/src/config.ts`, `apps/web/src/composition.ts`, `apps/worker/src/composition.ts`).

**Provider ports:** `packages/server/src/ports/ai.ts` and `packages/server/src/ports/media.ts` define LLM/TTS/STT/pronunciation/image/grader/reviewer/media boundaries; implementations live under `packages/server/src/providers/`.

**Subject module:** `packages/server/src/domain/lessons/types.ts` and `registry.ts` define the extension contract. English grammar is implemented in `packages/server/src/domain/lessons/subjects/english-grammar/`.

**Portable platform adapter:** `packages/kid-ui/src/media/platform.ts` separates recording/playback and device behavior from React views.

## Entry Points

**Web application:** `apps/web/src/app/layout.tsx` and route pages under `apps/web/src/app/`.

**HTTP API:** `apps/web/src/app/api/v1/` with catch-all parent/Kid dispatch and dedicated auth/media/health routes.

**MCP:** `apps/web/src/app/api/mcp/route.ts`, backed by `apps/web/src/integrations/learning-mcp-route.ts`.

**Worker:** `apps/worker/src/main.ts`, which starts the health server and durable work loop.

**Server package:** `packages/server/src/index.ts` exports the application composition surface and domain/use-case APIs.

## Architectural Constraints

- **Processes:** web and worker share one PostgreSQL instance; generation is durable and retryable.
- **Global state:** web services are a process singleton in `apps/web/src/composition.ts`; worker cleanup timing is module state in `apps/worker/src/tasks.ts`.
- **Client boundary:** `packages/kid-ui/src/` must not import Next.js, server modules, database code or server secrets.
- **Data privacy:** answer keys and provider credentials stay server-side; speech audio is processed transiently by the server speech path.
- **Versioning:** published content, revisions and skill versions are immutable; projections are rebuildable from history.
- **Integration contract:** MCP consumes the learning overview contract and intentionally does not expose lesson or reward details.

## Anti-Patterns

### Dynamic catch-all business logic

**What happens:** Route catch-alls can become an unbounded module or database dispatcher.
**Why it's wrong:** It bypasses explicit API contracts and makes authorization difficult to audit.
**Do this instead:** Extend the explicit tables in `apps/web/src/parent/parent-router.ts` and `apps/web/src/kid/kid-router.ts`, or split a route when it grows.

### Provider calls from domain code

**What happens:** Learning rules directly depend on OpenAI/Azure SDKs or environment variables.
**Why it's wrong:** It couples deterministic rules to infrastructure and makes tests non-repeatable.
**Do this instead:** Add a port in `packages/server/src/ports/ai.ts` and wire an adapter in `packages/server/src/providers/` through composition.

## Error Handling

**Strategy:** Server errors use typed `AppError` values; HTTP wrappers map them to the shared API error DTO and request IDs.

**Patterns:**
- `apps/web/src/http/errors.ts` parses JSON and normalizes errors around route handlers.
- `apps/web/src/http/security.ts` rejects missing sessions, invalid origins and rate-limit violations before mutations.
- Provider and worker failures are persisted/retryable where generation is durable; non-critical cleanup reports and continues (`apps/worker/src/tasks.ts`).

## Cross-Cutting Concerns

**Logging:** Process-level `console` logging is used by the worker and operational paths; secrets and child recordings are excluded.
**Validation:** Zod schemas in `packages/contracts/src/` validate public boundaries; domain and lesson validators add semantic checks.
**Authentication:** Parent session cookies and server-side authorization protect parent operations; integration tokens protect learning overview/MCP reads.

---

*Architecture analysis: 2026-10-21*
