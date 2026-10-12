import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LearningOverviewDtoSchema } from "@learning/contracts";
import { createDatabase, createServices, issueIntegrationToken } from "@learning/server";
import { readTestRunConfig } from "../test-run-config";

test("standard MCP client reads the same overview from the real Next.js route", async ({ request }, testInfo) => {
  const world = JSON.parse(await (await import("node:fs/promises")).readFile(
    readTestRunConfig(process.env).worldFile, "utf8",
  )) as { databaseUrl: string };
  const { db, pool } = createDatabase(world.databaseUrl);
  const services = createServices({ db, clock: { now: () => new Date("2026-10-11T17:00:00Z") } });
  const token = `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
  try {
    await issueIntegrationToken(services, "MCP E2E", token);
    const baseUrl = String(testInfo.project.use.baseURL);
    const rest = await request.get(`${baseUrl}/api/v1/integrations/learning-overview?days=3&upcomingTestDays=14`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(rest.status()).toBe(200);
    const expected = LearningOverviewDtoSchema.parse(await rest.json());

    const client = new Client({ name: "e2e-standard-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(["umiem_get_learning_overview"]);
      const result = await client.callTool({ name: "umiem_get_learning_overview", arguments: { days: 3, upcomingTestDays: 14 } });
      expect(result.isError).toBeFalsy();
      const actual = LearningOverviewDtoSchema.parse(result.structuredContent);
      const { generatedAt: _expectedGeneratedAt, ...expectedData } = expected;
      const { generatedAt: _actualGeneratedAt, ...actualData } = actual;
      expect(actualData).toEqual(expectedData);
      expect(JSON.parse((result.content as { type: "text"; text: string }[])[0]!.text)).toEqual(actual);
      expect(rest.headers()["cache-control"]).toContain("no-store");
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  } finally {
    await pool.end();
  }
});
