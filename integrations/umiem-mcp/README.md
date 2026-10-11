# Umiem! MCP

Read-only MCP stdio adapter for the versioned Umiem! learning overview API. It exposes one tool, `umiem_get_learning_overview`; it has no database connection, write operation, arbitrary URL argument, or fallback that turns an API error into an empty report.

## Local development

Requires Python 3.11+ and uv. From this folder:

```text
uv sync --locked
uv run --locked python -m unittest discover -s tests -p 'test_*.py'
```

From the Knowli root, `npx --yes pnpm@10.34.6 test:mcp` performs the locked sync and runs both unit and stdio tests.

## Operator configuration

Set `UMIEM_BASE_URL` to the HTTPS origin of the private Umiem! deployment and `UMIEM_READ_TOKEN_FILE` to an absolute path readable only by the Hermes service user. Keep the integration token out of environment values, tool arguments, config repositories, and prompts. The file is read for each tool call so a token rotation takes effect without restarting MCP. The adapter rejects redirects and verifies TLS. Plain HTTP is accepted only for loopback in a test process when `UMIEM_ALLOW_LOOPBACK_HTTP_FOR_TESTS=1`.

Example process configuration (replace paths and hostname with operator values):

```json
{
  "command": "/opt/hermes/umiem-mcp/.venv/bin/python",
  "args": ["-m", "umiem_mcp"],
  "env": {
    "UMIEM_BASE_URL": "https://private-umiem.example",
    "UMIEM_READ_TOKEN_FILE": "/etc/hermes/credentials/umiem-read-token"
  }
}
```

The client calls only `/api/v1/integrations/learning-overview`. Defaults are 7 recent local days and a 14-day inclusive lookahead for tests. HTTP attempts are limited to 10 seconds each, one retry at most, 25 seconds total, and 2 MiB of response data. It respects `Retry-After` only when the wait fits the total budget. API errors, timeout, invalid JSON, missing schema, and incompatible contract are MCP errors, not empty activity.

## Contract and skill release

`src/umiem_mcp/learning-overview.schema.json` is copied from `docs/integrations/learning-overview.schema.json` by the API contract export workflow. `contract-manifest.json` records the API contract revision and SHA-256 digests of the schema and consumer skill. Startup validation refuses a missing or mismatched bundle. `skills/umiem-learning/SKILL.md` is shipped with the same source release as this code and lockfile; Hermes should install a versioned release, not a moving worktree. See [`../../docs/integrations/hermes-learning.md`](../../docs/integrations/hermes-learning.md) for data semantics and operational boundaries.

Release smoke:

```text
uv sync --locked
uv run --locked python -m unittest discover -s tests -p 'test_*.py'
uv run --locked python -c "from pathlib import Path; from umiem_mcp.validation import verify_contract_bundle; assert verify_contract_bundle(Path('.'))"
```

To assemble a source-only versioned archive after committing the release inputs, run `uv run --locked python package_release.py --output-dir /absolute/output/path`. It excludes virtual environments and caches, and records the source commit plus API contract commit in `RELEASE-MANIFEST.json`.
