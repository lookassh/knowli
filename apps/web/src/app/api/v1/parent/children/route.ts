import { ChildInputSchema } from "@learning/contracts";
import { createChild, listChildren } from "@learning/server";
import { getServerServices } from "@/composition";
import { readJson, withApi } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

export const GET = withApi(async (request) => {
  await requireParentSession(request, getServerServices());
  const children = await listChildren(getServerServices());
  return Response.json(children);
});

export const POST = withApi(async (request) => {
  assertSameOrigin(request);
  await requireParentSession(request, getServerServices());
  const input = ChildInputSchema.parse(await readJson(request));
  const child = await createChild(getServerServices(), input);
  return Response.json(child, { status: 201 });
});
