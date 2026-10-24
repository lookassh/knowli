import { AppError, type Services } from "@learning/server";
import { os, ORPCError, type Middleware } from "@orpc/server";
import { mapTriggerError } from "../http/errors";
import { assertSameOrigin, requireParentSession } from "../http/security";

/**
 * Fundament oRPC v2 (dokładny pin `@orpc/*@2.0.0-beta.45`).
 *
 * Budowniczy procedur code-first pochodzą od `baseOs`; workflow contract-first
 * NIE przechodzi przez `baseOs` — `implement(contract).$context<Ctx>().use(...)`
 * nie przyjmuje buildera, a middleware z tego pliku dokleja się na implementerze.
 * Współdzielone middlewares są jednocześnie źródłem dla obu wariantów.
 */

/** Sesja rodzica załadowana przez `parentSessionMiddleware`. */
export interface ORpcParent {
  token: string;
}

/**
 * Pola kontekstu ustawiane przez middleware autoryzacji. Muszą być zdeklarowane
 * w typie kontekstu każdego buildera/implementera, który używa tych middleware
 * (v2: `.$context<ORpcContext>()`).
 */
export interface ORpcAuthContext {
  /**
   * Flaga deduplikacji v2: migracja v1→v2 usuwa deduplikację middleware, więc
   * middleware na poziomie routera i procedury wykonuje się dwukrotnie.
   * `parentSessionMiddleware` sprawdza flagę i nie czyta sesji z bazy drugi raz.
   */
  authLoaded?: boolean;
  parent?: ORpcParent;
}

/** Pełny kontekst handlera oRPC web: baza + pola middleware autoryzacji. */
export type ORpcContext = { services: Services; headers: Headers } & ORpcAuthContext;

/**
 * Bazowy builder procedur code-first. Kontrakt-first zaczyna się od
 * `implement(contract).$context<ORpcContext>()` i dokleja middlewares z tego
 * pliku przez `.use(...)` — wtedy `baseOs` służy wyłącznie jako ich źródło.
 */
export const baseOs = os.$context<{ services: Services; headers: Headers }>();

/**
 * `requireParentSession`, `assertSameOrigin` i helpery ciastek czytają `Request`;
 * oRPC trzyma nagłówki żądania w kontekście, więc odtwarzamy minimalny obiekt
 * żądania. Adres jest techniczny — te funkcje patrzą wyłącznie na nagłówki
 * (włącznie z `x-forwarded-proto` dla atrybutu Secure).
 */
export function requestFromHeaders(headers: Headers): Request {
  return new Request("http://orpc.internal", { headers });
}

/** Typ middlewares bez mutacji kontekstu. */
export type PassthroughMiddleware = Middleware<
  ORpcContext,
  Record<never, never>,
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zgodnie z generykami buildera ($Output = any)
  any,
  Record<never, never>
>;

/** Konwersja AppError → ORPCError; `cause` można podmienić na błąd pierwotny. */
function fromAppError(error: AppError, cause: unknown = error): ORPCError<string, unknown> {
  return new ORPCError(error.code.toUpperCase(), {
    message: error.message,
    ...(error.details === undefined ? {} : { data: error.details }),
    cause,
  });
}

/**
 * Konwertuje wyrzucony `AppError` na `ORPCError` o kodzie `AppError.code`
 * wielkimi literami; `message`, `details` (jako `data`) i `cause` zachowane.
 * Port klasyfikacji z `errorResponse` (http/errors.ts): surowy błąd triggera
 * Postgresa (publikacja/edycja szkiców) mapuje na `IMMUTABLE`/`CONFLICT` (409),
 * a nie `INTERNAL_SERVER_ERROR`/500 — parzystość kodu i statusu z granicą REST.
 * Kopertę HTTP `{code, message, retryable, requestId, details?}` buduje
 * autorytatywnie encoder w `../orpc/handler` — ten middleware tylko typuje błąd.
 */
export const appErrorMiddleware: PassthroughMiddleware = async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof AppError) {
      throw fromAppError(error);
    }
    const mapped = mapTriggerError(error);
    if (mapped) {
      throw fromAppError(mapped, error);
    }
    throw error;
  }
};

/**
 * Weryfikuje sesję rodzica (cookie HttpOnly) i dodaje `context.parent`.
 * Rzuca `AppError("unauthorized")` bez ważnego cookie — konwersją na odpowiedź
 * zajmuje się `appErrorMiddleware` ustawiony dalej w łańcuchu.
 */
export const parentSessionMiddleware: Middleware<
  ORpcContext,
  ORpcAuthContext,
  unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zgodnie z generykami buildera ($Output = any)
  any,
  Record<never, never>
> = async ({ context, next }) => {
  if (context.authLoaded && context.parent) {
    return next({ context: { parent: context.parent, authLoaded: true } });
  }
  const token = await requireParentSession(requestFromHeaders(context.headers), context.services);
  return next({ context: { parent: { token }, authLoaded: true } });
};

/**
 * Kontrola Origin/CSRF dla mutacji — dokładnie logika `assertSameOrigin`
 * (Origin vs x-forwarded-host/Host, `Sec-Fetch-Site` inny niż same-* → odmowa).
 * Rzuca `AppError("forbidden")`; stosować na procedurach zmieniających stan.
 */
export const sameOriginMiddleware: PassthroughMiddleware = async ({ context, next }) => {
  assertSameOrigin(requestFromHeaders(context.headers));
  return next();
};
