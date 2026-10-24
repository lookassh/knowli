import { randomUUID } from "node:crypto";
import { messages, type ApiError } from "@learning/contracts";
import { AppError, type AppErrorCode } from "@learning/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { AnyORPCError, Context, Router } from "@orpc/server";

/**
 * Autorytatywne źródło koperty błędu oRPC: `{code, message, retryable,
 * requestId, details?}` powstaje WYŁĄCZNIE tutaj, w `customErrorResponseBodyEncoder`
 * handlera — dokładny port serializacji z `../http/errors.ts` (`withApi`).
 * Catch-all przekazuje odpowiedzi błędowe oRPC 1:1, bez ponownego rzucania
 * wyjątków.
 */

const CATALOGUE = messages.errors as Record<string, string | undefined>;

/**
 * Port mapowania kod→status z CODE_PROFILES (`packages/server/src/errors.ts`).
 * Klucze wielkimi literami — kody `ORPCError` po konwersji z `AppError`.
 * Parzystość pilnuje test w `./handler.test.ts`.
 */
const APP_ERROR_STATUS: Record<AppErrorCode, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  rate_limited: 429,
  setup_required: 409,
  already_configured: 409,
  validation: 400,
  mock_test_unavailable: 400,
  deck_kind_mismatch: 400,
  learning_summary_unavailable: 503,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  immutable: 409,
  internal: 500,
};

const APP_CODES = new Set<string>(Object.keys(APP_ERROR_STATUS));

/**
 * Mapa kodów `ORPCError` na statusy HTTP. Kody spoza mapy spadają do
 * domyślnego 400 oRPC, dlatego kody wewnętrzne (walidacja inputu `BAD_REQUEST`,
 * limit body `PAYLOAD_TOO_LARGE` — oba spójnie z kopertą `validation`/400 —
 * oraz `INTERNAL_SERVER_ERROR`) są dopisane jawnie.
 */
export const errorStatusMap: Record<string, number> = {
  ...Object.fromEntries(
    Object.entries(APP_ERROR_STATUS).map(([code, status]) => [code.toUpperCase(), status]),
  ),
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 400,
  INTERNAL_SERVER_ERROR: 500,
};

/** Port `toApiError` z `../http/errors.ts` — identyczny kształt i kolejność pól. */
function toApiError(code: AppErrorCode, requestId: string, details?: unknown): ApiError {
  return {
    code,
    message: CATALOGUE[code] ?? CATALOGUE.internal!,
    retryable: code === "rate_limited" || code === "internal",
    requestId,
    ...(details === undefined ? {} : { details }),
  };
}

/**
 * Kod `ORPCError` → kod aplikacji z koperty + `details`. Kody aplikacji
 * (wielkie litery po konwersji w `appErrorMiddleware`) wracają do małych liter
 * i przenoszą `data` jako `details`. Defensywnie (M1): `AppError` w `cause`
 * oznacza procedurę bez `appErrorMiddleware` lub odwróconą kolejność middleware —
 * kod koperty bierzemy wtedy z przyczyny, żeby kompozycja nie fałszowała kodów
 * (status pozostaje wg kodu zewnętrznego — encoder nie zmienia statusu).
 * Kody wewnętrzne oRPC mapują jak ich odpowiedniki w `withApi`: walidacja
 * inputu (`BAD_REQUEST`) i limit body (`PAYLOAD_TOO_LARGE`) → `validation`,
 * `INTERNAL_SERVER_ERROR` (oRPC owija nim też nieznane awarie) → `internal`.
 * Niewidziane kody → `validation`, spójnie z fallbackiem statusu 400 handlera.
 */
function classifyError(error: AnyORPCError): { code: AppErrorCode; details?: unknown } {
  const upperCode = String(error.code);
  const lowerCode = upperCode.toLowerCase();
  if (APP_CODES.has(lowerCode)) {
    return { code: lowerCode as AppErrorCode, details: error.data };
  }
  if (error.cause instanceof AppError) {
    return { code: error.cause.code, details: error.cause.details };
  }
  if (upperCode === "BAD_REQUEST" || upperCode === "PAYLOAD_TOO_LARGE") {
    return { code: "validation" };
  }
  if (upperCode === "INTERNAL_SERVER_ERROR") {
    return { code: "internal" };
  }
  return { code: "validation" };
}

/**
 * Jedyny producent koperty błędu na wire dla handlerów oRPC. Status HTTP
 * dobiera `errorStatusMap`; `retryable` i komunikat pochodzą wyłącznie z kodu
 * (katalog messages), a `requestId` losuje się per odpowiedź — identycznie
 * jak w `errorResponse` z `../http/errors.ts`.
 */
export const appErrorEncoder = (error: AnyORPCError): unknown => {
  const { code, details } = classifyError(error);
  const requestId = randomUUID();
  // Log jak w errorResponse: kod, requestId, komunikat i przyczyna do korelacji.
  console.error("[api]", code, requestId, error.message, error.cause ?? "");
  return toApiError(code, requestId, details);
};

/**
 * Fabryka handlera OpenAPI dla routerów oRPC — jednolita konfiguracja
 * (encoder koperty + mapowanie statusów) dla każdego montowanego routera.
 * Kontekst przekazuje catch-all (route.ts) przy każdym `handle`.
 */
export function createOpenApiHandler<T extends Context>(router: Router<T>): OpenAPIHandler<T> {
  return new OpenAPIHandler(router, {
    errorStatusMap,
    customErrorResponseBodyEncoder: appErrorEncoder,
  });
}
