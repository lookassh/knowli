import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { withORpcFallback } from "@/http/orpc-fallback";
import { handleParentApi } from "@/parent/parent-router";
import { createOpenApiHandler } from "@/orpc/handler";
import { parentORpcRouter } from "@/orpc/parent-router";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

// Handler oRPC budowany raz per proces (module scope); `Services` trafiają
// per żądanie przez kontekst przekazywany w `withORpcFallback`.
const parentORpcHandler = createOpenApiHandler(parentORpcRouter);

// Router oRPC ma priorytet; brak dopasowania (grupy jeszcze niezmigrowane,
// zadanie 11) woła legacy `handleParentApi` z tymi samymi argumentami.
const dispatchORpc = withORpcFallback(parentORpcHandler, "/api/v1/parent", handleParentApi);

const dispatch = withApi<RouteContext>(async (request, context) => {
  const { path } = await context.params;
  return dispatchORpc(request, getServerServices(), path ?? []);
});

/** Catch-all API rodzica; statyczne trasy (login) mają pierwszeństwo. */
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
