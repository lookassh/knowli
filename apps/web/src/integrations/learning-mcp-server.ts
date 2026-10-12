import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LearningOverviewDtoSchema, LearningOverviewQuerySchema, type LearningOverviewQuery } from "@learning/contracts";

export const MAX_OVERVIEW_BYTES = 2 * 1024 * 1024;
export const LEARNING_MCP_TOOL = "umiem_get_learning_overview";

type OverviewReader = (query: LearningOverviewQuery) => Promise<unknown>;

function toolError(code: string, message: string, retryable: boolean, requestId: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ code, message, retryable, requestId }) }],
  };
}

export function createLearningMcpServer(readOverview: OverviewReader, requestId: string): McpServer {
  const server = new McpServer({ name: "umiem-learning", version: "0.2.0" });
  server.registerTool(LEARNING_MCP_TOOL, {
    description: "Read recent learning activity by day, current progress, estimated learning time, and planned Umiem! tests for the family.",
    inputSchema: LearningOverviewQuerySchema,
    outputSchema: LearningOverviewDtoSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const parsedQuery = LearningOverviewQuerySchema.safeParse(input);
    if (!parsedQuery.success) return toolError("validation", "The tool arguments are invalid.", false, requestId);

    let overview: ReturnType<typeof LearningOverviewDtoSchema.parse>;
    try {
      overview = LearningOverviewDtoSchema.parse(await readOverview(parsedQuery.data));
    } catch {
      return toolError("learning_summary_unavailable", "The learning overview is temporarily unavailable.", true, requestId);
    }

    const encoded = JSON.stringify(overview);
    if (Buffer.byteLength(encoded, "utf8") > MAX_OVERVIEW_BYTES) {
      return toolError("learning_summary_too_large", "The learning overview is too large to return.", false, requestId);
    }
    return { structuredContent: overview, content: [{ type: "text" as const, text: encoded }] };
  });
  return server;
}
