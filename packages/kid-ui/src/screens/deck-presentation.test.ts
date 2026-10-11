import { describe, expect, it } from "vitest";
import type { KidDeckDto } from "@learning/contracts";
import { buildDeckPages, clampDeckPageIndex, formatDeckTestDate } from "./deck-presentation";

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

describe("buildDeckPages", () => {
  it("groups recommended decks before others and preserves API order", () => {
    const input = [deck("01", false), deck("02", true), deck("03", false), deck("04", true)];

    expect(buildDeckPages(input, 2)).toEqual([
      { kind: "recommended", decks: [input[1], input[3]] },
      { kind: "other", decks: [input[0], input[2]] },
    ]);
  });

  it.each([
    { count: 0, expected: [] },
    { count: 1, expected: [{ kind: "recommended", decks: [0] }] },
    { count: 2, expected: [{ kind: "recommended", decks: [0] }, { kind: "recommended", decks: [1] }] },
    { count: 4, expected: [{ kind: "recommended", decks: [0] }, { kind: "recommended", decks: [1] }, { kind: "recommended", decks: [2] }, { kind: "recommended", decks: [3] }] },
  ])("keeps $count decks reachable with one card per mobile page", ({ count, expected }) => {
    const input = Array.from({ length: count }, (_, index) => deck(String(index), true));
    const pages = buildDeckPages(input, 1);
    expect(pages).toHaveLength(expected.length);
    expect(pages.flatMap((page) => page.decks)).toHaveLength(input.length);
    expect(pages.map((page) => page.decks.map((item) => input.indexOf(item)))).toEqual(expected.map((page) => page.decks));
  });

  it("does not combine two groups on the same page", () => {
    expect(buildDeckPages([deck("01", true), deck("02", false)], 2)).toEqual([
      { kind: "recommended", decks: [expect.objectContaining({ recommended: true })] },
      { kind: "other", decks: [expect.objectContaining({ recommended: false })] },
    ]);
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

describe("clampDeckPageIndex", () => {
  it("keeps the current page in range after the page list shrinks", () => {
    expect(clampDeckPageIndex(3, 2)).toBe(1);
    expect(clampDeckPageIndex(1, 0)).toBe(0);
    expect(clampDeckPageIndex(-2, 4)).toBe(0);
  });
});
