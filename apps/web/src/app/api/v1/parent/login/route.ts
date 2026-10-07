import { z } from "zod";
import { isParentSetupRequired, requireParent } from "@learning/server";
import { getServerServices } from "@/composition";
import { readJson, withApi } from "@/http/errors";
import { assertSameOrigin, getSessionToken, loginAndBuildCookie } from "@/http/security";

const LoginInput = z.object({ secret: z.string().min(1) });

/** Stan ekranu logowania: czy pokazać setup pierwszego uruchomienia. */
export const GET = withApi(async (request) => {
  const services = getServerServices();
  const setupRequired = await isParentSetupRequired(services);
  let authenticated = false;
  const token = getSessionToken(request);
  if (token) {
    try {
      await requireParent(services, token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }
  return Response.json({ authenticated, setupRequired });
});

export const POST = withApi(async (request) => {
  assertSameOrigin(request);
  const input = LoginInput.parse(await readJson(request));
  const { body, cookie } = await loginAndBuildCookie(request, getServerServices(), input.secret);
  return Response.json(body, { headers: { "set-cookie": cookie } });
});
