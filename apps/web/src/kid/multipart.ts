import { AppError } from "@learning/server";

/** Sufit na dokończenie odbioru nadmiarowego strumienia — porzucamy dane bez buforowania. */
const DRAIN_LIMIT_BYTES = 16 * 1024 * 1024;

/**
 * Odczyt multipartu z limitem buforowania (arch §11): żądanie zatrzymuje co
 * najwyżej `capBytes` w pamięci; nadmiarowy payload jest odrzucany, a reszta
 * strumienia odbierana z porzuceniem danych — zwrot błędu nie zrywa gniazda
 * klientowi w trakcie wysyłki. Bajty nagrania nigdy nie trafiają do logów.
 */
export async function readCappedFormData(request: Request, capBytes: number): Promise<FormData> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new AppError("validation", { message: "missing request body" });
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > capBytes) {
      let drained = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        drained += next.value.byteLength;
        if (drained > DRAIN_LIMIT_BYTES) {
          await reader.cancel();
          break;
        }
      }
      chunks.length = 0;
      throw new AppError("validation", { message: "payload exceeds audio limit" });
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  chunks.length = 0;
  return new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body,
  }).formData();
}
