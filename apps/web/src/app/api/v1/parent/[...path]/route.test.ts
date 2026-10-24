import { ApiErrorSchema, type ApiError } from "@learning/contracts";
import { AppError } from "@learning/server";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/http/errors";

// Ścieżki spoza kontraktu nigdy nie docierają do przypadków użycia, więc
// usługi są nieistotne — mock composition, żeby test nie wymagał DATABASE_URL.
vi.mock("@/composition", () => ({
  getServerServices: vi.fn(() => ({ db: {} }) as never),
}));

import { DELETE, GET, PATCH, POST, PUT } from "./route";

/** Kontekst catch-all Next.js: params to obietnica segmentów ścieżki. */
function contextFor(segments: string[]): { params: Promise<{ path?: string[] }> } {
  return { params: Promise.resolve({ path: segments }) };
}

function request(path: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"): Request {
  return new Request(`http://localhost/api/v1/parent${path}`, { method });
}

describe("parent catch-all — dekomisja legacy routera", () => {
  it("każda metoda poza kontraktem zwraca standardową kopertę not_found/404", async () => {
    const handlers = { GET, POST, PATCH, PUT, DELETE } as const;
    for (const method of Object.keys(handlers) as Array<keyof typeof handlers>) {
      const response = await handlers[method](
        request("/no-such-endpoint", method),
        contextFor(["no-such-endpoint"]),
      );

      expect(response.status, method).toBe(404);
      const body = ApiErrorSchema.parse(await response.json());
      expect(body.code, method).toBe("not_found");
      expect(body.message, method).toBe("Nie znaleziono.");
      expect(body.retryable, method).toBe(false);
      expect(body.requestId, method).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("koperta not_found jest kształtem 1:1 z granicą withApi (parzystość po usunięciu fallbacku)", async () => {
    // Referencja: dokładnie ten wyjątek leciał kiedyś z ostatniego wpadu legacy
    // routera i serializowała go granica withApi — porównanie jak w
    // orpc/handler.test.ts (requestId losowy per odpowiedź).
    const reference = (await (
      await errorResponse(new AppError("not_found"))
    ).json()) as ApiError;
    const body = (await (
      await GET(request("/no-such-endpoint", "GET"), contextFor(["no-such-endpoint"]))
    ).json()) as ApiError;

    expect(Object.keys(body)).toEqual(Object.keys(reference));
    expect({ ...body, requestId: "normalized" }).toEqual({
      ...reference,
      requestId: "normalized",
    });
  });
});
