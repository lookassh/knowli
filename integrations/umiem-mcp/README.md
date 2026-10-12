# Umiem! consumer contract and Hermes skill

The MCP server is part of the existing `apps/web` process at `POST /api/mcp`. This Python package contains only the semantic DTO validator, versioned JSON Schema, contract manifest, and reusable Hermes skill. It does not run an MCP server or call the REST API.

## Tests

Requires Python 3.11+ and uv. From this folder:

```text
uv sync --locked --group hermes-test
uv run --locked --group hermes-test python -m unittest discover -s tests -p 'test_*.py'
```

From the Knowli root, `npx --yes pnpm@10.34.6 test:mcp` runs these checks. API contract changes must update `packages/contracts`, regenerate the schema with `contracts:export-learning-overview`, update the manifest and skill, and verify the consumer bundle.

## Hermes configuration

Configure Umiem! as an ordinary remote MCP server. Keep the bearer value in the protected environment of both Hermes and any family report process; the YAML stores only an environment reference:

```yaml
mcp_servers:
  umiem:
    url: "https://umiem.example/api/mcp"
    headers:
      Authorization: "Bearer ${UMIEM_READ_TOKEN}"
    timeout: 30
    connect_timeout: 10
```

The token uses the existing `learning:read` scope. Use HTTPS through the private family access gateway. The MCP endpoint accepts no cookie substitute, has no browser CORS mode, and shares a process-local limit of 60 authenticated requests per token per minute with the REST integration. Native Hermes needs the URL and header; the separate report process also needs the `UMIEM_READ_TOKEN` environment value to make its MCP call.

The tool returns recent local calendar days, current progress per child and skill, planned tests recorded in Umiem!, and estimated learning time. Its defaults are 7 days and a 14-day inclusive lookahead. See [`../../docs/integrations/hermes-learning.md`](../../docs/integrations/hermes-learning.md) for interpretation and private deployment boundaries.

## Consumer release

After committing clean release inputs, create a source-only archive:

```text
uv run --locked python -m umiem_mcp.package_consumer --output-dir /private/output/directory
```

The archive contains only the validator, schema, manifest, skill, and `RELEASE-MANIFEST.json` with the full source commit and SHA-256 hashes. It excludes MCP/HTTP clients, server entrypoints, virtual environments, token files, `.env` and private learning data. The archive is installed by the Hermes profile installer; it does not create a local MCP process.
