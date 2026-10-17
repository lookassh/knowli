import { describe, expect, it } from "vitest";
import { ParentWorkCardDtoSchema, ParentWorkCardQuerySchema } from "./parent-work-card";

const id = "00000000-0000-4000-8000-000000000001";

describe("parent work card contract", () => {
  it("accepts a child/date query and rejects malformed dates and extra fields", () => {
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "2026-10-16" }).success).toBe(true);
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "16.10.2026" }).success).toBe(false);
    expect(ParentWorkCardQuerySchema.safeParse({ childId: id, date: "2026-10-16", token: "secret" }).success).toBe(false);
  });

  it("keeps round status separate and rejects private raw fields", () => {
    const report = { childId: id, date: "2026-10-16", creditedSeconds: 0, sessions: [], xboxRequests: [],
      dailyRound: { state: null, sessionId: null, deckTitle: null, steps: null, answered: null } };
    expect(ParentWorkCardDtoSchema.safeParse(report).success).toBe(true);
    expect(ParentWorkCardDtoSchema.safeParse({ ...report, token: "secret" }).success).toBe(false);
  });

  it("accepts only a bounded parent Xbox request snapshot", () => {
    const snapshot = { requestId: id, requestedAt: "2026-10-16T10:00:00.000Z", timezone: "Europe/Warsaw",
      localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 };
    const report = { childId: id, date: "2026-10-16", creditedSeconds: 0, sessions: [],
      xboxRequests: [{ ...snapshot, status: "pending" as const }],
      dailyRound: { state: null, sessionId: null, deckTitle: null, steps: null, answered: null } };
    expect(ParentWorkCardDtoSchema.safeParse(report).success).toBe(true);
    expect(ParentWorkCardDtoSchema.safeParse({ ...report, xboxRequests: [{ ...report.xboxRequests[0], microsoftToken: "secret" }] }).success).toBe(false);
    expect(ParentWorkCardDtoSchema.safeParse({ ...report, xboxRequests: [{ ...report.xboxRequests[0], pointsCost: 31 }] }).success).toBe(false);
    for (const status of ["fulfilled", "rejected"] as const) {
      expect(ParentWorkCardDtoSchema.safeParse({ ...report, xboxRequests: [{ ...snapshot, status }] }).success).toBe(true);
    }
  });
});
