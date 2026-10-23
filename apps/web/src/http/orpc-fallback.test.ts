import { ApiErrorSchema, type ApiError } from "@learning/contracts";
import { AppError, type Services } from "@learning/server";
import { createORPCClient, ORPCError } from "@orpc/client";
import { openapi } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appErrorMiddleware, baseOs } from "../orpc/base";
import { createOpenApiHandler, errorStatusMap } from "../orpc/handler";
import { errorResponse, withApi } from "./errors";
import { withORpcFallback } from "./orpc-fallback";

const services = {} as Services;
const PREFIX = "/api/rpc/probe";

/** Procedura rzucająca AppError — kopertę buduje wyłącznie encoder handlera. */
const boom = baseOs
  .meta(openapi({ method: "GET", path: "/boom" }))
  .use(appErrorMiddleware)
  .handler(() => {
    throw new AppError("not_found", { details: { segment: "decks" } });
  });

const handler = createOpenApiHandler({ boom });

const legacy = vi.fn(
  async (_request: Request, _services: Services, segments: string[]): Promise<Response> => {
    if (segments[0] === "legacy-ok") {
      return Response.json({ handledBy: "legacy" });
    }
    throw new AppError("not_found");
  },
);

const fallback = withORpcFallback(handler, PREFIX, legacy);

function request(path: string): Request {
  return new Request(`http://localhost${PREFIX}${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withORpcFallback", () => {
  it("delegates unmatched paths to the legacy router and returns its response", async () => {
    const response = await fallback(request("/legacy-ok"), services, ["legacy-ok"]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ handledBy: "legacy" });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith(expect.any(Request), services, ["legacy-ok"]);
  });

  it("does not call legacy when the oRPC handler matched the path", async () => {
    await fallback(request("/boom"), services, ["boom"]);

    expect(legacy).not.toHaveBeenCalled();
  });

  it("turns a legacy miss into the standard not_found envelope when composed with withApi", async () => {
    const api = withApi((incoming) => fallback(incoming, services, ["unknown"]));

    const response = await api(request("/unknown"));

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
    expect(body.retryable).toBe(false);
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it("passes the encoder error envelope through 1:1 for a procedure throwing AppError", async () => {
    const response = await fallback(request("/boom"), services, ["boom"]);

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
    expect(body.message).toBe("Nie znaleziono.");
    expect(body.retryable).toBe(false);
    expect(body.details).toEqual({ segment: "decks" });
  });

  it("produces the same envelope shape as the legacy withApi error boundary", async () => {
    const orpcResponse = await fallback(request("/boom"), services, ["boom"]);
    const orpcBody = (await orpcResponse.json()) as ApiError;
    const legacyBody = (await (
      await errorResponse(new AppError("not_found", { details: { segment: "decks" } }))
    ).json()) as ApiError;

    // Identyczna kolejność pól i wartości; requestId jest losowy per odpowiedź.
    expect(Object.keys(orpcBody)).toEqual(Object.keys(legacyBody));
    expect({ ...orpcBody, requestId: "normalized" }).toEqual({
      ...legacyBody,
      requestId: "normalized",
    });
  });

  it("keeps the full client round trip working through the fallback (OpenAPILink)", async () => {
    const client = createORPCClient<{ boom: () => Promise<unknown> }>(
      new OpenAPILink({ boom }, {
        origin: "http://localhost",
        url: PREFIX,
        fetch: (input, init) => fallback(new Request(input, init), services, []),
        customErrorResponseBodyDecoder: (body) => {
          const parsed = ApiErrorSchema.parse(body);
          return new ORPCError(parsed.code.toUpperCase(), { data: parsed });
        },
      }),
    );

    const error = await client.boom().then(
      () => {
        throw new Error("oczekiwano odrzucenia");
      },
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ORPCError);
    const orpcError = error as ORPCError<string, ApiError>;
    expect(orpcError.code).toBe("NOT_FOUND");
    expect(orpcError.data.retryable).toBe(false);
    expect(orpcError.data.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe("errorStatusMap", () => {
  it("mirrors the HTTP status of every AppError code (CODE_PROFILES parity)", async () => {
    const codes = [
      "unauthorized",
      "invalid_credentials",
      "rate_limited",
      "setup_required",
      "already_configured",
      "validation",
      "mock_test_unavailable",
      "deck_kind_mismatch",
      "learning_summary_unavailable",
      "forbidden",
      "not_found",
      "conflict",
      "immutable",
      "internal",
    ] as const;

    for (const code of codes) {
      expect(errorStatusMap[code.toUpperCase()]).toBe(new AppError(code).status);
    }
  });
});
