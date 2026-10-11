import json
from typing import Any

from mcp.server import Server
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations

from .client import AdapterError, OverviewClient


TOOL_NAME = "umiem_get_learning_overview"
TOOL_DESCRIPTION = "Read recent learning activity, current progress, estimated learning time, and planned Umiem! tests for the family."


def _failure(error: AdapterError) -> CallToolResult:
    payload = {"code": error.code, "message": str(error), "retryable": error.retryable}
    return CallToolResult(content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))], isError=True)


def create_server(client: OverviewClient) -> Server:
    server = Server("umiem-learning", version="0.1.0")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [Tool(
            name=TOOL_NAME,
            description=TOOL_DESCRIPTION,
            inputSchema={
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "minimum": 1, "maximum": 31, "default": 7, "description": "Number of recent local calendar days."},
                    "upcomingTestDays": {"type": "integer", "minimum": 1, "maximum": 90, "default": 14, "description": "Inclusive number of local days to look ahead for Umiem! tests."},
                    "childId": {"type": "string", "format": "uuid", "description": "Optional child UUID from the family overview."},
                },
                "additionalProperties": False,
            },
            annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=True),
        )]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any] | None) -> CallToolResult:
        if name != TOOL_NAME:
            return _failure(AdapterError("unknown_tool", "This tool is not available"))
        args = arguments or {}
        if not isinstance(args, dict) or set(args) - {"days", "upcomingTestDays", "childId"}:
            return _failure(AdapterError("invalid_arguments", "The tool arguments are invalid"))
        if "childId" in args and args["childId"] is None:
            return _failure(AdapterError("invalid_arguments", "The tool arguments are invalid"))
        try:
            result = await client.get_overview(
                days=args.get("days", 7),
                upcoming_test_days=args.get("upcomingTestDays", 14),
                child_id=args.get("childId"),
            )
        except AdapterError as error:
            return _failure(error)
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        return CallToolResult(
            content=[TextContent(type="text", text=encoded)],
            structuredContent=result,
            isError=False,
        )

    return server
