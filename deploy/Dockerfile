# syntax=docker/dockerfile:1
# Obrazy produkcyjne Knowli/Umiem! Dwa targety z jednego pliku:
#   web    — samodzielny serwer Next.js (output: standalone), bez źródeł repo
#   worker — workspace z tsx: pętla zadań tła + jednorazowe migracje
# Wersje bazowe przypięte celowo (AGENTS.md); podnieś świadomie.

ARG NODE_IMAGE=node:22.23.3-alpine3.23

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app

# Manifesty najpierw — warstwa zależności przeżywa zmiany kodu.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/package.json packages/server/
COPY packages/kid-ui/package.json packages/kid-ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
RUN pnpm --filter @learning/web build

# ── web ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ── worker (+ jednorazowe migracje) ──────────────────────────────────────────
FROM base AS worker-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/server/package.json packages/server/
COPY packages/kid-ui/package.json packages/kid-ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
# świeży wolumen mediów dziedziczy właściciela node z obrazu (docker inicjalizuje
# wolumen zawartością i uprawnieniami katalogu z obrazu)
RUN mkdir -p /data/media && chown node:node /data/media
COPY --from=worker-deps /app ./
COPY . .
USER node
CMD ["node", "apps/worker/node_modules/tsx/dist/cli.mjs", "apps/worker/src/main.ts"]
