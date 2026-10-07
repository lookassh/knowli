import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { handleKidApi } from "@/kid/kid-router";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

const dispatch = withApi<RouteContext>(async (request, context) => {
  const { path } = await context.params;
  return handleKidApi(request, getServerServices(), path ?? []);
});

/** Catch-all Kid API (arch §12): sesje, zadania, ujawnienia i próby dziecka. */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
export const POST = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
