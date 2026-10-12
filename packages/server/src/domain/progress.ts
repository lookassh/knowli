import type {
  History,
  HistoryEntry,
  Policy,
  Progress,
  ReadingDirection,
  Skill,
  SkillProgress,
} from "./types";
import {
  projectSeries,
  windowHasConfirmedStreak,
  type SeriesEntry,
  type SeriesRules,
} from "./series-projection";

/** Wpis serii słówek: kwalifikacja próby wzbogacona o kierunek reading. */
interface SkillSeriesEntry extends SeriesEntry {
  direction?: ReadingDirection;
}

/**
 * Projekcja postępu z historii prób (SPEC §18, arch §9.3). Czysta funkcja:
 * historia + polityka + `now` → status per umiejętność. Interpretujemy
 * wyłącznie oceny bieżącej wersji polityki; historycznych wyników nie
 * przepisujemy (SPEC §20).
 */
export function projectProgress(history: History, policy: Policy, now: string): Progress {
  const nowMs = Date.parse(now);
  const relevant = history
    .filter((entry) => entry.policyVersion === policy.version && Date.parse(entry.receivedAt) <= nowMs)
    .slice()
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));

  const bySkill = new Map<Skill, HistoryEntry[]>();
  for (const entry of relevant) {
    const list = bySkill.get(entry.skill) ?? [];
    list.push(entry);
    bySkill.set(entry.skill, list);
  }

  const skills: Partial<Record<Skill, SkillProgress>> = {};
  for (const [skill, entries] of bySkill) {
    skills[skill] = projectSkill(skill, entries, policy);
  }
  return { skills };
}

function projectSkill(skill: Skill, entries: readonly HistoryEntry[], policy: Policy): SkillProgress {
  const seriesEntries: SkillSeriesEntry[] = entries.map((entry) => ({
    receivedAt: entry.receivedAt,
    outcome: entry.outcome,
    independent: entry.independent,
    confirmationEligible: entry.confirmationEligible,
    direction: entry.details?.direction,
  }));

  const { status, streak, nextReviewAt, window } = projectSeries(
    seriesEntries,
    policy,
    skillRules(skill),
  );

  const progress: SkillProgress = { status, streak, nextReviewAt };
  if (skill === "reading") {
    progress.directions = directionCounts(window, policy);
  }
  return progress;
}

/** Opanowanie: seria sukcesów, potwierdzenie po przerwie i — dla reading —
 * co najmniej jeden sukces w każdym kierunku wśród ostatnich (arch §9.3). */
function skillRules(skill: Skill): SeriesRules<SkillSeriesEntry> {
  return {
    windowSatisfiesMastery(window, policy) {
      if (!windowHasConfirmedStreak(window, policy)) return false;
      if (skill !== "reading") return true;
      return policy.readingDirections.every((direction) =>
        window.some((entry) => entry.direction === direction),
      );
    },
  };
}

function directionCounts(
  window: readonly SkillSeriesEntry[],
  policy: Policy,
): Partial<Record<ReadingDirection, number>> {
  const counts: Partial<Record<ReadingDirection, number>> = {};
  for (const direction of policy.readingDirections) {
    counts[direction] = window.filter((entry) => entry.direction === direction).length;
  }
  return counts;
}
