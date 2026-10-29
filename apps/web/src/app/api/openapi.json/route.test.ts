import { describe, expect, it } from "vitest";
import { GET } from "./route";

/** Minimalny kształt speki, którego dotyczą asercje (reszta to `unknown`). */
interface SpecFile {
  openapi: string;
  info: { title: string };
  servers: Array<{ url: string }>;
  paths: Record<string, { post?: { responses: Record<string, unknown> } }>;
}

async function fetchSpec(): Promise<SpecFile> {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  return (await response.json()) as SpecFile;
}

describe("GET /api/openapi.json — spec OpenAPI Kid API", () => {
  it("zwraca ważny dokument OpenAPI wygenerowany z kontraktu kid", async () => {
    const spec = await fetchSpec();

    expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/);
    expect(spec.info.title).toBe("Umiem! Kid API");
    expect(spec.servers).toEqual([{ url: "/api/v1/kid" }]);
  });

  it("zawiera oczekiwane ścieżki Kid API (arch §12)", async () => {
    const spec = await fetchSpec();
    const paths = Object.keys(spec.paths);

    const expected = [
      "/ui-audio",
      "/profiles",
      "/decks",
      "/sessions",
      "/sessions/{sessionId}/next",
      "/sessions/{sessionId}/end",
      "/sessions/{sessionId}/disable-microphone",
      "/sessions/{sessionId}/activity-result",
      "/sessions/{sessionId}/mock-test-summary",
      "/tasks/{taskId}/events",
      "/tasks/{taskId}/disclosures",
      "/tasks/{taskId}/complete-presentation",
      "/attempts/{attemptId}",
      "/attempts/{attemptId}/feedback-audio",
    ];
    for (const path of expected) {
      expect(paths, `brak ścieżki ${path}`).toContain(path);
    }
  });

  it("sessions/next deklaruje odpowiedzi 200 i 204 (regresja R05)", async () => {
    const spec = await fetchSpec();
    const responses = spec.paths["/sessions/{sessionId}/next"]?.post?.responses ?? {};

    expect(Object.keys(responses)).toEqual(expect.arrayContaining(["200", "204"]));
  });

  it("tasks/attempts jest świadomie wyłączone — znane ograniczenie generatora beta.45", async () => {
    // Unia wejścia (JSON | multipart) w trybie compact nie pozwala pobrać
    // parametru ścieżki {taskId}; szczegóły w komentarzu route.ts.
    const spec = await fetchSpec();

    expect(Object.keys(spec.paths)).not.toContain("/tasks/{taskId}/attempts");
    // dyktowanie (multipart z File) ma to samo ograniczenie generatora
    expect(Object.keys(spec.paths)).not.toContain("/tasks/{taskId}/dictation");
  });
});
