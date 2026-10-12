import { randomUUID } from "node:crypto";
import { AppError, requireLearningReadToken, getLearningOverview, type IntegrationPrincipal, type Services } from "@learning/server";
import { LearningOverviewQuerySchema, messages, type LearningOverviewQuery } from "@learning/contracts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createLearningMcpServer } from "./learning-mcp-server";
import { IntegrationReadLimiter, learningOverviewLimiter } from "./integration-read-limiter";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MCP_VERSION = "2025-11-25";

export type LearningMcpDependencies = {
  authenticate(rawToken: string): Promise<IntegrationPrincipal>;
  readOverview(query: LearningOverviewQuery, rawToken: string): Promise<unknown>;
  limiter: IntegrationReadLimiter;
  allowedOrigins: ReadonlySet<string>;
  now(): number;
  requestId(): string;
};

function headers(requestId: string, extra?: HeadersInit): Headers {
  const result = new Headers(extra);
  result.set("cache-control", "no-store, max-age=0");
  result.set("x-request-id", requestId);
  return result;
}

function rpcFailure(requestId: string, code: string, status: number, message: string, extra?: HeadersInit): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status, headers: headers(requestId, { "content-type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(extra)) }),
  });
}

function appErrorResponse(error: unknown, requestId: string, deps: LearningMcpDependencies, principal?: IntegrationPrincipal): Response {
  if (error instanceof AppError && error.code === "rate_limited" && principal) {
    return rpcFailure(requestId, "-32029", 429, "Rate limit exceeded.", { "retry-after": String(deps.limiter.retryAfterSeconds(principal, deps.now())) });
  }
  if (error instanceof AppError && error.code === "unauthorized") {
    return rpcFailure(requestId, "-32001", 401, "Bearer authentication required.", { "www-authenticate": "Bearer" });
  }
  if (error instanceof AppError && error.code === "forbidden") return rpcFailure(requestId, "-32003", 403, "Forbidden.");
  const pgCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (pgCode.startsWith("08") || pgCode.startsWith("53") || pgCode.startsWith("57") || pgCode === "ECONNRESET" || pgCode === "ECONNREFUSED") {
    return rpcFailure(requestId, "-32003", 503, "Learning overview is temporarily unavailable.");
  }
  const catalogue = messages.errors as Record<string, string | undefined>;
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "internal";
  return rpcFailure(requestId, "-32603", status, catalogue[code] ?? catalogue.internal!);
}

function validOrigin(value: string): boolean {
  if (value === "null") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch { return false; }
}

async function readBoundedBody(request: Request): Promise<{ bytes: Uint8Array } | { tooLarge: true }> {
  if (!request.body) return { bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes };
}

export async function handleLearningMcpRequest(request: Request, deps: LearningMcpDependencies): Promise<Response> {
  const requestId = deps.requestId();
  const origin = request.headers.get("origin");
  if (origin !== null && (!validOrigin(origin) || !deps.allowedOrigins.has(origin))) return rpcFailure(requestId, "-32003", 403, "Origin is not allowed.");

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) return rpcFailure(requestId, "-32001", 401, "Bearer authentication required.", { "www-authenticate": "Bearer" });

  let principal: IntegrationPrincipal;
  try {
    principal = await deps.authenticate(match[1]!);
    deps.limiter.consume(principal, deps.now());
  } catch (error) { return appErrorResponse(error, requestId, deps, principal!); }

  if (request.method !== "POST") return new Response(null, { status: 405, headers: headers(requestId, { allow: "POST" }) });
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const accept = request.headers.get("accept") ?? "";
  if (contentType !== "application/json" || !accept.split(",").some((value) => value.trim().startsWith("application/json")) || !accept.split(",").some((value) => value.trim().startsWith("text/event-stream"))) {
    return rpcFailure(requestId, "-32600", 400, "Invalid MCP HTTP headers.");
  }

  let body: unknown;
  const bounded = await readBoundedBody(request);
  if ("tooLarge" in bounded) return rpcFailure(requestId, "-32600", 413, "Request body is too large.");
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes)); }
  catch { return rpcFailure(requestId, "-32700", 400, "Parse error."); }
  if (Array.isArray(body)) return rpcFailure(requestId, "-32600", 400, "JSON-RPC batches are not supported.");

  const rpcMethod = typeof body === "object" && body !== null && "method" in body ? (body as { method?: unknown }).method : undefined;
  if (rpcMethod !== "initialize") {
    const protocolVersion = request.headers.get("mcp-protocol-version");
    if (protocolVersion && !["2025-11-25", "2025-06-18", "2025-03-26"].includes(protocolVersion)) {
      return rpcFailure(requestId, "-32600", 400, "Unsupported MCP protocol version.");
    }
  }

  const server = createLearningMcpServer((query) => deps.readOverview(LearningOverviewQuerySchema.parse(query), match[1]!), requestId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_REQUEST_BYTES });
  try {
    await server.connect(transport);
    const bodyBuffer = bounded.bytes.buffer.slice(bounded.bytes.byteOffset, bounded.bytes.byteOffset + bounded.bytes.byteLength) as ArrayBuffer;
    const sdkRequest = new Request(request.url, { method: "POST", headers: request.headers, body: bodyBuffer });
    const response = await transport.handleRequest(sdkRequest, { parsedBody: body });
    const responseBody = new Uint8Array(await response.arrayBuffer());
    let output = responseBody;
    if (output.byteLength > MAX_RESPONSE_BYTES) {
      const parsed = JSON.parse(new TextDecoder().decode(output)) as { id?: string | number | null };
      output = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "learning_summary_too_large", message: "The learning overview is too large to return.", retryable: false, requestId }) }] } }));
    }
    const outHeaders = headers(requestId, response.headers);
    outHeaders.delete("mcp-session-id");
    return new Response(output, { status: response.status, headers: outHeaders });
  } catch {
    return rpcFailure(requestId, "-32603", 500, "MCP request failed.");
  } finally {
    await Promise.allSettled([server.close(), transport.close()]);
  }
}

export function createLearningMcpDependencies(services: Services, allowedOrigins: ReadonlySet<string>): LearningMcpDependencies {
  return {
    authenticate: (rawToken) => requireLearningReadToken(services.db, rawToken),
    readOverview: (query, rawToken) => getLearningOverview(services, query, rawToken),
    limiter: learningOverviewLimiter,
    allowedOrigins,
    now: () => services.clock.now().getTime(),
    requestId: randomUUID,
  };
}

export function readMcpAllowedOrigins(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env.UMIEM_MCP_ALLOWED_ORIGINS ?? "";
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.some((origin) => origin === "*" || !validOrigin(origin) || !origin.startsWith("https://"))) throw new Error("UMIEM_MCP_ALLOWED_ORIGINS must contain exact HTTPS origins.");
  return new Set(origins);
}
