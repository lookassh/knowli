import { ApiErrorSchema, type ApiError } from "@learning/contracts";
import { AppError, type Services } from "@learning/server";
import { createORPCClient, ORPCError } from "@orpc/client";
import { openapi } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { format } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { appErrorMiddleware, baseOs } from "./base";
import { appErrorEncoder, createOpenApiHandler, errorStatusMap } from "./handler";
import { errorResponse } from "../http/errors";

const services = {} as Services;
const PREFIX = "/api/rpc/probe";

/** Procedura rzucająca AppError — kopertę buduje wyłącznie encoder handlera. */
const boom = baseOs
  .meta(openapi({ method: "GET", path: "/boom" }))
  .use(appErrorMiddleware)
  .handler(() => {
    throw new AppError("not_found", { details: { segment: "decks" } });
  });

/** Surowe błędy triggerów Postgresa — klasyfikacja jak w granicy withApi. */
const sealed = baseOs
  .meta(openapi({ method: "GET", path: "/sealed" }))
  .use(appErrorMiddleware)
  .handler(() => {
    throw new Error("ERROR: Event must be sealed before completing the session");
  });

const reopened = baseOs
  .meta(openapi({ method: "GET", path: "/reopened" }))
  .use(appErrorMiddleware)
  .handler(() => {
    throw new Error("ERROR: Terminal task cannot be reopened");
  });

/** Procedury BEZ appErrorMiddleware — defensywna koperta encodera. */
const unwrapped = baseOs
  .meta(openapi({ method: "GET", path: "/unwrapped" }))
  .handler(() => {
    throw new AppError("unauthorized");
  });

const crashing = baseOs
  .meta(openapi({ method: "GET", path: "/crashing" }))
  .handler(() => {
    throw new Error("connection reset by peer");
  });

const handler = createOpenApiHandler({ boom, sealed, reopened, unwrapped, crashing });

/**
 * Wywołanie handlera jak w catch-all (route.ts): dopasowanie po pełnym URL
 * pod prefixem, usługi przez kontekst. Ścieżki procedur testowych zawsze
 * pasują, więc `matched` jest zawsze prawdziwe.
 */
async function call(path: string): Promise<Response> {
  const { matched, response } = await handler.handle(new Request(`http://localhost${PREFIX}${path}`), {
    prefix: PREFIX,
    context: { services, headers: new Headers(), url: "http://localhost/rpc" },
  });
  if (!matched) throw new Error(`ścieżka testowa ${path} musi pasować`);
  return response;
}

describe("createOpenApiHandler — encoder koperty błędów", () => {
  it("buduje kopertę z kodu, komunikatu i details dla procedury rzucającej AppError", async () => {
    const response = await call("/boom");

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
    expect(body.message).toBe("Nie znaleziono.");
    expect(body.retryable).toBe(false);
    expect(body.details).toEqual({ segment: "decks" });
  });

  it("produces the same envelope shape as the legacy withApi error boundary", async () => {
    const orpcBody = (await (await call("/boom")).json()) as ApiError;
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

  it("maps raw DB trigger errors to immutable/409 like the legacy withApi boundary", async () => {
    const response = await call("/sealed");

    expect(response.status).toBe(409);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("immutable");
    expect(body.message).toBe("Te dane są już zakończone i nie mogą być zmienione.");
    expect(body.retryable).toBe(false);

    const legacyEnvelope = (await (
      await errorResponse(new Error("ERROR: Event must be sealed before completing the session"))
    ).json()) as ApiError;
    expect({ ...body, requestId: "normalized" }).toEqual({
      ...legacyEnvelope,
      requestId: "normalized",
    });
  });

  it("maps terminal-task trigger errors to conflict/409", async () => {
    const response = await call("/reopened");

    expect(response.status).toBe(409);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("conflict");
    expect(body.message).toBe("Ta operacja nie jest już możliwa. Odśwież i spróbuj ponownie.");
    expect(body.retryable).toBe(false);
  });

  it("recovers the envelope code from an AppError cause even without appErrorMiddleware", async () => {
    const response = await call("/unwrapped");

    // Status zostaje 500 (oRPC opakowało AppError jako INTERNAL_SERVER_ERROR,
    // a encoder nie zmienia statusu) — ale kod koperty nie może być fałszywy.
    expect(response.status).toBe(500);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("unauthorized");
    expect(body.message).toBe("Sesja wygasła. Zaloguj się ponownie.");
    expect(body.retryable).toBe(false);
  });

  it("maps unknown crashes to the internal envelope (retryable, like withApi)", async () => {
    const response = await call("/crashing");

    expect(response.status).toBe(500);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("internal");
    expect(body.message).toBe("Coś nie zadziałało. Spróbuj ponownie.");
    expect(body.retryable).toBe(true);
  });

  it("keeps the full client round trip working through the handler (OpenAPILink)", async () => {
    const client = createORPCClient<{ boom: () => Promise<unknown> }>(
      new OpenAPILink({ boom }, {
        origin: "http://localhost",
        url: PREFIX,
        fetch: async (input, init) => {
          const { matched, response } = await handler.handle(new Request(input, init), {
            prefix: PREFIX,
            context: { services, headers: new Headers(), url: "http://localhost/rpc" },
          });
          if (!matched) throw new Error("ścieżka testowa musi pasować");
          return response;
        },
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

describe("appErrorEncoder — log nie zapisuje surowej przyczyny (review P1)", () => {
  it("błąd walidacji z invalidData nie trafia do logu; kod i requestId tak", async () => {
    const canary = "REVIEW_FAKE_SECRET_CANARY";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // ValidationError oRPC: message bezpieczny, ale cause niesie odrzucone wejście.
      const validationLike = new ORPCError("BAD_REQUEST", {
        message: "Input validation failed",
        cause: { invalidData: { secret: canary, extra: true } },
      });

      appErrorEncoder(validationLike);

      // util.format jak prawdziwy console.error — inaczej obiekty degenerują się do [object Object]
      const logged = log.mock.calls.map((parts) => format(...parts)).join(" | ");
      expect(logged).not.toContain(canary);
      expect(logged).not.toContain("invalidData");
      expect(logged).toContain("validation");
      expect(logged).toMatch(/[0-9a-f-]{36}/);
    } finally {
      log.mockRestore();
    }
  });
});
