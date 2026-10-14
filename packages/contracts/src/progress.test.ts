import { describe, expect, it } from "vitest";
import { ActivityDailyStatDtoSchema, ActivitySummaryDtoSchema } from "./progress";

describe("ActivitySummaryDtoSchema with daily breakdown", () => {
  it("akceptuje podsumowanie z 7-elementową tablicą daily", () => {
    const valid = {
      days: 7,
      activeSeconds: 300,
      activeDays: 2,
      sessions: 3,
      answers: 20,
      interactions: 45,
      decks: [{ deckId: "00000000-0000-4000-8000-000000000001", deckTitle: "Zestaw 1", sessions: 3 }],
      daily: [
        { date: "2026-10-08", activeSeconds: 0, sessions: 0 },
        { date: "2026-10-09", activeSeconds: 120, sessions: 1 },
        { date: "2026-10-10", activeSeconds: 0, sessions: 0 },
        { date: "2026-10-11", activeSeconds: 180, sessions: 2 },
        { date: "2026-10-12", activeSeconds: 0, sessions: 0 },
        { date: "2026-10-13", activeSeconds: 0, sessions: 0 },
        { date: "2026-10-14", activeSeconds: 0, sessions: 0 },
      ],
    };

    const parsed = ActivitySummaryDtoSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("odrzuca payload bez pola daily", () => {
    const missingDaily = {
      days: 7,
      activeSeconds: 0,
      activeDays: 0,
      sessions: 0,
      answers: 0,
      interactions: 0,
      decks: [],
    };

    const parsed = ActivitySummaryDtoSchema.safeParse(missingDaily);
    expect(parsed.success).toBe(false);
  });

  it("odrzuca wpis daily z ujemnym czasem lub niepoprawną datą", () => {
    expect(ActivityDailyStatDtoSchema.safeParse({ date: "2026-10-14", activeSeconds: -10, sessions: 1 }).success).toBe(false);
    expect(ActivityDailyStatDtoSchema.safeParse({ date: "nie-data", activeSeconds: 60, sessions: 1 }).success).toBe(false);
    expect(ActivityDailyStatDtoSchema.safeParse({ date: "2026-10-14", activeSeconds: 60, sessions: -1 }).success).toBe(false);
  });
});
