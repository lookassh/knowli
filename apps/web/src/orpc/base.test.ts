import { AppError, requireParent, type Services } from "@learning/server";
import { call, ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "../http/security";
import {
  appErrorMiddleware,
  baseOs,
  type ORpcContext,
  parentSessionMiddleware,
  sameOriginMiddleware,
} from "./base";

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return { ...actual, requireParent: vi.fn() };
});

const services = {} as Services;
const parentGuard = vi.mocked(requireParent);

function context(headers: HeadersInit = [], url = "http://localhost/rpc"): ORpcContext {
  return { services, headers: new Headers(headers), url };
}

/** Zwraca odrzucony błąd zamiast samego faktu odrzucenia. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("oczekiwano odrzucenia obietnicy");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("appErrorMiddleware", () => {
  const probe = baseOs.use(appErrorMiddleware).handler(() => {
    throw new AppError("not_found", { cause: new Error("brak wiersza") });
  });

  it("converts a thrown AppError into an ORPCError with the upper-cased code and preserved cause", async () => {
    const error = await rejection(call(probe, undefined, { context: context() }));

    expect(error).toBeInstanceOf(ORPCError);
    const orpcError = error as ORPCError<string, unknown>;
    expect(orpcError.code).toBe("NOT_FOUND");
    expect(orpcError.cause).toBeInstanceOf(AppError);
    expect((orpcError.cause as AppError).code).toBe("not_found");
  });

  it("preserves AppError details as ORPCError data", async () => {
    const details = { field: "title" };
    const detailed = baseOs.use(appErrorMiddleware).handler(() => {
      throw new AppError("validation", { details });
    });

    const error = (await rejection(call(detailed, undefined, { context: context() }))) as ORPCError<
      string,
      unknown
    >;

    expect(error.code).toBe("VALIDATION");
    expect(error.data).toBe(details);
  });

  it("lets non-AppError failures propagate untouched", async () => {
    const failure = new Error("niespodziewane");
    const crashing = baseOs.use(appErrorMiddleware).handler(() => {
      throw failure;
    });

    await expect(rejection(call(crashing, undefined, { context: context() }))).resolves.toBe(failure);
  });

  it("classifies raw DB trigger errors as IMMUTABLE with the original cause", async () => {
    const trigger = new Error("ERROR: snapshot is immutable for deck 123");
    const sealed = baseOs.use(appErrorMiddleware).handler(() => {
      throw trigger;
    });

    const error = (await rejection(
      call(sealed, undefined, { context: context() }),
    )) as ORPCError<string, unknown>;

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe("IMMUTABLE");
    expect(error.cause).toBe(trigger);
  });

  it("classifies terminal-task trigger errors as CONFLICT", async () => {
    const reopened = baseOs.use(appErrorMiddleware).handler(() => {
      throw new Error("Terminal task cannot be reopened");
    });

    const error = (await rejection(
      call(reopened, undefined, { context: context() }),
    )) as ORPCError<string, unknown>;

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe("CONFLICT");
  });
});

describe("parentSessionMiddleware", () => {
  const probe = baseOs
    .$context<ORpcContext>()
    .use(parentSessionMiddleware)
    .handler(({ context }) => context.parent?.token ?? null);

  it("rejects with AppError unauthorized when the session cookie is missing", async () => {
    const error = await rejection(call(probe, undefined, { context: context() }));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("unauthorized");
    expect(parentGuard).not.toHaveBeenCalled();
  });

  it("verifies the cookie, calls requireParent once and exposes the token as context.parent", async () => {
    parentGuard.mockResolvedValueOnce(undefined);

    const token = await call(
      probe,
      undefined,
      { context: context({ cookie: `${SESSION_COOKIE_NAME}=secret-token` }) },
    );

    expect(token).toBe("secret-token");
    expect(parentGuard).toHaveBeenCalledTimes(1);
    expect(parentGuard).toHaveBeenCalledWith(services, "secret-token");
  });

  it("runs the session check only once even when applied at both router and procedure level", async () => {
    parentGuard.mockResolvedValue(undefined);
    // v2 nie deduplikuje middleware — podwójne użycie symuluje poziom routera
    // i procedury naraz; flaga authLoaded musi chronić przed drugim odczytem bazy.
    const doubleGuard = baseOs
      .$context<ORpcContext>()
      .use(parentSessionMiddleware)
      .use(parentSessionMiddleware)
      .handler(({ context }) => context.parent?.token ?? null);

    const token = await call(
      doubleGuard,
      undefined,
      { context: context({ cookie: `${SESSION_COOKIE_NAME}=secret-token` }) },
    );

    expect(token).toBe("secret-token");
    expect(parentGuard).toHaveBeenCalledTimes(1);
  });
});

describe("sameOriginMiddleware", () => {
  const probe = baseOs.use(sameOriginMiddleware).handler(() => "ok");

  it("rejects a cross-site mutation with AppError forbidden", async () => {
    const error = await rejection(
      call(probe, undefined, {
        context: context({
          origin: "http://evil.example",
          host: "localhost",
          "sec-fetch-site": "cross-site",
        }),
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("forbidden");
  });

  it("rejects a mismatched origin header even without sec-fetch-site", async () => {
    const error = await rejection(
      call(probe, undefined, {
        context: context({ origin: "http://evil.example", host: "localhost" }),
      }),
    );

    expect((error as AppError).code).toBe("forbidden");
  });

  it("passes same-origin requests through", async () => {
    await expect(
      call(probe, undefined, {
        context: context({ origin: "http://localhost", host: "localhost", "sec-fetch-site": "same-origin" }),
      }),
    ).resolves.toBe("ok");
  });

  it("becomes an ORPCError FORBIDDEN when composed behind appErrorMiddleware", async () => {
    const guarded = baseOs
      .use(appErrorMiddleware)
      .use(sameOriginMiddleware)
      .handler(() => "ok");

    const error = (await rejection(
      call(guarded, undefined, {
        context: context({ host: "localhost", "sec-fetch-site": "cross-site" }),
      }),
    )) as ORPCError<string, unknown>;

    expect(error).toBeInstanceOf(ORPCError);
    expect(error.code).toBe("FORBIDDEN");
  });
});
