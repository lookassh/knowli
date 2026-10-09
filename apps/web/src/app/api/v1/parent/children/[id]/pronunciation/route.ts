import { PronunciationBandsInputSchema } from "@learning/contracts";
import { getPronunciationSettings, updatePronunciationBands } from "@learning/server";
import { getServerServices } from "@/composition";
import { readJson, withApi } from "@/http/errors";
import { assertSameOrigin, requireParentSession } from "@/http/security";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const dispatch = withApi<RouteContext>(async (request, context) => {
  assertSameOrigin(request);
  const services = getServerServices();
  await requireParentSession(request, services);
  const { id } = await context.params;
  if (request.method === "GET") {
    return Response.json(await getPronunciationSettings(services, id));
  }
  const input = PronunciationBandsInputSchema.parse(await readJson(request));
  await updatePronunciationBands(services, id, input);
  return new Response(null, { status: 204 });
});

export const GET = (request: Request, context: RouteContext): Promise<Response> => dispatch(request, context);
export const PUT = (request: Request, context: RouteContext): Promise<Response> => dispatch(request, context);
