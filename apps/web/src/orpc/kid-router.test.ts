import { ApiErrorSchema, SESSION_ACTIVITY_REPORT_MAX_BYTES } from "@learning/contracts";
import {
  AppError,
  MAX_AUDIO_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  authorizeDisclosure,
  authorizeFeedbackAudio,
  completePresentation,
  disableSessionMicrophone,
  endSession,
  listKidDecks,
  listKidProfiles,
  nextTask,
  readAttempt,
  readMockTestSummaryForSession,
  readSessionActivityResult,
  readUiAudio,
  recordEvent,
  startSession,
  submitAttempt,
  submitSpeechAttempt,
  dictateLessonAnswer,
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
    readMockTestSummaryForSession: vi.fn(),
    readAttempt: vi.fn(),
    authorizeFeedbackAudio: vi.fn(),
    startSession: vi.fn(),
    nextTask: vi.fn(),
    endSession: vi.fn(),
    disableSessionMicrophone: vi.fn(),
    recordEvent: vi.fn(),
    authorizeDisclosure: vi.fn(),
    completePresentation: vi.fn(),
    submitAttempt: vi.fn(),
    submitSpeechAttempt: vi.fn(),
    dictateLessonAnswer: vi.fn(),
  };
});

const services = { db: {} } as unknown as Services;
const handler = createOpenApiHandler(kidRouter);

const childId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const taskId = "55555555-5555-4555-8555-555555555555";
const clientEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientCommandId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

const sessionDto = {
  mode: "training" as const,
  sessionId,
  childId,
  deckId: deck.deckId,
  deckVersionId: "88888888-8888-4888-8888-888888888888",
  policyId: "policy-1",
  microphoneEnabled: true,
  canRead: true,
  vocabularyFormat: "standard" as const,
  state: "active" as const,
  taskBudget: 5,
  tasksIssued: 0,
  assessedTasksIssued: 0,
  startedAt: "2026-10-23T09:00:00.000Z",
  resumed: false,
};

const taskDto = {
  taskId: "55555555-5555-4555-8555-555555555555",
  sessionId,
  ordinal: 0,
  exerciseType: "listening" as const,
  direction: null,
  state: "issued" as const,
  prompt: {
    kind: "listening" as const,
    options: [{ id: "99999999-9999-4999-8999-999999999999", text: "cat" }],
    audioAssetId: "77777777-7777-4777-8777-777777777777",
  },
  remainingAssessed: 3,
};

const sessionSummary = {
  sessionId,
  state: "completed" as const,
  tasksIssued: 3,
  assessedTasksIssued: 3,
  endedAt: "2026-10-23T10:00:00.000Z",
  independentSuccesses: { recall: 1, spelling: 0 },
  practiceItems: [
    { itemId: "a0000000-0000-4000-8000-000000000001", target: "cat", skills: ["recall" as const] },
  ],
};

/** Minimalny poprawny raport aktywności (wersja 1, zero zadań). */
const validReport = {
  version: 1,
  elapsedMs: 1,
  activeMs: 0,
  compacted: false,
  tasks: [],
};

const disclosureDto = {
  taskId,
  stepId: "step-1",
  kind: "hint" as const,
  reveal: { target: "cat" },
};

const completionDto = {
  taskId,
  state: "completed" as const,
  completedAt: "2026-10-23T10:00:02.000Z",
};

/** Próba zakończona (200) i w trakcie analizy (202) — jedno DTO, dwa stany. */
const completedAttemptDto = {
  attemptId,
  taskId,
  state: "completed" as const,
  modality: "audio" as const,
  feedback: null,
  taskState: "completed" as const,
  stepId: "step-2",
  receivedAt: "2026-10-23T10:00:00.000Z",
  completedAt: "2026-10-23T10:00:01.000Z",
};
const processingAttemptDto = {
  ...completedAttemptDto,
  state: "processing" as const,
  taskState: "issued" as const,
  completedAt: null,
};

/** Multipart z nagraniem dziecka (bajty poza JSON-em, arch §11–12). */
function recordingForm(
  bytes: Uint8Array<ArrayBuffer>,
  options?: { withClientAttemptId?: boolean; withAudio?: boolean },
): FormData {
  const form = new FormData();
  if (options?.withClientAttemptId !== false) form.append("clientAttemptId", attemptId);
  if (options?.withAudio !== false) {
    form.append("audio", new File([bytes], "rec.webm", { type: "audio/webm" }));
  }
  return form;
}

/**
 * Poprawny schematowo raport, którego kompaktowy JSON przekracza
 * SESSION_ACTIVITY_REPORT_MAX_BYTES: 512 zadań po 8 niepokrywających się
 * odsłuchów (4096 wpisów — dokładnie limit) daje ~400 KiB.
 */
const oversizedValidReport = {
  version: 1,
  elapsedMs: 5120,
  activeMs: 4096,
  compacted: true,
  tasks: Array.from({ length: 512 }, (_, i) => ({
    taskId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    exerciseType: "recall",
    shownFromMs: i * 10,
    shownToMs: i * 10 + 8,
    activeIntervals: [],
    editCount: 0,
    editWindows: [],
    submittedAttempts: [],
    playbacks: Array.from({ length: 8 }, (_, j) => ({
      assetId: "77777777-7777-4777-8777-777777777777",
      fromMs: i * 10 + j,
      toMs: i * 10 + j + 1,
    })),
    pauses: [],
  })),
};

async function call(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/kid${path}`, init);
  const { matched, response } = await handler.handle(request, {
    prefix: "/api/v1/kid",
    context: { services, headers: request.headers, url: request.url },
  });
  if (!matched) throw new Error(`no oRPC match for ${path}`);
  return response;
}

// Handler z limitem surowego strumienia jak w route.ts (RequestLimitHandlerPlugin).
const cappedHandler = createOpenApiHandler(kidRouter, {
  maxBodySize: MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("kid oRPC router — limit surowego strumienia (RequestLimitHandlerPlugin)", () => {
  const attemptsUrl = `/tasks/66666666-6666-4666-8666-666666666666/attempts`;

  it("odrzuca strumień bez content-length ponad limit zanim codec zbuforuje całość", async () => {
    let pulled = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64 * 1024).fill(65));
      },
    });
    const request = new Request(`http://localhost/api/v1/kid${attemptsUrl}`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: oversized,
      // @ts-expect-error -- duplex wymagany dla strumieniowych ciał w undici
      duplex: "half",
    });

    const { matched, response } = await cappedHandler.handle(request, {
      prefix: "/api/v1/kid",
      context: { services, headers: request.headers, url: request.url },
    });

    expect(matched).toBe(true);
    expect(response!.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    // Źródło pobiera co najwyżej limit + kilka chunków, nie całość (ochrona DoS).
    expect(pulled).toBeLessThan(80);
    expect(vi.mocked(submitSpeechAttempt)).not.toHaveBeenCalled();
  });

  it("odrzuca po content-length ponad limit bez czytania ciała", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(64 * 1024).fill(66));
      },
    });
    const request = new Request(`http://localhost/api/v1/kid${attemptsUrl}`, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
      },
      body,
      // @ts-expect-error -- duplex wymagany dla strumieniowych ciał w undici
      duplex: "half",
    });

    const { matched, response } = await cappedHandler.handle(request, {
      prefix: "/api/v1/kid",
      context: { services, headers: request.headers, url: request.url },
    });

    expect(matched).toBe(true);
    expect(response!.status).toBe(400);
    const parsed = ApiErrorSchema.parse(await response!.json());
    expect(parsed.code).toBe("validation");
    // undici czyta do 1 chunku z wyprzedzeniem przed odrzuceniem — gwarancją
    // jest ograniczony odczyt (brak pełnego buforowania), nie zero odczytów.
    expect(reads).toBeLessThan(3);
    expect(vi.mocked(submitSpeechAttempt)).not.toHaveBeenCalled();
  });
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
    const body = ApiErrorSchema.parse(await response!.json());
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

  it("mock-test-summary przekazuje obie odmiany DTO przez publiczną operację serwera", async () => {
    vi.mocked(readMockTestSummaryForSession).mockResolvedValueOnce(lessonSummary as never);
    const lessonResponse = await call(`/sessions/${sessionId}/mock-test-summary`);
    expect(lessonResponse.status).toBe(200);
    expect(lessonResponse.headers.get("cache-control")).toBe("no-store");
    await expect(lessonResponse.json()).resolves.toEqual(lessonSummary);

    vi.mocked(readMockTestSummaryForSession).mockResolvedValueOnce(vocabularySummary as never);
    const vocabularyResponse = await call(`/sessions/${sessionId}/mock-test-summary`);
    expect(vocabularyResponse.status).toBe(200);
    expect(vocabularyResponse.headers.get("cache-control")).toBe("no-store");
    await expect(vocabularyResponse.json()).resolves.toEqual(vocabularySummary);
    expect(readMockTestSummaryForSession).toHaveBeenNthCalledWith(1, services, sessionId);
    expect(readMockTestSummaryForSession).toHaveBeenNthCalledWith(2, services, sessionId);
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
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("forbidden");
    expect(authorizeFeedbackAudio).not.toHaveBeenCalled();
  });

  it("nieistniejący zasób mapuje się na not_found/404 przez errorStatusMap", async () => {
    vi.mocked(readAttempt).mockRejectedValueOnce(new AppError("not_found"));

    const response = await call(`/attempts/${attemptId}`);

    expect(response.status).toBe(404);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("not_found");
  });
});

describe("kid oRPC router — sesje (POST)", () => {
  it("create startuje sesję i zwraca SessionDto", async () => {
    vi.mocked(startSession).mockResolvedValueOnce(sessionDto as never);

    const input = {
      childId,
      deckId: deck.deckId,
      microphoneEnabled: true,
      supportsPictureVocabulary: false,
      supportsPictureRecognition: false,
    };
    const response = await call("/sessions", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(sessionDto);
    expect(startSession).toHaveBeenCalledWith(services, input);
  });

  it("create odrzuca niekompletne wejście jako validation/400", async () => {
    const response = await call("/sessions", {
      method: "POST",
      body: JSON.stringify({ childId, deckId: deck.deckId }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("next bez zadania zwraca 204 z pustym ciałem (regresja R05)", async () => {
    vi.mocked(nextTask).mockResolvedValueOnce(null);

    const response = await call(`/sessions/${sessionId}/next`, { method: "POST" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(nextTask).toHaveBeenCalledWith(services, sessionId);
  });

  it("next z zadaniem zwraca 200 + TaskDto", async () => {
    vi.mocked(nextTask).mockResolvedValueOnce(taskDto as never);

    const response = await call(`/sessions/${sessionId}/next`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(taskDto);
  });

  it("end bez ciała kończy sesję bez raportu (activityReport undefined)", async () => {
    vi.mocked(endSession).mockResolvedValueOnce(sessionSummary as never);

    const response = await call(`/sessions/${sessionId}/end`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(sessionSummary);
    expect(endSession).toHaveBeenCalledWith(services, sessionId, undefined);
  });

  it("end z pustym obiektem {} działa jak brak raportu (paritet z kid-ui)", async () => {
    vi.mocked(endSession).mockResolvedValueOnce(sessionSummary as never);

    const response = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(endSession).toHaveBeenCalledWith(services, sessionId, undefined);
  });

  it("end z poprawnym raportem przekazuje go do endSession", async () => {
    vi.mocked(endSession).mockResolvedValueOnce(sessionSummary as never);

    const response = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: JSON.stringify({ activityReport: validReport }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(endSession).toHaveBeenCalledWith(services, sessionId, validReport);
  });

  it("end z raportem w nieznanej wersji daje validation + reason aktualizacji", async () => {
    const response = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: JSON.stringify({ activityReport: { ...validReport, version: 2 } }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(body.details).toEqual({ reason: "activity_report_update_required" });
    expect(endSession).not.toHaveBeenCalled();
  });

  it("end z content-length ponad limit raportu pada przed wykonaniem endSession", async () => {
    const response = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        // undici nie wystawia content-length dla ciała stringowego — ustawiamy
        // jawnie, jak robi to każde prawdziwe żądanie HTTP z buforem.
        "content-length": String(SESSION_ACTIVITY_REPORT_MAX_BYTES + 1),
      },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(endSession).not.toHaveBeenCalled();
  });

  it("end z poprawnym raportem ponad limit bajtów (bez content-length) pada na limicie", async () => {
    const response = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: JSON.stringify({ activityReport: oversizedValidReport }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(endSession).not.toHaveBeenCalled();
  });

  it("disable-microphone wyłącza mikrofon i zwraca SessionDto", async () => {
    vi.mocked(disableSessionMicrophone).mockResolvedValueOnce({ ...sessionDto, microphoneEnabled: false } as never);

    const response = await call(`/sessions/${sessionId}/disable-microphone`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...sessionDto, microphoneEnabled: false });
    expect(disableSessionMicrophone).toHaveBeenCalledWith(services, sessionId);
  });

  it("mutacje sesji z obcym Origin kończą się forbidden/403 bez wywołania przypadków użycia", async () => {
    const evil = { origin: "http://evil.example" };
    const createResponse = await call("/sessions", {
      method: "POST",
      body: JSON.stringify({
        childId,
        deckId: deck.deckId,
        microphoneEnabled: true,
        supportsPictureVocabulary: false,
        supportsPictureRecognition: false,
      }),
      headers: { "content-type": "application/json", ...evil },
    });
    const nextResponse = await call(`/sessions/${sessionId}/next`, { method: "POST", headers: evil });
    const endResponse = await call(`/sessions/${sessionId}/end`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", ...evil },
    });
    const disableResponse = await call(`/sessions/${sessionId}/disable-microphone`, {
      method: "POST",
      headers: evil,
    });

    for (const [label, response] of [
      ["create", createResponse],
      ["next", nextResponse],
      ["end", endResponse],
      ["disable-microphone", disableResponse],
    ] as const) {
      expect(response.status, label).toBe(403);
      const body = ApiErrorSchema.parse(await response!.json());
      expect(body.code, label).toBe("forbidden");
    }
    expect(startSession).not.toHaveBeenCalled();
    expect(nextTask).not.toHaveBeenCalled();
    expect(endSession).not.toHaveBeenCalled();
    expect(disableSessionMicrophone).not.toHaveBeenCalled();
  });
});

describe("kid oRPC router — zadania (POST)", () => {
  it("events zapisuje zdarzenie i zwraca 204 z pustym ciałem", async () => {
    vi.mocked(recordEvent).mockResolvedValueOnce(undefined);

    const input = { clientEventId, kind: "audio_played" as const, stepId: "step-1" };
    const response = await call(`/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(recordEvent).toHaveBeenCalledWith(services, { taskId, ...input });
  });

  it("events z niepoprawnym kind pada na walidacji bez wywołania recordEvent", async () => {
    const response = await call(`/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify({ clientEventId, kind: "mystery" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("disclosures z kind hint autoryzuje ujawnienie i zwraca DTO", async () => {
    vi.mocked(authorizeDisclosure).mockResolvedValueOnce(disclosureDto);

    const response = await call(`/tasks/${taskId}/disclosures`, {
      method: "POST",
      body: JSON.stringify({ kind: "hint" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(disclosureDto);
    expect(authorizeDisclosure).toHaveBeenCalledWith(services, { taskId, kind: "hint" });
  });

  it("disclosures z kind spoza enumu (video) daje validation bez ujawnienia", async () => {
    const response = await call(`/tasks/${taskId}/disclosures`, {
      method: "POST",
      body: JSON.stringify({ kind: "video" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(authorizeDisclosure).not.toHaveBeenCalled();
  });

  it("complete-presentation bez ciała kończy prezentację (clientCommandId opcjonalne)", async () => {
    vi.mocked(completePresentation).mockResolvedValueOnce(completionDto as never);

    const response = await call(`/tasks/${taskId}/complete-presentation`, { method: "POST" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(completionDto);
    expect(completePresentation).toHaveBeenCalledWith(services, { taskId });
  });

  it("complete-presentation z clientCommandId przekazuje klucz idempotencji", async () => {
    vi.mocked(completePresentation).mockResolvedValueOnce(completionDto as never);

    const response = await call(`/tasks/${taskId}/complete-presentation`, {
      method: "POST",
      body: JSON.stringify({ clientCommandId }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(completePresentation).toHaveBeenCalledWith(services, { taskId, clientCommandId });
  });

  it("attempts JSON: completed → 200, processing → 202 (korelacja statusu z ciałem)", async () => {
    vi.mocked(submitAttempt)
      .mockResolvedValueOnce({ ...completedAttemptDto, modality: "choice" } as never)
      .mockResolvedValueOnce({ ...processingAttemptDto, modality: "choice" } as never);
    const input = { clientAttemptId: attemptId, modality: "choice" as const, optionId: attemptId };

    const completed = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    const processing = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toEqual({ ...completedAttemptDto, modality: "choice" });
    expect(processing.status).toBe(202);
    await expect(processing.json()).resolves.toEqual({ ...processingAttemptDto, modality: "choice" });
    expect(submitAttempt).toHaveBeenCalledWith(services, { taskId, ...input });
  });

  it("attempts JSON: nieznana modality daje validation bez próby", async () => {
    const response = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ clientAttemptId: attemptId, modality: "shout" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("attempts multipart: completed → 200, processing → 202; bajty/mime/locale/signal do use case'a", async () => {
    vi.mocked(submitSpeechAttempt)
      .mockResolvedValueOnce(completedAttemptDto as never)
      .mockResolvedValueOnce(processingAttemptDto as never);
    const bytes = new Uint8Array([1, 2, 3]);

    const completed = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(bytes),
    });
    const processing = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(bytes),
    });

    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toEqual(completedAttemptDto);
    expect(processing.status).toBe(202);
    await expect(processing.json()).resolves.toEqual(processingAttemptDto);
    expect(submitSpeechAttempt).toHaveBeenCalledWith(
      services,
      { taskId, clientAttemptId: attemptId },
      { bytes, mimeType: "audio/webm", locale: "en-GB" },
      expect.any(AbortSignal),
    );
  });

  it("attempts multipart z content-length ponad limit pada przed submitSpeechAttempt (bez przetwarzania nagrania)", async () => {
    const response = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(new Uint8Array([1, 2, 3])),
      headers: {
        // jawny nagłówek jak w prawdziwym żądaniu HTTP z buforem (undici
        // nie wystawia content-length dla ciała FormData)
        "content-length": String(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1),
      },
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(submitSpeechAttempt).not.toHaveBeenCalled();
  });

  it("attempts multipart bez pola audio daje validation z komunikatem jak w legacy", async () => {
    const response = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(new Uint8Array([1, 2, 3]), { withAudio: false }),
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(submitSpeechAttempt).not.toHaveBeenCalled();
  });

  it("dictation multipart: tekst do pola z no-store; bajty/mime/signal do use case'a, bez clientAttemptId", async () => {
    vi.mocked(dictateLessonAnswer).mockResolvedValueOnce({ status: "heard", text: "Poziomica to linia." });
    const bytes = new Uint8Array([1, 2, 3]);
    const response = await call(`/tasks/${taskId}/dictation`, {
      method: "POST",
      body: recordingForm(bytes, { withClientAttemptId: false }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "heard", text: "Poziomica to linia." });
    expect(dictateLessonAnswer).toHaveBeenCalledWith(
      services,
      { taskId },
      { bytes, mimeType: "audio/webm", locale: "pl-PL" },
      expect.any(AbortSignal),
    );
  });

  it("dictation z content-length ponad limit nagrania pada przed use case'em", async () => {
    const response = await call(`/tasks/${taskId}/dictation`, {
      method: "POST",
      body: recordingForm(new Uint8Array([1, 2, 3]), { withClientAttemptId: false }),
      headers: { "content-length": String(MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES + 1) },
    });

    expect(response.status).toBe(400);
    expect(ApiErrorSchema.parse(await response.json()).code).toBe("validation");
    expect(dictateLessonAnswer).not.toHaveBeenCalled();
  });

  it("attempts multipart bez clientAttemptId daje validation", async () => {
    const response = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(new Uint8Array([1, 2, 3]), { withClientAttemptId: false }),
    });

    expect(response.status).toBe(400);
    const body = ApiErrorSchema.parse(await response!.json());
    expect(body.code).toBe("validation");
    expect(submitSpeechAttempt).not.toHaveBeenCalled();
  });

  it("mutacje zadań z obcym Origin kończą się forbidden/403 bez wywołania przypadków użycia", async () => {
    const evil = { origin: "http://evil.example" };
    const eventsResponse = await call(`/tasks/${taskId}/events`, {
      method: "POST",
      body: JSON.stringify({ clientEventId, kind: "display_confirmed" }),
      headers: { "content-type": "application/json", ...evil },
    });
    const attemptsResponse = await call(`/tasks/${taskId}/attempts`, {
      method: "POST",
      body: recordingForm(new Uint8Array([1, 2, 3])),
      headers: evil,
    });

    for (const [label, response] of [
      ["events", eventsResponse],
      ["attempts", attemptsResponse],
    ] as const) {
      expect(response.status, label).toBe(403);
      const body = ApiErrorSchema.parse(await response!.json());
      expect(body.code, label).toBe("forbidden");
    }
    expect(recordEvent).not.toHaveBeenCalled();
    expect(submitSpeechAttempt).not.toHaveBeenCalled();
  });
});
