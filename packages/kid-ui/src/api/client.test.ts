import { describe, expect, it, vi } from "vitest";
import { createKidApiClient, KidApiError } from "./client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Kid API picture support transport", () => {
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
    const reasons = ["picture_client_update_required", "vocabulary_requires_reading", "non_reader_mock_test_unavailable", "picture_guidance_unavailable", "picture_audio_unavailable"];
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
});
