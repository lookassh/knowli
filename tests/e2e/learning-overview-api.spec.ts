import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LearningOverviewDtoSchema } from "@learning/contracts";
import { createDatabase, createServices, issueIntegrationToken, revokeIntegrationToken } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";

test("integration token reads overview only, has no-store and cannot enter Parent API", async ({ request }) => {
  const world = JSON.parse(await (await import("node:fs/promises")).readFile(
    readTestRunConfig(process.env).worldFile, "utf8",
  )) as { databaseUrl: string };
  const { db, pool } = createDatabase(world.databaseUrl);
  const services = createServices({ db, clock: { now: () => new Date("2026-10-11T17:00:00Z") } });
  const token = `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
  try {
    await issueIntegrationToken(services, "e2e overview", token);
    const response = await request.get("/api/v1/integrations/learning-overview?days=2", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const overview = LearningOverviewDtoSchema.parse(await response.json());
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(new Date());
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const from = yesterday.toISOString().slice(0, 10);
    expect(overview).toMatchObject({
      schemaVersion: 1,
      period: { from, to: today, days: 2 },
    });
    expect(Array.isArray(overview.children)).toBe(true);

    const parentOnly = await request.get("/api/v1/parent/children", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(parentOnly.status()).toBe(401);
    await revokeIntegrationToken(services, token.split("_")[1]!);
    expect((await request.get("/api/v1/integrations/learning-overview", {
      headers: { authorization: `Bearer ${token}` },
    })).status()).toBe(401);
  } finally {
    await pool.end();
  }
});
