import { AppError } from "@learning/server";

/**
 * Limity rozmiaru ciał żądań dla ścieżki kid (oRPC + ewentualne ręczne
 * czytniki). Twarde sufity pilnują raportu aktywności sesji: pre-check
 * `content-length` (nagłówki z kontekstu oRPC) odrzuca nadmiarowy payload
 * bez buforowania, a czytnik `readCappedJson` — przeniesiony z legacy
 * `kid/kid-router.ts` — pilnuje limitu także po odczycie tekstu.
 */

/** Błąd limitu rozmiaru ciała — kod i komunikat 1:1 z legacy kid-routera. */
export function payloadTooLargeError(): AppError {
  return new AppError("validation", { message: "payload exceeds the activity report size limit" });
}

/**
 * Pre-check deklarowanego rozmiaru ciała po nagłówku `content-length`.
 * Tani (same nagłówki) i zgodny z prawdziwymi klientami HTTP, które wysyłają
 * ten nagłówek dla każdego ciała z buforem. Brak/nieliczbowy nagłówek nie
 * odrzuca żądania — wtedy o rozmiarze decyduje dopiero odczyt ciała.
 */
export function assertDeclaredBodyCap(headers: Headers, capBytes: number): void {
  const declaredLength = Number(headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > capBytes) {
    throw payloadTooLargeError();
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
