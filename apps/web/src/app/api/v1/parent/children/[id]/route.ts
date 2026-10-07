import { deleteChild } from "@learning/server";
import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const DELETE = withApi<RouteContext>(async (request, context) => {
  assertSameOrigin(request);
  await requireParentSession(request, getServerServices());
  const { id } = await context.params;
  await deleteChild(getServerServices(), id);
  return new Response(null, { status: 204 });
});
