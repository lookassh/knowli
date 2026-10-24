import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { createOpenApiHandler } from "@/orpc/handler";
import { kidRouter } from "@/orpc/kid-router";
import { withRawBodyCap } from "@/orpc/request-limits";
import { AppError, MAX_AUDIO_BYTES, MULTIPART_OVERHEAD_BYTES } from "@learning/server";
import { SESSION_ACTIVITY_REPORT_MAX_BYTES } from "@learning/contracts";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

// Handler oRPC budowany raz per proces (module scope); `Services` trafiają
// per żądanie przez kontekst przekazywany do `handle`. Kid API jest
// nieuwierzytelnione, więc surowy strumień żądania ma twardy sufit bajtów
// (największe legalne ciało = multipart z nagraniem) pilnowany przez
// `RequestLimitHandlerPlugin` ZANIM kodek oRPC zbuforuje ciało — ochrona
// DoS jak w streamingowych routerach legacy; dokładniejsze limity per
// endpoint (raport aktywności) pilnują strażniki w procedurach.
const kidORpcHandler = createOpenApiHandler(kidRouter, {
  maxBodySize: MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
});

// oRPC jest jedynym serwerem kontraktu Kid API (arch §12) — ręczny router
// legacy został zdekomisjonowany. Ścieżka spoza kontraktu (`matched === false`)
// rzuca `AppError("not_found")`, które zewnętrzna granica `withApi`
// serializuje do koperty 404 — bajt w bajt jak koniecówka starego dispatchu,
// gdzie ten sam wyjątek leciał z ostatniego wpadu legacy routera.
// Raport aktywności ma własny, niższy limit niż globalny sufit audio: surowe
// bajty tego ciała liczone są PRZED dekodowaniem oRPC (nadmiarowe formatowanie
// JSON nie może ominąć limitu; review PR #114, P2).
const SESSION_END_PATH = /\/sessions\/[^/]+\/end$/;

const dispatch = withApi<RouteContext>(async (request, _context) => {
  const limited = SESSION_END_PATH.test(new URL(request.url).pathname)
    ? await withRawBodyCap(request, SESSION_ACTIVITY_REPORT_MAX_BYTES)
    : request;
  const { matched, response } = await kidORpcHandler.handle(limited, {
    prefix: "/api/v1/kid",
    context: { services: getServerServices(), headers: request.headers, url: request.url },
  });
  if (matched) {
    return response;
  }
  throw new AppError("not_found");
});

/** Catch-all Kid API (arch §12): sesje, zadania, ujawnienia i próby dziecka. */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
