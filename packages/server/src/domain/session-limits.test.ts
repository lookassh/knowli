import { describe, expect, it } from "vitest";
import { RESUME_WINDOW_MS, SESSION_TIME_LIMIT_MS, sessionTimeLimitMs } from "./session-limits";

describe("limity czasu sesji", () => {
  it("zachowuje stałe okna wznowienia i minimalnego limitu", () => {
    expect(RESUME_WINDOW_MS).toBe(30 * 60_000);
    expect(SESSION_TIME_LIMIT_MS).toBe(10 * 60_000);
  });

  it.each([
    [0, 10 * 60_000],
    [13, 10 * 60_000],
    [14, 14 * 45_000],
    [20, 15 * 60_000],
    [40, 30 * 60_000],
  ])("budżet %i daje limit %i ms", (taskBudget, expectedMs) => {
    expect(sessionTimeLimitMs(taskBudget)).toBe(expectedMs);
  });
});
