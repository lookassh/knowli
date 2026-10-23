import type { Services } from "@learning/server";
import type { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Context } from "@orpc/server";

/**
 * Współistnienie oRPC z ręcznie pisanymi routerami (wzorzec strangler).
 * Wrapper woła handler oRPC pod danym prefixem; brak dopasowania ścieżki
 * (`matched === false`) przekazuje żądanie do routera legacy, a brak
 * dopasowania po stronie legacy pozostawia — jak dziś — wyjątek `not_found`
 * dla zewnętrznej granicy `withApi`.
 *
 * Ścieżka re-throw NIE istnieje: odpowiedzi błędowe oRPC przechodzą 1:1,
 * bo kopertę `{code, message, retryable, requestId, details?}` generuje
 * encoder w `../orpc/handler` na poziomie handlera.
 */
export function withORpcFallback(
  handler: OpenAPIHandler<Context>,
  prefix: string,
  legacy: (request: Request, services: Services, segments: string[]) => Promise<Response>,
): (request: Request, services: Services, segments: string[]) => Promise<Response> {
  return async (request, services, segments) => {
    // Typ opcji handlera wymaga `/${string}`; publicznie przyjmujemy zwykły
    // string, ale prefix musi zaczynać się od "/" (jak ścieżka montowania).
    const { matched, response } = await handler.handle(request, {
      prefix: prefix as `/${string}`,
      context: { services, headers: request.headers },
    });
    if (matched) {
      return response;
    }
    return legacy(request, services, segments);
  };
}
