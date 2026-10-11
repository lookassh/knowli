import asyncio
import os

from mcp.server.stdio import stdio_server

from .client import OverviewClient
from .config import load_config
from .server import create_server


async def _run() -> None:
    allow_loopback_http = os.environ.get("UMIEM_ALLOW_LOOPBACK_HTTP_FOR_TESTS") == "1"
    config = load_config(os.environ, test_mode=allow_loopback_http)
    app = create_server(OverviewClient(base_url=config.base_url, token_reader=config.read_token))
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
