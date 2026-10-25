import { createHash, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AppError } from "../../errors";
import type { Services } from "../../config";
import type { Executor } from "../../db/client";
import { integrationTokens } from "../../db/schema";

const TOKEN_PATTERN = /^umiem_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/i;
const LEARNING_READ_SCOPE = "learning:read";

export type IntegrationPrincipal = { id: string; scopes: readonly string[] };
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

export async function requireLearningReadToken(
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
  if (!record.scopes.includes(LEARNING_READ_SCOPE)) throw new AppError("forbidden");
  return { id: record.id, scopes: record.scopes };
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
): Promise<{ id: string }> {
  const id = tokenId(secret);
  await services.db.insert(integrationTokens).values({
    id,
    name: validateName(name),
    tokenHash: digest(secret).toString("hex"),
    scopes: [LEARNING_READ_SCOPE],
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
