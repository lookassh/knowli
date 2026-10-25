import { AppError, readReadyMediaStream } from "@learning/server";
import { getServerServices } from "@/composition";
import { withApi } from "@/http/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** AsyncIterable bajtów z magazynu mediów jako strumień odpowiedzi HTTP. */
function toWebStream(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(next.value);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

const dispatch = withApi<RouteContext>(async (_request, context) => {
  const { id } = await context.params;
  const media = await readReadyMediaStream(getServerServices(), id);
  if (!media) {
    throw new AppError("not_found");
  }
  return new Response(toWebStream(media.body), {
    headers: {
      "content-type": media.mimeType,
      // awaryjny oryginał po błędzie transformacji ilustracji nie może
      // przypiąć się na rok — docelowo ten URL zwraca wariant WebP
      "cache-control": media.immutableCache ? "public, max-age=31536000, immutable" : "public, max-age=300",
      ...(media.byteCount !== null ? { "content-length": String(media.byteCount) } : {}),
    },
  });
});

/**
 * Zasób medialny po nieprzejrzystym identyfikatorze: tylko state=ready,
 * cache niezmienne (klucz adresowany treścią). Audio strumieniuje z dysku,
 * ilustracje wychodzą jako przeskalowany wariant wyświetlania — magazyn
 * i oryginalne bajty zasobu pozostają nietknięte. Same-origin bez CORS;
 * odczyt nie wyznacza ekspozycji dziecka (architecture.md §12).
 */
export const GET = (request: Request, context: RouteContext): Promise<Response> =>
  dispatch(request, context);
