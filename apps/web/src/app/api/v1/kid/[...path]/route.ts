import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { withORpcFallback } from "@/http/orpc-fallback";
import { handleKidApi } from "@/kid/kid-router";
import { createOpenApiHandler } from "@/orpc/handler";
import { kidRouter } from "@/orpc/kid-router";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

// Handler oRPC budowany raz per proces (module scope); `Services` trafiają
// per żądanie przez kontekst przekazywany w `withORpcFallback`.
const kidORpcHandler = createOpenApiHandler(kidRouter);

// Router oRPC serwuje cały kontrakt kid API; dopasowana ścieżka nigdy nie
// spada do legacy. Fallback `handleKidApi` zostaje tylko dla adresów spoza
// kontraktu — woła `not_found` dla zewnętrznej granicy `withApi`.
const dispatchORpc = withORpcFallback(kidORpcHandler, "/api/v1/kid", handleKidApi);

const dispatch = withApi<RouteContext>(async (request, context) => {
  const { path } = await context.params;
  return dispatchORpc(request, getServerServices(), path ?? []);
});

/** Catch-all Kid API (arch §12): sesje, zadania, ujawnienia i próby dziecka. */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
