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
    const now = new Date(2026, 9, 14, 18, 0);
    expect(formatHistoryWhen(new Date(2026, 9, 14, 17, 9).toISOString(), now)).toBe("dziś, 17:09");
    expect(formatHistoryWhen(new Date(2026, 9, 13, 18, 44).toISOString(), now)).toBe("wczoraj, 18:44");
    expect(formatHistoryWhen(new Date(2026, 9, 12, 17, 3).toISOString(), now)).toBe("12.10.2026");
  });

  it("przełom północy: wcześniejszy dzień to wczoraj", () => {
    const now = new Date(2026, 9, 15, 2, 30);
    const sameLocalDay = new Date(2026, 9, 15, 0, 10);
    const previousLocalDay = new Date(2026, 9, 14, 23, 50);
    expect(formatHistoryWhen(sameLocalDay.toISOString(), now)).toBe("dziś, 00:10");
    expect(formatHistoryWhen(previousLocalDay.toISOString(), now)).toBe("wczoraj, 23:50");
  });
});
