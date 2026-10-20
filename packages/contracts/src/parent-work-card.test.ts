import { describe, expect, it } from "vitest";
import { ParentWorkCardDtoSchema, ParentWorkCardQuerySchema } from "./parent-work-card";

const id = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";

function cardWith(sessions: unknown[], overrides: Record<string, unknown> = {}) {
  return { childId: id, date: "2026-10-16", creditedSeconds: 0, unevaluatedSessions: 0, sessions, ...overrides };
}

const evaluatedSession = {
  sessionId: id, mode: "training", state: "completed",
  startedAt: "2026-10-16T10:00:00.000Z", endedAt: "2026-10-16T10:05:00.000Z",
  deckTitle: "Dni", deckVersionNumber: 1, remainingSteps: 0,
  activity: {
    status: "evaluated", durationSeconds: 300, activeSeconds: 240, approvedSeconds: 180,
    pointsAwarded: 3, reason: "Rzeczywiste próby.", errorCode: null,
    excludedTasks: [{ taskOrdinal: 1, reason: "Powtarzane aaa." }],
  },
  steps: [{ taskId, ordinal: 0, exerciseType: "recall", state: "answered", issuedAt: "2026-10-16T10:00:05.000Z", responses: [] }],
};

describe("parent work card contract", () => {
  it("accepts a child/date query and rejects malformed dates and extra fields", () => {
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "2026-10-16" }).success).toBe(true);
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "16.10.2026" }).success).toBe(false);
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "2026-10-16", token: "secret" }).success).toBe(false);
  });

  it("carries the session activity result and rejects private raw fields", () => {
    expect(ParentWorkCardDtoSchema.safeParse(cardWith([evaluatedSession])).success).toBe(true);
    expect(ParentWorkCardDtoSchema.safeParse({ ...cardWith([evaluatedSession]), token: "secret" }).success).toBe(false);
    expect(ParentWorkCardDtoSchema.safeParse({ ...cardWith([evaluatedSession]), xboxRequests: [] }).success).toBe(false);
    // Retencja: szczegóły wykluczeń znikają po 7 dniach — pole robi się null.
    const expired = { ...evaluatedSession, activity: { ...evaluatedSession.activity, excludedTasks: null } };
    expect(ParentWorkCardDtoSchema.safeParse(cardWith([expired])).success).toBe(true);
    // Brak raportu to jawny status, nie zero zatwierdzonej aktywności.
    const notDelivered = { ...evaluatedSession, activity: { ...evaluatedSession.activity, status: "not_delivered", approvedSeconds: 0, pointsAwarded: 0, reason: null, excludedTasks: null } };
    expect(ParentWorkCardDtoSchema.safeParse(cardWith([notDelivered])).success).toBe(true);
    expect(ParentWorkCardDtoSchema.safeParse(cardWith([{ ...evaluatedSession, activity: { ...evaluatedSession.activity, status: "weird" } }])).success).toBe(false);
  });
});
