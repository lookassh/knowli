import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).parent


class Handler(BaseHTTPRequestHandler):
    calls = []
    payload = {}

    def do_GET(self):
        self.__class__.calls.append(self.path)
        data = json.dumps(self.__class__.payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, _format, *_args):
        return


class StdioSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_initialize_list_and_read_tool_uses_http_once_and_keeps_stdout_protocol_only(self):
        asyncio.get_running_loop().slow_callback_duration = 1.0
        Handler.calls = []
        Handler.payload = json.loads((ROOT / "fixtures/learning-overview.example.json").read_text(encoding="utf-8"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        with tempfile.TemporaryDirectory() as temp:
            token_file = Path(temp) / "token"
            token_file.write_text("synthetic-token", encoding="utf-8")
            if os.name != "nt":
                token_file.chmod(0o600)
            env = os.environ.copy()
            env.update({
                "UMIEM_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                "UMIEM_READ_TOKEN_FILE": str(token_file),
                "UMIEM_ALLOW_LOOPBACK_HTTP_FOR_TESTS": "1",
            })
            params = StdioServerParameters(command=sys.executable, args=["-m", "umiem_mcp"], env=env)
            try:
                async with stdio_client(params) as (read_stream, write_stream):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = await session.list_tools()
                        self.assertEqual([tool.name for tool in tools.tools], ["umiem_get_learning_overview"])
                        self.assertTrue(tools.tools[0].annotations.readOnlyHint)
                        result = await session.call_tool("umiem_get_learning_overview", {"days": 3, "upcomingTestDays": 14})
                        self.assertFalse(result.isError)
                        self.assertEqual(result.structuredContent["children"][0]["learningTime"]["seconds"], 1980)
                        self.assertEqual(len(result.content), 1)
                        self.assertEqual(json.loads(result.content[0].text), result.structuredContent)
                        self.assertEqual(len(Handler.calls), 1)
                        denied = await session.call_tool("umiem_get_learning_overview", {"days": 0})
                        self.assertTrue(denied.isError)
                        self.assertEqual(len(Handler.calls), 1)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
