import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AppError,
  issueIntegrationToken,
  listIntegrationTokens,
  requireLearningReadToken,
  revokeIntegrationToken,
} from "@learning/server";
import { buildTestServices, countRows, testDatabase, testDatabaseUrl, truncateCoreTables } from "./helpers";

process.env.DATABASE_URL = testDatabaseUrl();

function secretFor(id: string): string {
  return `umiem_${id}_${randomBytes(32).toString("base64url")}`;
}

describe("read-only integration tokens", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await testDatabase().pool.query("TRUNCATE learning_app.integration_tokens CASCADE");
  });

  afterAll(async () => {
    await testDatabase().pool.end();
  });

  it("stores only the digest and verifies read scope without changing rows", async () => {
    const { services } = buildTestServices();
    const id = randomUUID();
    const secret = secretFor(id);
    await issueIntegrationToken(services, "Hermes family report", secret);

    const before = await testDatabase().pool.query(
      "SELECT id, name, token_hash, scopes, created_at, revoked_at FROM learning_app.integration_tokens",
    );
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].token_hash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(String(before.rows[0].token_hash)).not.toContain(secret);
    expect(await listIntegrationTokens(services)).toMatchObject([
      { id, name: "Hermes family report", scopes: ["learning:read"], revokedAt: null },
    ]);

    await expect(requireLearningReadToken(services.db, secret)).resolves.toEqual({
      id,
      scopes: ["learning:read"],
    });
    const after = await testDatabase().pool.query(
      "SELECT id, name, token_hash, scopes, created_at, revoked_at FROM learning_app.integration_tokens",
    );
    expect(after.rows).toEqual(before.rows);
    expect(await countRows("child_profiles")).toBe(0);
  });

  it("distinguishes invalid, revoked, and out-of-scope credentials and makes revoke idempotent", async () => {
    const { services } = buildTestServices();
    const id = randomUUID();
    const secret = secretFor(id);
    await issueIntegrationToken(services, "No scope", secret);
    await testDatabase().pool.query(
      "UPDATE learning_app.integration_tokens SET scopes = '{}'::text[] WHERE id = $1",
      [id],
    );
    await expect(requireLearningReadToken(services.db, secret)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });

    await expect(requireLearningReadToken(services.db, "not-a-token")).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    await revokeIntegrationToken(services, id);
    await revokeIntegrationToken(services, id);
    await expect(requireLearningReadToken(services.db, secret)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(await listIntegrationTokens(services)).toMatchObject([{ id, revokedAt: expect.any(Date) }]);
  });

  it("rejects a secret whose embedded public id does not match its database record", async () => {
    const { services } = buildTestServices();
    const id = randomUUID();
    const anotherId = randomUUID();
    const secret = secretFor(id);
    await issueIntegrationToken(services, "Mismatched", secret);
    const forged = secret.replace(id, anotherId);
    await expect(requireLearningReadToken(services.db, forged)).rejects.toBeInstanceOf(AppError);
  });
});
