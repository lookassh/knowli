import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AppError } from "../../errors";
import type { Services } from "../../config";
import type { Executor } from "../../db/client";
import { integrationTokens } from "../../db/schema";

const TOKEN_PATTERN = /^umiem_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/i;
/** Zakresy tokenów integracji; token ma dokładnie jeden (CHECK `integration_tokens_single_scope`). */
export const INTEGRATION_SCOPES = ["learning:read", "lessons:write", "materials:write", "materials:publish"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
/** Zakres tokenu pisania lekcji (narzędzia MCP `lesson_*`). */
export const LESSONS_WRITE_SCOPE: IntegrationScope = "lessons:write";
/** Redagowanie materiałów: narzędzia lekcji oraz zestawy słówek, źródła i nagrania; bez publikacji i archiwizacji. */
export const MATERIALS_WRITE_SCOPE: IntegrationScope = "materials:write";
/** Publikacja i archiwizacja materiałów: osobny token, bez narzędzi redagowania. */
export const MATERIALS_PUBLISH_SCOPE: IntegrationScope = "materials:publish";

/** `scopes` ma zawsze dokładnie jeden znany zakres (sprawdza `authenticateIntegrationToken`). */
export type IntegrationPrincipal = { id: string; scopes: readonly IntegrationScope[] };
export type IntegrationTokenMetadata = {
  id: string;
  name: string;
  scopes: readonly string[];
  createdAt: Date;
  revokedAt: Date | null;
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function tokenId(rawToken: string): string {
  const match = TOKEN_PATTERN.exec(rawToken);
  if (!match) throw new AppError("unauthorized");
  return match[1]!.toLowerCase();
}

export function isIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}

/**
 * Token integracji z bazy: zły lub odwołany → `unauthorized`, token bez dokładnie jednego znanego
 * zakresu → `forbidden`. Wołane na granicy HTTP i ponownie w transakcji przypadku użycia.
 */
export async function authenticateIntegrationToken(
  exec: Executor,
  rawToken: string,
): Promise<IntegrationPrincipal> {
  if (typeof rawToken !== "string" || rawToken.length > 200) throw new AppError("unauthorized");
  const id = tokenId(rawToken);
  const [record] = await exec
    .select({ id: integrationTokens.id, tokenHash: integrationTokens.tokenHash, scopes: integrationTokens.scopes, revokedAt: integrationTokens.revokedAt })
    .from(integrationTokens)
    .where(eq(integrationTokens.id, id))
    .limit(1);
  if (!record || record.revokedAt) throw new AppError("unauthorized");

  const stored = Buffer.from(record.tokenHash, "hex");
  const provided = digest(rawToken);
  if (stored.length !== provided.length || !timingSafeEqual(stored, provided)) {
    throw new AppError("unauthorized");
  }
  const [scope, ...rest] = record.scopes;
  if (scope === undefined || rest.length > 0 || !isIntegrationScope(scope)) throw new AppError("forbidden");
  return { id: record.id, scopes: [scope] };
}

/** Token z wymaganym zakresem (jednym z podanych); inny zakres → `forbidden`. */
export async function requireIntegrationScope(
  exec: Executor,
  rawToken: string,
  scope: IntegrationScope | readonly IntegrationScope[],
): Promise<IntegrationPrincipal> {
  const principal = await authenticateIntegrationToken(exec, rawToken);
  if (!(typeof scope === "string" ? [scope] : scope).includes(principal.scopes[0]!)) throw new AppError("forbidden");
  return principal;
}

export function requireLearningReadToken(exec: Executor, rawToken: string): Promise<IntegrationPrincipal> {
  return requireIntegrationScope(exec, rawToken, "learning:read");
}

function validateName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) throw new AppError("validation");
  return normalized;
}

export async function issueIntegrationToken(
  services: Services,
  name: string,
  secret: string,
  scope: IntegrationScope = "learning:read",
): Promise<{ id: string }> {
  if (!isIntegrationScope(scope)) throw new AppError("validation");
  const id = tokenId(secret);
  await services.db.insert(integrationTokens).values({
    id,
    name: validateName(name),
    tokenHash: digest(secret).toString("hex"),
    scopes: [scope],
    createdAt: services.clock.now(),
  });
  return { id };
}

export async function listIntegrationTokens(
  services: Services,
): Promise<readonly IntegrationTokenMetadata[]> {
  const rows = await services.db
    .select({
      id: integrationTokens.id,
      name: integrationTokens.name,
      scopes: integrationTokens.scopes,
      createdAt: integrationTokens.createdAt,
      revokedAt: integrationTokens.revokedAt,
    })
    .from(integrationTokens)
    .orderBy(desc(integrationTokens.createdAt), integrationTokens.id);
  return rows;
}

export async function revokeIntegrationToken(services: Services, id: string): Promise<void> {
  await services.db
    .update(integrationTokens)
    .set({ revokedAt: services.clock.now() })
    .where(and(eq(integrationTokens.id, id), isNull(integrationTokens.revokedAt)));
}
