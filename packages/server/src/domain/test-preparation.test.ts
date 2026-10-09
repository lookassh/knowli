import { describe, expect, it } from "vitest";
import { isTestPreparationWindow } from "./test-preparation";

describe("isTestPreparationWindow", () => {
  it("opens exactly 48 hours before the local start of the test date", () => {
    expect(isTestPreparationWindow({
      now: "2026-10-08T22:00:00.000Z",
      testDate: "2026-10-11",
      timezone: "Europe/Warsaw",
    })).toBe(true);
    expect(isTestPreparationWindow({
      now: "2026-10-08T21:59:59.999Z",
      testDate: "2026-10-11",
      timezone: "Europe/Warsaw",
    })).toBe(false);
  });

  it("uses the local midnight offset across the autumn DST change", () => {
    expect(isTestPreparationWindow({
      now: "2026-10-23T22:00:00.000Z",
      testDate: "2026-10-26",
      timezone: "Europe/Warsaw",
    })).toBe(false);
    expect(isTestPreparationWindow({
      now: "2026-10-23T23:00:00.000Z",
      testDate: "2026-10-26",
      timezone: "Europe/Warsaw",
    })).toBe(true);
  });

  it("stays active for the full local test day and closes at the next local midnight", () => {
    expect(isTestPreparationWindow({
      now: "2026-10-25T12:00:00.000Z",
      testDate: "2026-10-25",
      timezone: "Europe/Warsaw",
    })).toBe(true);
    expect(isTestPreparationWindow({
      now: "2026-10-25T22:59:59.999Z",
      testDate: "2026-10-25",
      timezone: "Europe/Warsaw",
    })).toBe(true);
    expect(isTestPreparationWindow({
      now: "2026-10-25T23:00:00.000Z",
      testDate: "2026-10-25",
      timezone: "Europe/Warsaw",
    })).toBe(false);
  });

  it("handles spring DST, UTC, past dates, and absent dates", () => {
    expect(isTestPreparationWindow({
      now: "2027-03-26T22:00:00.000Z",
      testDate: "2027-03-29",
      timezone: "Europe/Warsaw",
    })).toBe(true);
    expect(isTestPreparationWindow({
      now: "2027-03-26T21:59:59.999Z",
      testDate: "2027-03-29",
      timezone: "Europe/Warsaw",
    })).toBe(false);
    expect(isTestPreparationWindow({
      now: "2026-10-08T00:00:00.000Z",
      testDate: "2026-10-10",
      timezone: "UTC",
    })).toBe(true);
    expect(isTestPreparationWindow({
      now: "2026-10-12T00:00:00.000Z",
      testDate: "2026-10-11",
      timezone: "Europe/Warsaw",
    })).toBe(false);
    expect(isTestPreparationWindow({
      now: "2026-10-08T00:00:00.000Z",
      testDate: null,
      timezone: "Europe/Warsaw",
    })).toBe(false);
  });

  it("ignores malformed dates, instants, and time zones", () => {
    for (const input of [
      { now: "not-a-date", testDate: "2026-10-11", timezone: "Europe/Warsaw" },
      { now: "2026-10-08T00:00:00Z", testDate: "2026-02-30", timezone: "Europe/Warsaw" },
      { now: "2026-10-08T00:00:00Z", testDate: "10/11/2026", timezone: "Europe/Warsaw" },
      { now: "2026-10-08T00:00:00Z", testDate: "2026-10-11", timezone: "Invalid/Zone" },
    ]) {
      expect(isTestPreparationWindow(input)).toBe(false);
    }
  });
});
