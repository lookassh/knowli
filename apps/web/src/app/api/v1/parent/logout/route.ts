import { logoutParent } from "@learning/server";
import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";
import { assertSameOrigin, clearingSessionCookie, requireParentSession } from "@/http/security";

export const POST = withApi(async (request) => {
  assertSameOrigin(request);
  const token = await requireParentSession(request, getServerServices());
  await logoutParent(getServerServices(), token);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearingSessionCookie(request) },
  });
});
