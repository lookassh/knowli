import type { HistoryEntry, Skill } from "./types";

export type PracticeHistoryRecord = {
  itemId: string;
  skill: Skill;
  skillVersionId: string;
  source: string;
  target: string;
  history: readonly HistoryEntry[];
};

export type PracticeItem = {
  itemId: string;
  source: string;
  target: string;
  skills: Skill[];
  lastDifficultyDate: string;
};

export function selectPracticeItems(input: {
  records: readonly PracticeHistoryRecord[];
  currentPolicyVersion: string;
  periodStart: string;
  generatedAt: string;
  dates: readonly string[];
  timezone: string;
}): { items: PracticeItem[]; truncated: boolean } {
  const periodStart = Date.parse(input.periodStart);
  const cutoff = Date.parse(input.generatedAt);
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const byItem = new Map<string, { source: string; target: string; skills: Map<Skill, string> }>();

  for (const record of input.records) {
    const eligible = record.history.filter((entry) => entry.policyVersion === input.currentPolicyVersion);
    const difficulties = eligible.filter((entry) => {
      const receivedAt = Date.parse(entry.receivedAt);
      const date = dateFormatter.format(new Date(receivedAt));
      return receivedAt >= periodStart && receivedAt <= cutoff && input.dates.includes(date) &&
        (entry.outcome === "incorrect" || entry.reason === "dont_remember");
    });
    const difficulty = difficulties.at(-1);
    if (!difficulty) continue;
    const cleared = eligible.some((entry) => entry.outcome === "correct" && entry.independent &&
      Date.parse(entry.receivedAt) > Date.parse(difficulty.receivedAt));
    if (cleared) continue;

    const date = dateFormatter.format(new Date(difficulty.receivedAt));
    const item = byItem.get(record.itemId) ?? { source: record.source, target: record.target, skills: new Map<Skill, string>() };
    item.skills.set(record.skill, date);
    byItem.set(record.itemId, item);
  }

  const items = [...byItem.entries()].map(([itemId, item]) => {
    const dates = [...item.skills.values()].sort();
    return {
      itemId, source: item.source, target: item.target,
      skills: [...item.skills.keys()].sort(), lastDifficultyDate: dates.at(-1)!,
    };
  }).sort((a, b) => b.lastDifficultyDate.localeCompare(a.lastDifficultyDate) || a.itemId.localeCompare(b.itemId));
  return { items: items.slice(0, 5), truncated: items.length > 5 };
}
