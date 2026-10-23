import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { withORpcFallback } from "@/http/orpc-fallback";
import { handleKidApi } from "@/kid/kid-router";
import { createOpenApiHandler } from "@/orpc/handler";
import { emptyKidORpcRouter } from "@/orpc/kid-router";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

// Handler oRPC budowany raz per proces (module scope); `Services` trafiają
// per żądanie przez kontekst przekazywany w `withORpcFallback`.
const kidORpcHandler = createOpenApiHandler(emptyKidORpcRouter);

// Router oRPC ma priorytet; brak dopasowania (pusty router ⇒ zawsze) woła
// legacy `handleKidApi` z tymi samymi argumentami — zero zmiany zachowania.
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
