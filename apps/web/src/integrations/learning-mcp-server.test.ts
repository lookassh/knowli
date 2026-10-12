import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { LearningOverviewDtoSchema, LearningOverviewQuerySchema } from "@learning/contracts";
import { createLearningMcpServer, MAX_OVERVIEW_BYTES } from "./learning-mcp-server";

const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function fixture() {
  const raw = await readFile(resolve(process.cwd(), "integrations/umiem-mcp/tests/fixtures/learning-overview.example.json"), "utf8");
  return LearningOverviewDtoSchema.parse(JSON.parse(raw));
}

async function connected(readOverview: (query: ReturnType<typeof LearningOverviewQuerySchema.parse>) => Promise<unknown>) {
  const server = createLearningMcpServer(readOverview, requestId);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe("learning MCP tool", () => {
  it("exposes one read-only tool backed by the shared query and DTO contracts", async () => {
    const overview = await fixture();
    const readOverview = vi.fn(async () => overview);
    const { server, client } = await connected(readOverview);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map(({ name }) => name)).toEqual(["umiem_get_learning_overview"]);
      expect(tools.tools[0]).toMatchObject({ annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } });
      expect(tools.tools[0]?.outputSchema).toBeDefined();
      const result = await client.callTool({ name: "umiem_get_learning_overview", arguments: {} });
      expect(readOverview).toHaveBeenCalledWith({ days: 7, upcomingTestDays: 14 });
      expect(LearningOverviewDtoSchema.parse(result.structuredContent)).toEqual(overview);
      expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual(overview);
      expect(overview.children[0]?.learningTime.seconds).toBe(1980);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("validates argument boundaries and never reads for malformed or unknown calls", async () => {
    const overview = await fixture();
    const readOverview = vi.fn(async () => overview);
    const { server, client } = await connected(readOverview);
    try {
      for (const args of [{ days: 0 }, { days: 32 }, { upcomingTestDays: 91 }, { days: "7" }, { childId: null }, { extra: true }]) {
        const result = await client.callTool({ name: "umiem_get_learning_overview", arguments: args });
        expect(result.isError).toBe(true);
      }
      const unknown = await client.callTool({ name: "other", arguments: {} });
      expect(unknown.isError).toBe(true);
      expect(readOverview).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("bounds the encoded DTO and maps dependency failures to safe errors", async () => {
    const overview = await fixture();
    const huge = structuredClone(overview);
    huge.children[0]!.childName = "\"".repeat(MAX_OVERVIEW_BYTES);
    const readOverview = vi.fn(async () => huge);
    const { server, client } = await connected(readOverview);
    try {
      const large = await client.callTool({ name: "umiem_get_learning_overview", arguments: {} });
      expect(large.isError).toBe(true);
      expect(JSON.stringify(large)).not.toContain("\\\"\\\"");
    } finally {
      await client.close();
      await server.close();
    }

    const failed = await connected(async () => { throw new Error("private token and SQL must not escape"); });
    try {
      const result = await failed.client.callTool({ name: "umiem_get_learning_overview", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private token");
      expect(JSON.stringify(result)).toContain(requestId);
    } finally {
      await failed.client.close();
      await failed.server.close();
    }
  });
});
