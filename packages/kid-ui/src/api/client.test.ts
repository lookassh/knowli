import { describe, expect, it, vi } from "vitest";
import { createKidApiClient, KidApiError } from "./client";

// Skan plików modułu przez Vite (transform zastępuje glob w teście) — pakiet
// kompiluje się bez typów Node (tsconfig „types”: []), więc node:fs odpada.
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string }): Record<string, string>;
  }
}

// Serwer oRPC zawsze oznacza koperty JSON nagłówkiem content-type — link
// klienta rozstrzyga format ciała odpowiedzi po nim (bez niego traktuje
// odpowiedź jako strumień/bajty, nie JSON).
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const noContent = () => new Response(null, { status: 204 });

const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const DECK_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "66666666-6666-4666-8666-666666666666";

const deck = { deckId: DECK_ID, title: "Zwierzęta", itemCount: 3, independentlyRecalledCount: 0, testDate: null, recommended: false };

const attempt = {
  attemptId: "77777777-7777-4777-8777-777777777777",
  taskId: TASK_ID,
  state: "completed",
  modality: "audio",
  feedback: null,
  taskState: "answered",
  stepId: null,
  receivedAt: "2026-10-23T10:00:00.000Z",
  completedAt: "2026-10-23T10:00:02.000Z",
};

const task = {
  taskId: TASK_ID,
  sessionId: SESSION_ID,
  ordinal: 0,
  exerciseType: "exposure",
  direction: "source_to_target",
  state: "issued",
  prompt: {
    kind: "exposure",
    source: "cat",
    target: "kot",
    example: null,
    audioAssetId: null,
    exampleAudioAssetId: null,
    imageAssetId: null,
  },
  remainingAssessed: 3,
};

const session = {
  mode: "training",
  sessionId: SESSION_ID,
  childId: CHILD_ID,
  deckId: DECK_ID,
  deckVersionId: "44444444-4444-4444-8444-444444444444",
  policyId: "learning-v1",
  microphoneEnabled: true,
  canRead: true,
  vocabularyFormat: "standard",
  state: "active",
  taskBudget: 5,
  tasksIssued: 0,
  assessedTasksIssued: 0,
  startedAt: "2026-10-23T10:00:00.000Z",
  resumed: false,
};

describe("Kid API picture support transport", () => {
  it("bounds hanging session-end transport (single LLM review) and aborts the request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined));
      const api = createKidApiClient({ fetchImpl });
      const pending = api.endSession(SESSION_ID);
      const assertion = expect(pending).rejects.toBeInstanceOf(TypeError);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it("bounds ordinary reads with the default 30 s budget (not the 45 s end budget)", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined));
      const api = createKidApiClient({ fetchImpl });
      const pending = api.readUiAudio();
      const assertion = expect(pending).rejects.toBeInstanceOf(TypeError);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it("sends the frozen activity report once with the session-end request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({
      sessionId: SESSION_ID, state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
      endedAt: "2026-10-16T10:00:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
      activity: { status: "evaluated", pointsAwarded: 7, errorCode: null },
    }));
    const api = createKidApiClient({ fetchImpl });
    const report = {
      version: 1, elapsedMs: 90_000, activeMs: 0, compacted: false, tasks: [],
    };
    await expect(api.endSession(SESSION_ID, report as never)).resolves.toMatchObject({
      activity: { status: "evaluated", pointsAwarded: 7 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/v1/kid/sessions/${SESSION_ID}/end`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ activityReport: report }),
    }));
  });

  it("reads every valid durable activity status and rejects malformed status responses", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: "evaluated", pointsAwarded: 3, errorCode: null }))
      .mockResolvedValueOnce(response({ status: "error", pointsAwarded: 0, errorCode: "review_failed" }))
      .mockResolvedValueOnce(response({ status: "already_started", pointsAwarded: 0, errorCode: null }))
      .mockResolvedValueOnce(response({ status: "pending", pointsAwarded: 0, errorCode: null }));
    const api = createKidApiClient({ baseUrl: "https://umiem.test/", fetchImpl });

    await expect(api.readSessionActivityResult!(SESSION_ID)).resolves.toEqual({ status: "evaluated", pointsAwarded: 3, errorCode: null });
    await expect(api.readSessionActivityResult!(SESSION_ID)).resolves.toEqual({ status: "error", pointsAwarded: 0, errorCode: "review_failed" });
    await expect(api.readSessionActivityResult!(SESSION_ID)).resolves.toEqual({ status: "already_started", pointsAwarded: 0, errorCode: null });
    await expect(api.readSessionActivityResult!(SESSION_ID)).rejects.toMatchObject({ code: "internal" });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://umiem.test/api/v1/kid/sessions/${SESSION_ID}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${SESSION_ID}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${SESSION_ID}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${SESSION_ID}/activity-result`,
    ]);
  });

  it("reads the validated spoken-guidance catalog and disables the session microphone", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ready: true, assets: { profile_select: SESSION_ID } }))
      .mockResolvedValueOnce(response({ ...session, microphoneEnabled: false }));
    const api = createKidApiClient({ fetchImpl });

    await expect(api.readUiAudio()).resolves.toMatchObject({ ready: true, assets: { profile_select: expect.any(String) } });
    await expect(api.disableMicrophone("55555555-5555-4555-8555-555555555555")).resolves.toMatchObject({ microphoneEnabled: false });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/kid/ui-audio",
      "/api/v1/kid/sessions/55555555-5555-4555-8555-555555555555/disable-microphone",
    ]);
  });

  it("lists decks under the kid prefix with childId and stringbool microphoneEnabled on the wire", async () => {
    // Świeża odpowiedź per żądanie — ciało Response można odczytać tylko raz.
    const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(response([deck])));
    const api = createKidApiClient({ baseUrl: "https://umiem.test", fetchImpl });

    await expect(api.listDecks(CHILD_ID, { microphoneEnabled: true })).resolves.toEqual([
      expect.objectContaining({ deckId: DECK_ID, title: "Zwierzęta" }),
    ]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://umiem.test/api/v1/kid/decks?childId=${CHILD_ID}&microphoneEnabled=true`,
    );

    await expect(api.listDecks(CHILD_ID)).resolves.toHaveLength(1);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(`https://umiem.test/api/v1/kid/decks?childId=${CHILD_ID}`);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("GET");
  });

  it("unwraps the detailed next-task response: 204 ends the session, 200 issues a task", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(task))
      .mockResolvedValueOnce(noContent());
    const api = createKidApiClient({ fetchImpl });

    await expect(api.nextTask(SESSION_ID)).resolves.toMatchObject({ taskId: TASK_ID, prompt: { kind: "exposure", target: "kot" } });
    await expect(api.nextTask(SESSION_ID)).resolves.toBeNull();
    const calls = fetchImpl.mock.calls.map(([url, init]) => [String(url), init?.method]);
    expect(calls).toEqual([
      [`/api/v1/kid/sessions/${SESSION_ID}/next`, "POST"],
      [`/api/v1/kid/sessions/${SESSION_ID}/next`, "POST"],
    ]);
  });

  it("sends text attempts as JSON without duplicating the path taskId in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...attempt, modality: "text" }));
    const api = createKidApiClient({ fetchImpl });

    await api.submitAnswer({
      taskId: TASK_ID,
      clientAttemptId: "88888888-8888-4888-8888-888888888888",
      modality: "text",
      text: "cat",
    } as never);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/kid/tasks/${TASK_ID}/attempts`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      clientAttemptId: "88888888-8888-4888-8888-888888888888",
      modality: "text",
      text: "cat",
    });
  });

  it("sends spoken attempts as multipart with the recording file and idempotency key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...attempt, state: "processing", completedAt: null }, 202));
    const api = createKidApiClient({ fetchImpl });

    await expect(api.submitSpeech(TASK_ID, "88888888-8888-4888-8888-888888888888", {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/webm",
    })).resolves.toMatchObject({ state: "processing", modality: "audio" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`/api/v1/kid/tasks/${TASK_ID}/attempts`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("clientAttemptId")).toBe("88888888-8888-4888-8888-888888888888");
    // taskId idzie w ścieżce — multipart go nie dubluje (jak JSON w submitAnswer).
    expect(form.has("taskId")).toBe(false);
    const audio = form.get("audio");
    expect(audio).toBeInstanceOf(File);
    expect((audio as File).name).toBe("recording.webm");
    expect((audio as File).type).toBe("audio/webm");
    // multipartu nie wolno oznaczać content-type ręcznie — granicznik dodaje przeglądarka
    expect(new Headers(init?.headers).get("content-type")).toBeNull();
  });

  it("preserves known validation reasons from HTTP details and ignores unknown details", async () => {
    const reasons = ["picture_client_update_required", "vocabulary_requires_reading", "non_reader_mock_test_unavailable", "picture_guidance_unavailable", "picture_audio_unavailable", "activity_report_update_required"];
    const fetchImpl = vi.fn();
    for (const reason of reasons) fetchImpl.mockResolvedValueOnce(response({ code: "validation", message: "validation", retryable: false, details: { reason } }, 422));
    fetchImpl.mockResolvedValueOnce(response({ code: "validation", message: "validation", retryable: false, details: { reason: "future_reason" } }, 422));
    fetchImpl.mockResolvedValueOnce(response({ code: "validation", message: "validation", retryable: false }, 422));
    const api = createKidApiClient({ fetchImpl });
    for (const expected of [...reasons, undefined, undefined]) {
      try {
        await api.readUiAudio();
        throw new Error("expected HTTP error");
      } catch (error) {
        expect(error).toBeInstanceOf(KidApiError);
        expect((error as KidApiError).reason).toBe(expected);
      }
    }
  });

  it("normalizes the shared error envelope into KidApiError with code and retryable", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ code: "rate_limited", message: "…", retryable: true, requestId: "r1" }, 429))
      .mockResolvedValueOnce(response({ code: "not_found", message: "…", retryable: false, requestId: "r2" }, 404))
      .mockResolvedValueOnce(new Response("gateway broke", { status: 502, headers: { "content-type": "text/plain" } }));
    const api = createKidApiClient({ fetchImpl });

    await expect(api.readAttempt("99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({
      code: "rate_limited", retryable: true,
    });
    await expect(api.readAttempt("99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({
      code: "not_found", retryable: false,
    });
    // Ciało błędu poza kopertą (np. proxy) nie może ujawniać typu transportu — spada do internal.
    await expect(api.readAttempt("99999999-9999-4999-8999-999999999999")).rejects.toMatchObject({
      code: "internal", retryable: false,
    });
  });

  it("sends JSON bodies with an explicit content-type (oRPC parses only declared JSON)", async () => {
    // Router oRPC czyta ciało JSON wyłącznie po nagłówku content-type — bez
    // niego fetch domyślnie oznacza ciało tekstowe jako text/plain i serwer
    // dostaje File zamiast obiektu (e2e kid-flow: create → 400). Legacy
    // readJson tolerował brak nagłówka; link ustawia go przez standard-server.
    const fetchImpl = vi.fn().mockResolvedValue(response(session));
    const api = createKidApiClient({ fetchImpl });

    await api.startSession({
      childId: CHILD_ID,
      deckId: DECK_ID,
      microphoneEnabled: true,
      supportsPictureVocabulary: false,
      supportsPictureRecognition: false,
    } as never);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("/api/v1/kid/sessions");
    expect(init?.method).toBe("POST");
    expect(init?.body).toEqual(JSON.stringify({
      childId: CHILD_ID,
      deckId: DECK_ID,
      microphoneEnabled: true,
      supportsPictureVocabulary: false,
      supportsPictureRecognition: false,
    }));
    const headers = init?.headers instanceof Headers ? init.headers : new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("keeps media URLs on the shared origin-relative media route", () => {
    const api = createKidApiClient({ baseUrl: "https://umiem.test/" });
    expect(api.mediaUrl("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "https://umiem.test/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(createKidApiClient({}).mediaUrl("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "/api/v1/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });
});

describe("kid-ui API boundary (portable client)", () => {
  /** Import wzbroniony w przenośnym kliencie: serwer oRPC, Next.js i domena serwera. */
  const FORBIDDEN_IMPORT = /from\s+["'](?:@orpc\/server(?:\/[^"']*)?|next(?:\/[^"']*)?|@learning\/server(?:\/[^"']*)?)["']/;

  it("api modules import neither @orpc/server, Next.js nor @learning/server", () => {
    const modules = import.meta.glob("./*.ts", { query: "?raw", import: "default" });
    const files = Object.entries(modules)
      .filter(([path]) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
    // Dowód, że glob widzi pliki modułu (nie fałszywie zielony).
    expect(files.map(([path]) => path).sort()).toEqual(["./KidApi.ts", "./client.ts"]);

    const offenders = files.filter(([, source]) => FORBIDDEN_IMPORT.test(source)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("regex wykrywa wzbroniony import (dowód czułości testu)", () => {
    expect(FORBIDDEN_IMPORT.test('import { os } from "@orpc/server";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { OpenAPIHandler } from "@orpc/server/fetch";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import Link from "next/link";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { x } from "@learning/server/domain";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { OpenAPILink } from "@orpc/openapi/fetch";')).toBe(false);
    expect(FORBIDDEN_IMPORT.test('import { createORPCClient } from "@orpc/client";')).toBe(false);
    expect(FORBIDDEN_IMPORT.test('import { z } from "@learning/contracts";')).toBe(false);
  });
});
