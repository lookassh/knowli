import { AppError } from "@learning/server";

/**
 * Limity rozmiaru ciał żądań dla ścieżki kid (oRPC + ewentualne ręczne
 * czytniki). Twarde sufity pilnują raportu aktywności sesji (end) oraz nagrań
 * dziecka z multipartu (attempts): pre-check `content-length` (nagłówki z
 * kontekstu oRPC) odrzuca nadmiarowy payload bez wołania przypadku użycia,
 * a czytnik `readCappedJson` pilnuje limitu także po odczycie tekstu.
 */

/**
 * Błąd limitu rozmiaru ciała — kod 1:1 z legacy kid-routera; komunikat (widoczny
 * w logach, koperta na wire bierze tekst z katalogu messages) doprecyzowuje
 * przekroczony limit: raport aktywności sesji albo nagranie dziecka.
 */
export function payloadTooLargeError(message: string = "payload exceeds the activity report size limit"): AppError {
  return new AppError("validation", { message });
}

/**
 * Pre-check deklarowanego rozmiaru ciała po nagłówku `content-length`.
 * Tani (same nagłówki) i zgodny z prawdziwymi klientami HTTP, które wysyłają
 * ten nagłówek dla każdego ciała z buforem. Brak/nieliczbowy nagłówek nie
 * odrzuca żądania — wtedy o rozmiarze decyduje dopiero odczyt ciała.
 * `message` trafia wyłącznie do logów (komunikat 1:1 z legacy dla danego limitu).
 */
export function assertDeclaredBodyCap(
  headers: Headers,
  capBytes: number,
  message: string = "payload exceeds the activity report size limit",
): void {
  const declaredLength = Number(headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > capBytes) {
    throw payloadTooLargeError(message);
  }
}

/**
 * Rozmiar (w bajtach UTF-8) kompaktowego JSON sparsowanego ciała. Kodek oRPC
 * zużywa surowy strumień przed łańcuchem procedury, więc to jedyny dostępny
 * miernik rzeczywistego rozmiaru payloadu, gdy `content-length` nie mówi
 * prawdy (chunked encoding, podmieniony nagłówek). Kompaktowa serializacja
 * jest ≤ rozmiaru ciała na wire (klient nie kompresuje poniżej treści), więc
 * przekroczenie limitu tutaj oznacza przekroczenie także w bajtach żądania.
 */
export function compactJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

/**
 * Odczyt JSON z limitem bajtów — port czytnika z legacy `kid/kid-router.ts`
 * (semantyka zachowana 1:1 dla podanych testów jednostkowych): puste ciało
 * zwraca null (koniec sesji bez raportu), nadmiarowy lub zepsuty JSON dostaje
 * jawny błąd walidacji, a nie ciche porzucenie raportu. Ścieżka oRPC parsuje
 * ciała sama, więc czytnik pozostaje narzędziem granic ręcznych/kompensacyjnych.
 */
export async function readCappedJson(request: Request, capBytes: number): Promise<unknown> {
  // Content-Length ponad limit odrzucamy od razu, bez buforowania żądania.
  assertDeclaredBodyCap(request.headers, capBytes);
  const text = await request.text();
  if (text.trim() === "") return null;
  // Limit deklarowany w bajtach — porównujemy bajty UTF-8, nie jednostki UTF-16.
  if (Buffer.byteLength(text, "utf8") > capBytes) {
    throw payloadTooLargeError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("validation");
  }
}

/**
 * Surowy limit bajtów ciała żądania egzekwowany PRZED dekodowaniem oRPC
 * (review PR #114, P2): guard w procedurze mierzy ponownie zserializowany
 * kompaktowy JSON, więc nadmiarowo sformatowane ciało (np. 300 tys. spacji
 * + `{}`) omijało limit raportu aktywności. Tu liczymy bajty ze strumienia
 * jak legacy `readCappedJson`: pre-check `content-length`, potem czytanie
 * z limitem i anulowanie readera przy przekroczeniu — nadmiarowe żądanie
 * pada na `validation` zanim cokolwiek dotknie procedury. Ciało ≤ limitu
 * wraca jako nowe żądanie z zbuforowanym ciałem (rozmiar ≤ limitu, więc
 * buforowanie jest bounded); `content-length` usuwamy, bo undici ustawi go
 * sam dla nowego ciała.
 */
export async function withRawBodyCap(request: Request, capBytes: number): Promise<Request> {
  assertDeclaredBodyCap(request.headers, capBytes);
  if (request.body === null) {
    return request;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > capBytes) {
      await reader.cancel();
      throw payloadTooLargeError();
    }
    chunks.push(value);
  }
  const headers = new Headers(request.headers);
  // undici sam ustawi content-length dla nowego, zbuforowanego ciała;
  // nagłówek z oryginalnego żądania może być nieaktualny po przeczytaniu.
  headers.delete("content-length");
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    body,
    redirect: request.redirect,
  });
}
