import { LearningOverviewQuerySchema, messages, type ApiError } from "@learning/contracts";
import { AppError, getLearningOverview, type IntegrationPrincipal, type Services } from "@learning/server";
import { IntegrationReadLimiter, learningOverviewLimiter } from "./integration-read-limiter";

export { IntegrationReadLimiter, learningOverviewLimiter } from "./integration-read-limiter";

function noStoreJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  const outputHeaders = new Headers(headers);
  outputHeaders.set("cache-control", "no-store, max-age=0");
  outputHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: outputHeaders });
}

function failure(error: unknown, requestId: string, retryAfter?: number): Response {
  let code: AppError["code"] = "internal";
  let status = 500;
  let retryable = true;
  if (error instanceof AppError) {
    code = error.code;
    status = error.status;
    retryable = error.retryable;
  } else {
    const pgCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (/^(08|53|57)/.test(pgCode) || pgCode === "ECONNRESET" || pgCode === "ECONNREFUSED") {
      code = "learning_summary_unavailable";
      status = 503;
      retryable = true;
    }
  }
  const catalogue = messages.errors as Record<string, string | undefined>;
  const body: ApiError = { code, message: catalogue[code] ?? catalogue.internal!, retryable, requestId };
  return noStoreJson(body, status, retryAfter ? { "retry-after": String(retryAfter) } : undefined);
}

function parseQuery(url: URL) {
  const allowed = new Set(["days", "upcomingTestDays", "childId"]);
  const values: Record<string, string> = {};
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new AppError("validation");
    values[key] = url.searchParams.get(key)!;
  }
  const parsed = LearningOverviewQuerySchema.safeParse({
    ...(values.days === undefined ? {} : { days: Number(values.days) }),
    ...(values.upcomingTestDays === undefined ? {} : { upcomingTestDays: Number(values.upcomingTestDays) }),
    ...(values.childId === undefined ? {} : { childId: values.childId }),
  });
  if (!parsed.success) throw new AppError("validation");
  return parsed.data;
}

export async function handleLearningOverviewRequest(
  request: Request,
  services: Services,
  limiter: IntegrationReadLimiter = learningOverviewLimiter,
): Promise<Response> {
  const requestId = randomUUID();
  let principal: IntegrationPrincipal | undefined;
  try {
    if (request.method !== "GET") throw new AppError("not_found");
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match) throw new AppError("unauthorized");
    const query = parseQuery(new URL(request.url));
    const payload = await getLearningOverview(services, query, match[1]!, (authenticated) => {
      principal = authenticated;
      limiter.consume(authenticated, services.clock.now().getTime());
    });
    return noStoreJson(payload);
  } catch (error) {
    const wait = error instanceof AppError && error.code === "rate_limited" && principal
      ? limiter.retryAfterSeconds(principal, services.clock.now().getTime())
      : undefined;
    return failure(error, requestId, wait);
  }
}
import { randomUUID } from "node:crypto";
