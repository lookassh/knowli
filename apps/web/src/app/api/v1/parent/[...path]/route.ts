import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { handleParentApi } from "@/parent/parent-router";

interface RouteContext {
  params: Promise<{ path?: string[] }>;
}

const dispatch = withApi<RouteContext>(async (request, context) => {
  const { path } = await context.params;
  return handleParentApi(request, getServerServices(), path ?? []);
});

/** Catch-all API rodzica; statyczne trasy (login, children) mają pierwszeństwo. */
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
