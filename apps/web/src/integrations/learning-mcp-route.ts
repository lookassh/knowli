import { randomUUID } from "node:crypto";
import {
  AppError,
  appendAuthoredLesson,
  archiveMaterial,
  authenticateIntegrationToken,
  createAuthoredLesson,
  createSource,
  createVocabularyDeck,
  editVocabularyDeck,
  getAuthoredLesson,
  getLearningOverview,
  getSource,
  getVocabularyDeck,
  lessonAuthoringCatalog,
  listMaterials,
  listSources,
  omitIllustration,
  publishMaterial,
  regenerateRecording,
  replaceAuthoredLesson,
  updateSource,
  validateAuthoredLesson,
  type IntegrationPrincipal,
  type Services,
} from "@learning/server";
import { LESSON_AUTHORING_MAX_REQUEST_BYTES, LearningOverviewQuerySchema, messages, type LearningOverviewQuery } from "@learning/contracts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createLearningMcpServer, LEARNING_MCP_TOOL } from "./learning-mcp-server";
import {
  authoringToolNames,
  createLessonAuthoringMcpServer,
  LESSON_AUTHORING_TOOL_NAMES,
  LESSON_WRITE_TOOL_NAMES,
  lessonAuthoringInputError,
  type LessonAuthoringOperations,
} from "./lesson-authoring-mcp-tools";
import { IntegrationReadLimiter, learningOverviewLimiter, lessonWriteLimiter } from "./integration-read-limiter";

/** Limit ciała żądania tokenu `learning:read`; token `lessons:write` niesie całą lekcję (`LESSON_AUTHORING_MAX_REQUEST_BYTES`). */
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MCP_VERSION = "2025-11-25";

export type LearningMcpDependencies = {
  authenticate(rawToken: string): Promise<IntegrationPrincipal>;
  readOverview(query: LearningOverviewQuery, rawToken: string): Promise<unknown>;
  /** Narzędzia redagowania i publikacji materiałów dla tokenów `lessons:write`, `materials:write` i `materials:publish` (każda operacja ponownie sprawdza token). */
  lessonAuthoring(rawToken: string): LessonAuthoringOperations;
  /** Wspólny limit żądań na token (60 na minutę). */
  limiter: IntegrationReadLimiter;
  /** Zapisy materiałów na token (10 na godzinę). */
  writeLimiter: IntegrationReadLimiter;
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

function rpcFailure(requestId: string, code: number, status: number, message: string, extra?: HeadersInit): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status, headers: headers(requestId, { "content-type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(extra)) }),
  });
}

function appErrorResponse(error: unknown, requestId: string, deps: LearningMcpDependencies, principal?: IntegrationPrincipal): Response {
  if (error instanceof AppError && error.code === "rate_limited" && principal) {
    return rpcFailure(requestId, -32029, 429, "Rate limit exceeded.", { "retry-after": String(deps.limiter.retryAfterSeconds(principal, deps.now())) });
  }
  if (error instanceof AppError && error.code === "unauthorized") {
    return rpcFailure(requestId, -32001, 401, "Bearer authentication required.", { "www-authenticate": "Bearer" });
  }
  if (error instanceof AppError && error.code === "forbidden") return rpcFailure(requestId, -32003, 403, "Forbidden.");
  const pgCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (pgCode.startsWith("08") || pgCode.startsWith("53") || pgCode.startsWith("57") || pgCode === "ECONNRESET" || pgCode === "ECONNREFUSED") {
    return rpcFailure(requestId, -32003, 503, "The service is temporarily unavailable.");
  }
  const catalogue = messages.errors as Record<string, string | undefined>;
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "internal";
  return rpcFailure(requestId, -32603, status, catalogue[code] ?? catalogue.internal!);
}

function validOrigin(value: string): boolean {
  if (value === "null") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
  } catch { return false; }
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<{ bytes: Uint8Array } | { tooLarge: true }> {
  if (!request.body) return { bytes: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
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
  if (origin !== null && (!validOrigin(origin) || !deps.allowedOrigins.has(origin))) return rpcFailure(requestId, -32003, 403, "Origin is not allowed.");

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) return rpcFailure(requestId, -32001, 401, "Bearer authentication required.", { "www-authenticate": "Bearer" });

  let principal: IntegrationPrincipal;
  try {
    principal = await deps.authenticate(match[1]!);
    deps.limiter.consume(principal, deps.now());
  } catch (error) { return appErrorResponse(error, requestId, deps, principal!); }

  if (request.method !== "POST") return new Response(null, { status: 405, headers: headers(requestId, { allow: "POST" }) });
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const accept = request.headers.get("accept") ?? "";
  if (contentType !== "application/json" || !accept.split(",").some((value) => value.trim().startsWith("application/json")) || !accept.split(",").some((value) => value.trim().startsWith("text/event-stream"))) {
    return rpcFailure(requestId, -32600, 400, "Invalid MCP HTTP headers.");
  }

  const scope = principal.scopes[0]!;
  const authoring = scope !== "learning:read";
  const allowedTools: ReadonlySet<string> = authoring ? authoringToolNames(scope) : new Set([LEARNING_MCP_TOOL]);
  const maxRequestBytes = authoring ? LESSON_AUTHORING_MAX_REQUEST_BYTES : MAX_REQUEST_BYTES;
  let body: unknown;
  const bounded = await readBoundedBody(request, maxRequestBytes);
  if ("tooLarge" in bounded) return rpcFailure(requestId, -32600, 413, "Request body is too large.");
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bounded.bytes)); }
  catch { return rpcFailure(requestId, -32700, 400, "Parse error."); }
  if (Array.isArray(body)) return rpcFailure(requestId, -32600, 400, "JSON-RPC batches are not supported.");

  const rpcMethod = typeof body === "object" && body !== null && "method" in body ? (body as { method?: unknown }).method : undefined;
  if (rpcMethod !== "initialize") {
    const protocolVersion = request.headers.get("mcp-protocol-version");
    if (protocolVersion && !["2025-11-25", "2025-06-18", "2025-03-26"].includes(protocolVersion)) {
      return rpcFailure(requestId, -32600, 400, "Unsupported MCP protocol version.");
    }
  }

  // Narzędzia innego zakresu nie istnieją dla tego tokenu (`tools/list`), a ich wywołanie to 403.
  const params = typeof body === "object" && body !== null && "params" in body ? (body as { params?: unknown }).params : undefined;
  const toolName = rpcMethod === "tools/call" && typeof params === "object" && params !== null && "name" in params ? (params as { name?: unknown }).name : undefined;
  if (typeof toolName === "string") {
    const known = toolName === LEARNING_MCP_TOOL || LESSON_AUTHORING_TOOL_NAMES.has(toolName);
    if (known && !allowedTools.has(toolName)) return rpcFailure(requestId, -32003, 403, "Forbidden.");
    if (authoring) {
      const args = typeof params === "object" && params !== null && "arguments" in params ? (params as { arguments?: unknown }).arguments : undefined;
      const inputError = lessonAuthoringInputError(toolName, args, requestId);
      if (inputError) {
        const id = typeof body === "object" && body !== null && "id" in body ? (body as { id?: unknown }).id : null;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: inputError }), {
          status: 200, headers: headers(requestId, { "content-type": "application/json; charset=utf-8" }),
        });
      }
    }
    if (authoring && LESSON_WRITE_TOOL_NAMES.has(toolName)) {
      try { deps.writeLimiter.assertAvailable(principal, deps.now()); }
      catch { return rpcFailure(requestId, -32029, 429, "Rate limit exceeded.", { "retry-after": String(deps.writeLimiter.retryAfterSeconds(principal, deps.now())) }); }
    }
  }

  const server = authoring
    ? createLessonAuthoringMcpServer(deps.lessonAuthoring(match[1]!), requestId, scope)
    : createLearningMcpServer((query) => deps.readOverview(LearningOverviewQuerySchema.parse(query), match[1]!), requestId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: maxRequestBytes });
  try {
    await server.connect(transport);
    const bodyBuffer = bounded.bytes.buffer.slice(bounded.bytes.byteOffset, bounded.bytes.byteOffset + bounded.bytes.byteLength) as ArrayBuffer;
    const sdkRequest = new Request(request.url, { method: "POST", headers: request.headers, body: bodyBuffer });
    const response = await transport.handleRequest(sdkRequest, { parsedBody: body });
    const responseBody = new Uint8Array(await response.arrayBuffer());
    // Limit zapisów liczy tylko udane zapisy: odrzucenie regułami, konflikt i błąd nie zlecają nagrań.
    // shortcut: równoległe zapisy tego samego tokenu mogą przekroczyć limit o kilka; wystarcza przy jednym agencie.
    if (authoring && typeof toolName === "string" && LESSON_WRITE_TOOL_NAMES.has(toolName) && response.status === 200) {
      const result = (JSON.parse(new TextDecoder().decode(responseBody)) as { result?: { isError?: boolean } }).result;
      if (result !== undefined && result.isError !== true) deps.writeLimiter.record(principal, deps.now());
    }
    let output = responseBody;
    if (output.byteLength > MAX_RESPONSE_BYTES) {
      const parsed = JSON.parse(new TextDecoder().decode(output)) as { id?: string | number | null };
      output = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? null, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "response_too_large", message: "The response is too large to return.", retryable: false, requestId }) }] } }));
    }
    const outHeaders = headers(requestId, response.headers);
    outHeaders.delete("mcp-session-id");
    return new Response(output, { status: response.status, headers: outHeaders });
  } catch {
    return rpcFailure(requestId, -32603, 500, "MCP request failed.");
  } finally {
    await Promise.allSettled([server.close(), transport.close()]);
  }
}

export function createLearningMcpDependencies(services: Services, allowedOrigins: ReadonlySet<string>): LearningMcpDependencies {
  return {
    authenticate: (rawToken) => authenticateIntegrationToken(services.db, rawToken),
    readOverview: (query, rawToken) => getLearningOverview(services, query, rawToken),
    lessonAuthoring: (rawToken) => ({
      catalog: (input) => lessonAuthoringCatalog(services, rawToken, input),
      validate: (input) => validateAuthoredLesson(services, rawToken, input),
      create: (input) => createAuthoredLesson(services, rawToken, input),
      get: (input) => getAuthoredLesson(services, rawToken, input),
      replace: (input) => replaceAuthoredLesson(services, rawToken, input),
      append: (input) => appendAuthoredLesson(services, rawToken, input),
      materialList: (input) => listMaterials(services, rawToken, input),
      deckGet: (input) => getVocabularyDeck(services, rawToken, input),
      deckCreate: (input) => createVocabularyDeck(services, rawToken, input),
      deckEdit: (input) => editVocabularyDeck(services, rawToken, input),
      sourceList: (input) => listSources(services, rawToken, input),
      sourceGet: (input) => getSource(services, rawToken, input),
      sourceCreate: (input) => createSource(services, rawToken, input),
      sourceUpdate: (input) => updateSource(services, rawToken, input),
      recordingRegenerate: (input) => regenerateRecording(services, rawToken, input),
      illustrationOmit: (input) => omitIllustration(services, rawToken, input),
      publish: (input) => publishMaterial(services, rawToken, input),
      archive: (input) => archiveMaterial(services, rawToken, input),
    }),
    limiter: learningOverviewLimiter,
    writeLimiter: lessonWriteLimiter,
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
