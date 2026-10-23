import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { messages, type ApiError } from "@learning/contracts";
import { AppError, type AppErrorCode } from "@learning/server";

/**
 * Jednolity format błędu API {code, message, retryable, requestId}.
 * Komunikaty pochodzą z katalogu messages; surowy tekst SQL/błędów sterownika
 * nigdy nie trafia do klienta.
 */

const TRIGGER_PATTERNS: ReadonlyArray<{ patterns: readonly RegExp[]; code: AppErrorCode }> = [
  {
    patterns: [
      /is immutable/i,
      /snapshot is immutable/i,
      /Event must be sealed/i,
      /one sealing transition/i,
      /Cannot extend sealed/i,
    ],
    code: "immutable",
  },
  {
    patterns: [
      /Delete the child profile/i,
      /may only be inserted/i,
      /Terminal task cannot be reopened/i,
    ],
    code: "conflict",
  },
];

/**
 * Klasyfikacja surowych błędów triggerów Postgresa po treści wiadomości.
 * Współdzielona z warstwą oRPC (`apps/web/src/orpc/base.ts`) — obie granice
 * HTTP muszą mapować te same błędy na te same kody.
 */
export function mapTriggerError(error: unknown): AppError | undefined {
  const message = error instanceof Error ? error.message : String(error);
  for (const { patterns, code } of TRIGGER_PATTERNS) {
    if (patterns.some((p) => p.test(message))) {
      return new AppError(code);
    }
  }
  return undefined;
}

function toApiError(code: AppErrorCode, requestId: string, details?: unknown): ApiError {
  const catalogue = messages.errors as Record<string, string | undefined>;
  return {
    code,
    message: catalogue[code] ?? catalogue.internal!,
    retryable: code === "rate_limited" || code === "internal",
    requestId,
    ...(details === undefined ? {} : { details }),
  };
}

export function errorResponse(error: unknown, requestId = randomUUID()): Response {
  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError("validation");
  } else {
    const mapped = mapTriggerError(error);
    appError = mapped ?? new AppError("internal", { cause: error });
  }
  // Log bez treści żądania: kod, requestId, komunikat przypadku użycia
  // (własne teksty angielskie, nie SQL) i przyczyna dla korelacji.
  console.error("[api]", appError.code, requestId, appError.message, appError.cause ?? "");
  return Response.json(toApiError(appError.code, requestId, appError.details), {
    status: appError.status,
  });
}

/** Opakowanie handlera: wspólny requestId i jednolity format błędu. */
export function withApi<C = unknown>(
  handler: (request: Request, context: C) => Promise<Response>,
): (request: Request, context?: C) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context as C);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("validation");
  }
}
