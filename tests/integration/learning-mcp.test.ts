import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getLearningOverview, issueIntegrationToken, revokeIntegrationToken } from "@learning/server";
import { LearningOverviewDtoSchema } from "@learning/contracts";
import { learningOverviewWorld } from "../fixtures/learning-overview-world";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import { createLearningMcpDependencies, handleLearningMcpRequest } from "../../apps/web/src/integrations/learning-mcp-route";

const { pool } = testDatabase();

beforeEach(async () => {
  await truncateCoreTables();
  await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
    learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
    learning_app.deck_versions, learning_app.decks cascade`);
});
afterAll(() => pool.end());

describe("learning overview MCP integration", () => {
  it("returns the same validated read-only overview as REST and rechecks revoked tokens", async () => {
    const { services, clock } = buildTestServices("2026-10-11T17:00:00.000Z");
    await learningOverviewWorld(services, pool, (ms) => clock.advanceMs(ms));
    const token = `umiem_${randomUUID()}_${randomBytes(32).toString("base64url")}`;
    await issueIntegrationToken(services, "MCP integration", token);
    const deps = { ...createLearningMcpDependencies(services, new Set()), requestId: () => randomUUID() };
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://integration.local/api/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (input, init) => handleLearningMcpRequest(new Request(input, init), deps),
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(["umiem_get_learning_overview"]);
      const rest = await getLearningOverview(services, { days: 3, upcomingTestDays: 14 }, token);
      const result = await client.callTool({ name: "umiem_get_learning_overview", arguments: { days: 3 } });
      expect(result.isError).toBeFalsy();
      expect(LearningOverviewDtoSchema.parse(result.structuredContent)).toEqual(rest);
      expect(rest.children.some(({ dailyActivity }) => dailyActivity.some(({ learningTime }) => learningTime.seconds === 30))).toBe(true);

      await revokeIntegrationToken(services, token.split("_")[1]!);
      await expect(client.listTools()).rejects.toThrow();
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  });
});
