import { describe, expect, it } from "vitest";
import type { HistoryEntryDto, ProgressItemDto } from "@learning/contracts";
import { dueEntries, formatHistoryWhen } from "./progress-lists";

function item(status: ProgressItemDto["skills"]["recall"], target = "word"): ProgressItemDto {
  return {
    itemId: `id-${target}`,
    position: 0,
    source: "słowo",
    target,
    meaningChanged: false,
    skills: {
      listening: "not_assessed",
      reading: "not_assessed",
      recall: status,
      pronunciation: "not_assessed",
      spelling: "not_assessed",
    },
  };
}

describe("dueEntries", () => {
  it("zwraca parę skill+target tylko dla należnych statusów, w kolejności wejścia", () => {
    const entries = dueEntries([
      item("mastered", "one"),
      item("practicing", "two"),
      item("needs_reconfirmation", "three"),
      item("needs_confirmation", "four"),
      item("not_assessed", "five"),
    ]);
    expect(entries).toEqual([
      { skill: "recall", target: "two" },
      { skill: "recall", target: "three" },
    ]);
  });
});

describe("formatHistoryWhen", () => {
  it("dziś i wczoraj z godziną, wcześniej samą datą", () => {
    const now = new Date("2026-10-14T18:00:00Z");
    expect(formatHistoryWhen("2026-10-14T17:09:00Z", now)).toBe("dziś, 17:09");
    expect(formatHistoryWhen("2026-10-13T18:44:00Z", now)).toBe("wczoraj, 18:44");
    expect(formatHistoryWhen("2026-10-12T17:03:00Z", now)).toBe("12.10.2026");
  });

  it("przełom północy: wcześniejszy dzień to wczoraj", () => {
    const now = new Date("2026-10-14T00:30:00Z");
    expect(formatHistoryWhen("2026-10-13T22:10:00Z", now)).toBe("wczoraj, 22:10");
    expect(formatHistoryWhen("2026-10-14T00:10:00Z", now)).toBe("dziś, 00:10");
  });
});
