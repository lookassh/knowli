import { ApiErrorSchema, type ApiError } from "@learning/contracts";
import { AppError, endSession } from "@learning/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/http/errors";

// Ścieżki spoza kontraktu nigdy nie docierają do przypadków użycia, więc
// usługi są nieistotne — mock composition, żeby test nie wymagał DATABASE_URL.
vi.mock("@/composition", () => ({
  getServerServices: vi.fn(() => ({ db: {} }) as never),
}));

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return { ...actual, endSession: vi.fn() };
});

import { GET, POST } from "./route";

/** Kontekst catch-all Next.js: params to obietnica segmentów ścieżki. */
function contextFor(segments: string[]): { params: Promise<{ path?: string[] }> } {
  return { params: Promise.resolve({ path: segments }) };
}

function request(path: string, method: "GET" | "POST" = "GET"): Request {
  return new Request(`http://localhost/api/v1/kid${path}`, { method });
}

describe("kid catch-all — surowy limit bajtów raportu aktywności (review P2)", () => {
  const sessionId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    // Pełny DTO — walidacja outputu odrzuca pusty obiekt (błąd outputu nosi
    // kod walidacji, więc zwróciłby mylący 400 zamiast 200).
    vi.mocked(endSession).mockResolvedValue({
      sessionId,
      state: "completed",
      tasksIssued: 1,
      assessedTasksIssued: 1,
      endedAt: "2026-10-24T10:00:00.000Z",
      independentSuccesses: { recall: 0, spelling: 0 },
      practiceItems: [],
    } as never);
  });

  it("odrzuca nadmiarowo sformatowane ciało bez content-length zanim endSession wystartuje", async () => {
    // 300 000 spacji + "{}" = 300 002 bajty surowego ciała; kompaktowy JSON
    // po dekodowaniu ma 2 bajty i wcześniej przechodził przez guard.
    const padding = " ".repeat(300_000) + "{}";
    const request = new Request(`http://localhost/api/v1/kid/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: padding,
    });

    const response = await POST(request, contextFor(["sessions", sessionId, "end"]));

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(endSession).not.toHaveBeenCalled();
  });

  it("przepuszcza legalny raport po surowym limicie do procedury", async () => {
    const request = new Request(`http://localhost/api/v1/kid/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activityReport: { version: 1, elapsedMs: 30_000, activeMs: 0, compacted: false, tasks: [] } }),
    });

    const response = await POST(request, contextFor(["sessions", sessionId, "end"]));

    // Bez bazy endSession (mock) może rzucić — liczy się, że limit NIE odrzucił.
    expect(response.status).not.toBe(400);
    expect(endSession).toHaveBeenCalled();
  });
});

describe("kid catch-all — dekomisja legacy routera", () => {
  it("GET poza kontraktem zwraca standardową kopertę not_found/404", async () => {
    const response = await GET(request("/no-such-endpoint"), contextFor(["no-such-endpoint"]));

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
    expect(body.message).toBe("Nie znaleziono.");
    expect(body.retryable).toBe(false);
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("POST poza kontraktem zwraca tę samą kopertę not_found/404", async () => {
    const response = await POST(
      request("/no-such-endpoint", "POST"),
      contextFor(["no-such-endpoint"]),
    );

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
    expect(body.retryable).toBe(false);
  });

  it("koperta not_found jest kształtem 1:1 z granicą withApi (parzystość po usunięciu fallbacku)", async () => {
    // Referencja: dokładnie ten wyjątek leciał kiedyś z ostatniego wpadu legacy
    // routera i serializowała go granica withApi — porównanie jak w
    // orpc/handler.test.ts (requestId losowy per odpowiedź).
    const reference = (await (
      await errorResponse(new AppError("not_found"))
    ).json()) as ApiError;
    const body = (await (
      await GET(request("/no-such-endpoint"), contextFor(["no-such-endpoint"]))
    ).json()) as ApiError;

    expect(Object.keys(body)).toEqual(Object.keys(reference));
    expect({ ...body, requestId: "normalized" }).toEqual({
      ...reference,
      requestId: "normalized",
    });
  });
});
