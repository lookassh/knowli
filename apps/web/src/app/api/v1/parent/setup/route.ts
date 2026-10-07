import { z } from "zod";
import { setupParent } from "@learning/server";
import { getServerServices } from "@/composition";
import { readJson, withApi } from "@/http/errors";
import { assertSameOrigin } from "@/http/security";

const SetupInput = z.object({ secret: z.string().min(1) });

export const POST = withApi(async (request) => {
  assertSameOrigin(request);
  const input = SetupInput.parse(await readJson(request));
  await setupParent(getServerServices(), input.secret);
  return Response.json({ ok: true }, { status: 201 });
});
