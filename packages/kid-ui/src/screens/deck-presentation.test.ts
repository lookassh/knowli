import { describe, expect, it } from "vitest";
import type { KidDeckDto } from "@learning/contracts";
import { formatDeckTestDate, groupDecks } from "./deck-presentation";

function deck(id: string, recommended: boolean, testDate: string | null = null): KidDeckDto {
  return {
    deckId: `10000000-0000-4000-8000-${id.padStart(12, "0")}`,
    title: `Zestaw ${id}`,
    itemCount: 4,
    independentlyRecalledCount: 2,
    testDate,
    recommended,
    mockTestAvailable: false,
    activeSession: null,
  };
}

describe("groupDecks", () => {
  it("groups recommended decks before others and preserves API order", () => {
    const input = [deck("01", false), deck("02", true), deck("03", false), deck("04", true)];

    expect(groupDecks(input)).toEqual({
      recommended: [input[1], input[3]],
      other: [input[0], input[2]],
    });
  });

  it("returns empty groups for an empty deck list", () => {
    expect(groupDecks([])).toEqual({ recommended: [], other: [] });
  });

  it("keeps a pure split when every deck is recommended", () => {
    const input = [deck("01", true), deck("02", true)];
    expect(groupDecks(input)).toEqual({ recommended: input, other: [] });
  });
});

describe("formatDeckTestDate", () => {
  it("formats the calendar day without shifting it between time zones", () => {
    const nodeProcess = Reflect.get(globalThis, "process") as { env: Record<string, string | undefined> };
    const previousTimeZone = nodeProcess.env.TZ;
    try {
      nodeProcess.env.TZ = "America/Los_Angeles";
      const west = formatDeckTestDate("2026-10-23", 2026);
      nodeProcess.env.TZ = "Europe/Warsaw";
      const east = formatDeckTestDate("2026-10-23", 2026);
      expect(west).toBe("23 paź");
      expect(east).toBe(west);
    } finally {
      if (previousTimeZone === undefined) delete nodeProcess.env.TZ;
      else nodeProcess.env.TZ = previousTimeZone;
    }
  });

  it("omits the current year and shows a different year", () => {
    expect(formatDeckTestDate("2026-10-23", 2026)).toBe("23 paź");
    expect(formatDeckTestDate("2025-10-23", 2026)).toBe("23 paź 2025");
  });

  it("handles leap day and omits missing or invalid dates", () => {
    expect(formatDeckTestDate("2024-02-29", 2024)).toBe("29 lut");
    expect(formatDeckTestDate(null, 2024)).toBeNull();
    expect(formatDeckTestDate("2025-02-29", 2025)).toBeNull();
    expect(formatDeckTestDate("2026-13-01", 2026)).toBeNull();
    expect(formatDeckTestDate("2026-1-01", 2026)).toBeNull();
  });
});
