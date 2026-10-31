import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { createOpenApiHandler } from "@/orpc/handler";
import { parentORpcRouter } from "@/orpc/parent-router";
import { AppError, MAX_DECK_COVER_BYTES } from "@learning/server";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

// Handler oRPC budowany raz per proces (module scope); `Services` trafiają
// per żądanie przez kontekst przekazywany do `handle`. Sufit bajtów surowego
// strumienia = największe legalne ciało (okładka 5 MB) + 64 KB luzu na
// ramki multipart/JSON — `RequestLimitHandlerPlugin` odrzuca nadmiar ZANIM
// kodek oRPC zbuforuje ciało; dokładne limity per endpoint (okładka, audio)
// pilnują strażniki w procedurach.
const parentORpcHandler = createOpenApiHandler(parentORpcRouter, {
  maxBodySize: MAX_DECK_COVER_BYTES + 64 * 1024,
});

// oRPC jest jedynym serwerem kontraktu Parent API (arch §12) — ręczny router
// legacy i fallback `withORpcFallback` zostały zdekomisjonowane (zadanie 13
// migracji oRPC v2). Ścieżka spoza kontraktu (`matched === false`) rzuca
// `AppError("not_found")`, które zewnętrzna granica `withApi` serializuje do
// koperty 404 — bajt w bajt jak koniecówka starego dispatchu, gdzie ten sam
// wyjątek leciał z ostatniego wpadu legacy routera.
const dispatch = withApi<RouteContext>(async (request, _context) => {
  const { matched, response } = await parentORpcHandler.handle(request, {
    prefix: "/api/v1/parent",
    context: { services: getServerServices(), headers: request.headers, url: request.url },
  });
  if (matched) {
    return response;
  }
  throw new AppError("not_found");
});

/** Catch-all API rodzica — jedyny serwer /api/v1/parent: auth, dzieci, zestawy, lekcje, źródła i postępy. */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const PUT = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
