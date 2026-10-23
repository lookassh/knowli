import { ApiErrorSchema } from "@learning/contracts";
import {
  AppError,
  authorizeFeedbackAudio,
  listKidDecks,
  listKidProfiles,
  mockTestKindOfSession,
  readAttempt,
  readLessonMockTestSummary,
  readMockTestSummary,
  readSessionActivityResult,
  readUiAudio,
  type Services,
} from "@learning/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenApiHandler } from "./handler";
import { kidRouter } from "./kid-router";

vi.mock("@learning/server", async (importActual) => {
  const actual = await importActual<typeof import("@learning/server")>();
  return {
    ...actual,
    readUiAudio: vi.fn(),
    listKidProfiles: vi.fn(),
    listKidDecks: vi.fn(),
    readSessionActivityResult: vi.fn(),
    readMockTestSummary: vi.fn(),
    readLessonMockTestSummary: vi.fn(),
    mockTestKindOfSession: vi.fn(),
    readAttempt: vi.fn(),
    authorizeFeedbackAudio: vi.fn(),
  };
});

const services = { db: {} } as unknown as Services;
const handler = createOpenApiHandler(kidRouter);

const childId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";

const profile = {
  childId,
  displayName: "Szymek",
  avatarKey: "fox",
  recordingMode: "hold" as const,
  canRead: true,
  rewardPoints: 7,
};
const deck = {
  mockTestAvailable: false,
  activeSession: null,
  vocabularyFormat: "standard" as const,
  coverVisual: null,
  resumeOnly: false,
  deckId: "44444444-4444-4444-8444-444444444444",
  title: "Zwierzęta",
  itemCount: 12,
  independentlyRecalledCount: 3,
  testDate: null,
  recommended: false,
};
const vocabularySummary = {
  sessionId,
  deckId: deck.deckId,
  state: "completed" as const,
  complete: true,
  taskBudget: 5,
  answeredCount: 5,
  solutions: [],
};
const lessonSummary = {
  sessionId,
  deckId: deck.deckId,
  state: "completed" as const,
  complete: true,
  taskBudget: 4,
  answeredCount: 4,
  solutions: [
    {
      taskId: "55555555-5555-4555-8555-555555555555",
      objectiveId: "obj-1",
      titlePl: "Liczby",
      exerciseType: "lesson_choice" as const,
      prompt: "Wybierz „two”",
      childAnswer: "two",
      correctAnswer: "two",
      outcome: "correct" as const,
    },
  ],
};

async function call(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/kid${path}`, init);
  const { matched, response } = await handler.handle(request, {
    prefix: "/api/v1/kid",
    context: { services, headers: request.headers },
  });
  if (!matched) throw new Error(`no oRPC match for ${path}`);
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kid oRPC router — odczyty (GET)", () => {
  it("zwraca katalog ui-audio z no-store", async () => {
    vi.mocked(readUiAudio).mockResolvedValueOnce({ ready: true, assets: { correct: childId } });

    const response = await call("/ui-audio");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ready: true, assets: { correct: childId } });
    expect(readUiAudio).toHaveBeenCalledWith(services);
  });

  it("listuje profile z no-store", async () => {
    vi.mocked(listKidProfiles).mockResolvedValueOnce([profile]);

    const response = await call("/profiles");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([profile]);
  });

  it("listuje zestawy z przeparsowanym childId i mikrofonem (stringbool)", async () => {
    vi.mocked(listKidDecks).mockResolvedValueOnce([deck]);

    const response = await call(`/decks?childId=${childId}&microphoneEnabled=true`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual([deck]);
    expect(listKidDecks).toHaveBeenCalledWith(services, childId, { microphoneEnabled: true });

    await call(`/decks?childId=${childId}`);
    expect(listKidDecks).toHaveBeenLastCalledWith(services, childId, {});
  });

  it("odrzuca niepoprawne childId jako validation/400", async () => {
    const response = await call(`/decks?childId=not-a-uuid`);

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("validation");
    expect(listKidDecks).not.toHaveBeenCalled();
  });

  it("activity-result bez trwałego wyniku zwraca publiczny DTO pending", async () => {
    vi.mocked(readSessionActivityResult).mockResolvedValueOnce(null);

    const response = await call(`/sessions/${sessionId}/activity-result`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "already_started",
      pointsAwarded: 0,
      errorCode: null,
    });
    expect(readSessionActivityResult).toHaveBeenCalledWith(services, sessionId);
  });

  it("mock-test-summary rozdziela lekcję i słówka przez mockTestKindOfSession", async () => {
    vi.mocked(mockTestKindOfSession).mockResolvedValueOnce("lesson");
    vi.mocked(readLessonMockTestSummary).mockResolvedValueOnce(lessonSummary);
    const lessonResponse = await call(`/sessions/${sessionId}/mock-test-summary`);
    expect(lessonResponse.status).toBe(200);
    expect(lessonResponse.headers.get("cache-control")).toBe("no-store");
    await expect(lessonResponse.json()).resolves.toEqual(lessonSummary);
    expect(readLessonMockTestSummary).toHaveBeenCalledWith(services, sessionId);

    vi.mocked(mockTestKindOfSession).mockResolvedValueOnce("vocabulary");
    vi.mocked(readMockTestSummary).mockResolvedValueOnce(vocabularySummary);
    const vocabularyResponse = await call(`/sessions/${sessionId}/mock-test-summary`);
    expect(vocabularyResponse.status).toBe(200);
    await expect(vocabularyResponse.json()).resolves.toEqual(vocabularySummary);
    expect(mockTestKindOfSession).toHaveBeenCalledWith(services.db, sessionId);
  });

  it("odczyt próby zwraca DTO bez no-store", async () => {
    const attempt = {
      attemptId,
      taskId: "66666666-6666-4666-8666-666666666666",
      state: "completed",
      modality: "choice",
      feedback: null,
      taskState: "completed",
      stepId: "step-1",
      receivedAt: "2026-10-23T10:00:00.000Z",
      completedAt: null,
    };
    vi.mocked(readAttempt).mockResolvedValueOnce(attempt as never);

    const response = await call(`/attempts/${attemptId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBeNull();
    await expect(response.json()).resolves.toEqual(attempt);
    expect(readAttempt).toHaveBeenCalledWith(services, attemptId);
  });

  it("feedback-audio autoryzuje odsłuch z no-store", async () => {
    vi.mocked(authorizeFeedbackAudio).mockResolvedValueOnce({
      attemptId,
      taskId: "66666666-6666-4666-8666-666666666666",
      stepId: "step-2",
      audioAssetId: "77777777-7777-4777-8777-777777777777",
    });

    const response = await call(`/attempts/${attemptId}/feedback-audio`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeFeedbackAudio).toHaveBeenCalledWith(services, attemptId);
  });

  it("feedback-audio z obcym Origin pada na CSRF (forbidden/403)", async () => {
    const response = await call(`/attempts/${attemptId}/feedback-audio`, {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });

    expect(response.status).toBe(403);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("forbidden");
    expect(authorizeFeedbackAudio).not.toHaveBeenCalled();
  });

  it("nieistniejący zasób mapuje się na not_found/404 przez errorStatusMap", async () => {
    vi.mocked(readAttempt).mockRejectedValueOnce(new AppError("not_found"));

    const response = await call(`/attempts/${attemptId}`);

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response.json());
    expect(body.code).toBe("not_found");
  });
});
