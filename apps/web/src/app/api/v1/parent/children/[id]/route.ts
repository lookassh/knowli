import { ChildPatchSchema } from "@learning/contracts";
import { deleteChild, updateChild } from "@learning/server";
import { getServerServices } from "@/composition";
import { readJson, withApi } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const dispatch = withApi<RouteContext>(async (request, context) => {
  assertSameOrigin(request);
  await requireParentSession(request, getServerServices());
  const { id } = await context.params;
  await deleteChild(getServerServices(), id);
  return new Response(null, { status: 204 });
});

export const DELETE = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);

const patchDispatch = withApi<RouteContext>(async (request, context) => {
  const services = getServerServices();
  assertSameOrigin(request);
  await requireParentSession(request, services);
  const { id } = await context.params;
  const input = ChildPatchSchema.parse(await readJson(request));
  return Response.json(await updateChild(services, id, input));
});

export const PATCH = (request: Request, context: RouteContext): Promise<Response> =>
  patchDispatch(request, context);
