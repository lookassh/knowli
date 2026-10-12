import { describe, expect, it } from "vitest";
import type { HistoryEntry, VocabularySkill } from "./types";
import { selectPracticeItems } from "./practice-items";

const entry = (input: Partial<HistoryEntry> & Pick<HistoryEntry, "receivedAt" | "skill" | "outcome">): HistoryEntry => ({
  receivedAt: input.receivedAt,
  policyVersion: input.policyVersion ?? "learning-v2",
  skill: input.skill,
  outcome: input.outcome,
  independent: input.independent ?? false,
  confirmationEligible: input.confirmationEligible ?? false,
  ...(input.reason ? { reason: input.reason } : {}),
});

const record = (input: { itemId: string; skill: VocabularySkill; skillVersionId?: string; history: HistoryEntry[] }) => ({
  itemId: input.itemId,
  skill: input.skill,
  skillVersionId: input.skillVersionId ?? `${input.itemId}:${input.skill}`,
  source: input.itemId,
  target: `target-${input.itemId}`,
  history: input.history,
});

const select = (records: ReturnType<typeof record>[]) => selectPracticeItems({
  records,
  currentPolicyVersion: "learning-v2",
  periodStart: "2026-10-09T00:00:00.000Z",
  generatedAt: "2026-10-11T17:00:00.000Z",
  dates: ["2026-10-09", "2026-10-10", "2026-10-11"],
  timezone: "Europe/Warsaw",
});

describe("selectPracticeItems", () => {
  it("keeps a recent incorrect skill until a later independent success for that same skill", () => {
    const result = select([
      record({ itemId: "monday", skill: "recall", history: [
        entry({ receivedAt: "2026-10-10T10:00:00Z", skill: "recall", outcome: "incorrect" }),
        entry({ receivedAt: "2026-10-11T10:00:00Z", skill: "recall", outcome: "correct", independent: true }),
      ] }),
      record({ itemId: "monday", skill: "spelling", history: [
        entry({ receivedAt: "2026-10-10T10:00:00Z", skill: "spelling", outcome: "incorrect" }),
        entry({ receivedAt: "2026-10-11T10:00:00Z", skill: "spelling", outcome: "correct", independent: false }),
      ] }),
    ]);
    expect(result.items).toMatchObject([{ itemId: "monday", skills: ["spelling"], lastDifficultyDate: "2026-10-10" }]);
  });

  it("treats explicit dont-remember as difficulty and does not clear it with unsupported or unassessed evidence", () => {
    const result = select([
      record({ itemId: "wednesday", skill: "recall", history: [
        entry({ receivedAt: "2026-10-10T10:00:00Z", skill: "recall", outcome: "incorrect", reason: "dont_remember" }),
        entry({ receivedAt: "2026-10-11T10:00:00Z", skill: "recall", outcome: "correct", independent: false }),
        entry({ receivedAt: "2026-10-11T11:00:00Z", skill: "recall", outcome: "unevaluated" as HistoryEntry["outcome"] }),
      ] }),
    ]);
    expect(result.items[0]?.skills).toEqual(["recall"]);
  });

  it("does not inherit evidence across a skill version or policy and truncates only with an explicit flag", () => {
    const oldDifficulty = entry({ receivedAt: "2026-10-10T10:00:00Z", skill: "reading", outcome: "incorrect", policyVersion: "learning-v1" });
    const result = select([
      record({ itemId: "old-policy", skill: "reading", skillVersionId: "old-version", history: [oldDifficulty] }),
      ...Array.from({ length: 6 }, (_, index) => record({
        itemId: `word-${index}`,
        skill: "spelling",
        history: [entry({ receivedAt: `2026-10-${String(9 + index % 3).padStart(2, "0")}T10:00:00Z`, skill: "spelling", outcome: "incorrect" })],
      })),
    ]);
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.items.some(({ itemId }) => itemId === "old-policy")).toBe(false);
  });
});
