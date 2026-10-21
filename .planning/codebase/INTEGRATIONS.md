---
last_mapped_commit: 844e7c7124737e1985905048c702eb4f19a9f26d
last_mapped_at: 2026-10-21
---
# External Integrations

**Analysis Date:** 2026-10-21

## APIs & External Services

**LLM, TTS and image generation:**
- OpenAI-compatible APIs - lesson/material generation, TTS and cover/card images
  - SDK/Client: adapter implementations in `packages/server/src/providers/openai/` and HTTP-compatible adapters in `packages/server/src/providers/openai-compatible/`
  - Auth: `OPENAI_API_KEY`; optional LLM overrides `UMIEM_LLM_API_KEY`, `UMIEM_LLM_BASE_URL`, `UMIEM_LLM_MODEL`
- Azure AI Speech - speech-to-text and pronunciation assessment
  - SDK/Client: REST adapters `packages/server/src/providers/azure/stt.ts` and `packages/server/src/providers/azure/pronunciation.ts`
  - Auth: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- Configurable OpenAI-compatible grader - open lesson answers and session activity review
  - SDK/Client: `packages/server/src/providers/openai-compatible/grader.ts`, `session-activity.ts`
  - Auth: `UMIEM_GRADER_BASE_URL`, `UMIEM_GRADER_API_KEY`, `UMIEM_GRADER_MODEL`

**MCP:**
- Hermes/Umiem consumer connects to the Streamable HTTP endpoint `/api/mcp` in `apps/web/src/app/api/mcp/route.ts`
  - Server: `@modelcontextprotocol/sdk` and `apps/web/src/integrations/learning-mcp-server.ts`
  - Consumer contract, JSON Schema and skill: `integrations/umiem-mcp/`

## Data Storage

**Databases:**
- PostgreSQL 17.11 - application data, migrations and Graphile Worker queue
  - Connection: `DATABASE_URL`
  - Client: `pg` plus Drizzle ORM (`packages/server/src/db/`, `packages/server/drizzle.config.ts`)

**File Storage:**
- Local filesystem persistent volume selected by `MEDIA_ROOT`; immutable media is served by `apps/web/src/app/api/v1/media/[id]/route.ts` and stored through `packages/server/src/providers/media/local.ts`.

**Caching:**
- Database-backed verdict cache (`lesson_verdicts`) and immutable media records; no Redis detected (`docs/architecture.md`, `packages/server/src/`).

## Authentication & Identity

**Auth Provider:**
- Custom parent sessions/PIN-password authorization and server-side child profile/session checks (`packages/server/src/modules/auth.ts`, `apps/web/src/`).
- MCP uses separately hashed/revocable integration tokens and Bearer headers; tokens do not authorize Parent/Kid APIs (`apps/web/src/integrations/`, `packages/server/src/modules/`).

## Monitoring & Observability

**Error Tracking:**
- None detected.

**Logs:**
- Application and provider diagnostics use process logs; web exposes `/api/v1/health` and worker exposes its configured health port (`apps/worker/src/main.ts`, `deploy/compose.yaml`).

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker Compose/Coolify deployment (`deploy/compose.yaml`, `docs/deploy.md`).

**CI Pipeline:**
- GitHub Actions runs typecheck, unit/integration tests, build and E2E (`.github/workflows/ci.yml`).

## Environment Configuration

**Required env vars:**
- `DATABASE_URL`, `MEDIA_ROOT`; production provider flows additionally require OpenAI and/or Azure values listed in `.env.example`.
- Compose requires `POSTGRES_PASSWORD` and optionally consumes `POSTGRES_DB`, `WEB_PORT`.
- `UMIEM_MCP_ALLOWED_ORIGINS` controls MCP origin policy; `UMIEM_FAKE_PROVIDERS=1` enables deterministic test providers.

**Secrets location:**
- Deployment environment or ignored `.env`; only variable names are documented in `.env.example` and `docs/provider-config.md`.

## Webhooks & Callbacks

**Incoming:**
- MCP Streamable HTTP requests at `/api/mcp`; REST API requests under `/api/v1/`. No third-party webhook receiver detected.

**Outgoing:**
- Server/worker make outbound HTTPS requests to OpenAI-compatible endpoints and Azure Speech; background jobs are persisted in PostgreSQL and processed by the worker (`packages/server/src/providers/`, `apps/worker/src/`).

---

*Integration audit: 2026-10-21*
