import { AppError, readReadyMedia } from "@learning/server";
import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const dispatch = withApi<RouteContext>(async (_request, context) => {
  const { id } = await context.params;
  const media = await readReadyMedia(getServerServices(), id);
  if (!media) {
    throw new AppError("not_found");
  }
  return new Response(toArrayBuffer(media.bytes), {
    headers: {
      "content-type": media.mimeType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

/**
 * Zasób medialny po nieprzejrzystym identyfikatorze: tylko state=ready,
 * cache niezmienne (klucz adresowany treścią). Same-origin bez CORS; odczyt
 * nie wyznacza ekspozycji dziecka (architecture.md §12).
 */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
