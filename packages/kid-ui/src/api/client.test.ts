import { describe, expect, it, vi } from "vitest";
import { createKidApiClient, KidApiError } from "./client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Kid API picture support transport", () => {
  it("bounds hanging session-end transport (single LLM review) and aborts the request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>(() => undefined));
      const api = createKidApiClient({ fetchImpl });
      const pending = api.endSession("11111111-1111-4111-8111-111111111111");
      const assertion = expect(pending).rejects.toBeInstanceOf(TypeError);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      await assertion;
    } finally { vi.useRealTimers(); }
  });

  it("sends the frozen activity report once with the session-end request", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = vi.fn().mockResolvedValue(response({
      sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
      endedAt: "2026-10-16T10:00:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
      activity: { status: "evaluated", pointsAwarded: 7, errorCode: null },
    }));
    const api = createKidApiClient({ fetchImpl });
    const report = {
      version: 1, elapsedMs: 90_000, activeMs: 0, compacted: false, tasks: [],
    };
    await expect(api.endSession(sessionId, report as never)).resolves.toMatchObject({
      activity: { status: "evaluated", pointsAwarded: 7 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/v1/kid/sessions/${sessionId}/end`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ activityReport: report }),
    }));
  });

  it("reads every valid durable activity status and rejects malformed status responses", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: "evaluated", pointsAwarded: 3, errorCode: null }))
      .mockResolvedValueOnce(response({ status: "error", pointsAwarded: 0, errorCode: "review_failed" }))
      .mockResolvedValueOnce(response({ status: "already_started", pointsAwarded: 0, errorCode: null }))
      .mockResolvedValueOnce(response({ status: "pending", pointsAwarded: 0, errorCode: null }));
    const api = createKidApiClient({ baseUrl: "https://umiem.test/", fetchImpl });

    await expect(api.readSessionActivityResult!(sessionId)).resolves.toEqual({ status: "evaluated", pointsAwarded: 3, errorCode: null });
    await expect(api.readSessionActivityResult!(sessionId)).resolves.toEqual({ status: "error", pointsAwarded: 0, errorCode: "review_failed" });
    await expect(api.readSessionActivityResult!(sessionId)).resolves.toEqual({ status: "already_started", pointsAwarded: 0, errorCode: null });
    await expect(api.readSessionActivityResult!(sessionId)).rejects.toMatchObject({ code: "internal" });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://umiem.test/api/v1/kid/sessions/${sessionId}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${sessionId}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${sessionId}/activity-result`,
      `https://umiem.test/api/v1/kid/sessions/${sessionId}/activity-result`,
    ]);
  });

  it("reads the validated spoken-guidance catalog and disables the session microphone", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ready: true, assets: { profile_select: "11111111-1111-4111-8111-111111111111" } }))
      .mockResolvedValueOnce(response({ mode: "training", sessionId: "11111111-1111-4111-8111-111111111111", childId: "22222222-2222-4222-8222-222222222222", deckId: "33333333-3333-4333-8333-333333333333", deckVersionId: "44444444-4444-4444-8444-444444444444", policyId: "learning-v1", microphoneEnabled: false, canRead: false, vocabularyFormat: "picture", state: "active", taskBudget: 5, tasksIssued: 0, assessedTasksIssued: 0, startedAt: "2026-10-14T10:00:00.000Z", resumed: true }));
    const api = createKidApiClient({ fetchImpl });

    await expect(api.readUiAudio()).resolves.toMatchObject({ ready: true, assets: { profile_select: expect.any(String) } });
    await expect(api.disableMicrophone("55555555-5555-4555-8555-555555555555")).resolves.toMatchObject({ microphoneEnabled: false });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/v1/kid/ui-audio",
      "/api/v1/kid/sessions/55555555-5555-4555-8555-555555555555/disable-microphone",
    ]);
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

  it("sends JSON bodies with an explicit content-type (oRPC parses only declared JSON)", async () => {
    // Router oRPC czyta ciało JSON wyłącznie po nagłówku content-type — bez
    // niego fetch domyślnie oznacza ciało tekstowe jako text/plain i serwer
    // dostaje File zamiast obiektu (e2e kid-flow: create → 400). Legacy
    // readJson tolerował brak nagłówka; klient musi go deklarować jawnie.
    const fetchImpl = vi.fn().mockResolvedValue(response({
      mode: "training", sessionId: "11111111-1111-4111-8111-111111111111",
      childId: "22222222-2222-4222-8222-222222222222", deckId: "33333333-3333-4333-8333-333333333333",
      deckVersionId: "44444444-4444-4444-8444-444444444444", policyId: "learning-v1",
      microphoneEnabled: true, canRead: true, vocabularyFormat: "standard", state: "active",
      taskBudget: 5, tasksIssued: 0, assessedTasksIssued: 0, startedAt: "2026-10-23T10:00:00.000Z", resumed: false,
    }));
    const api = createKidApiClient({ fetchImpl });

    await api.startSession({
      childId: "22222222-2222-4222-8222-222222222222",
      deckId: "33333333-3333-4333-8333-333333333333",
      microphoneEnabled: true,
      supportsPictureVocabulary: false,
      supportsPictureRecognition: false,
    } as never);

    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/kid/sessions", expect.objectContaining({
      method: "POST",
      body: expect.any(String),
      headers: { "content-type": "application/json" },
    }));
  });
});
