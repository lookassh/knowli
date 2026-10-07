import type {
  History,
  HistoryEntry,
  Policy,
  Progress,
  ProgressStatus,
  ReadingDirection,
  Skill,
  SkillProgress,
} from "./types";

/**
 * Odstępy powtórek po sukcesach: 1 dzień, 3 dni, 7 dni (arch §9.3).
 * Odstępy liczymy na absolutnych instantach, więc zmiana czasu nie przesuwa
 * terminu o godzinę.
 */
const SUCCESS_INTERVALS_MS = [86_400_000, 3 * 86_400_000, 7 * 86_400_000];

interface WindowEntry {
  receivedAt: string;
  confirmationEligible: boolean;
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
  let streak = 0;
  let window: WindowEntry[] = [];
  let assessed = false;
  let masteredEver = false;
  let lastSuccessAt: string | null = null;
  let lastQualifyingAt: string | null = null;

  for (const entry of entries) {
    if (entry.outcome !== "unevaluated") assessed = true;
    // Próby wspomagane i bez wiarygodnej oceny nie zwiększają ani nie
    // przerywają serii kwalifikujących (SPEC §18.4).
    if (!entry.independent || entry.outcome === "unevaluated") continue;

    lastQualifyingAt = entry.receivedAt;
    if (entry.outcome === "correct") {
      streak += 1;
      window.push({
        receivedAt: entry.receivedAt,
        confirmationEligible: entry.confirmationEligible,
        direction: entry.details?.direction,
      });
      if (window.length > policy.successStreakRequired) {
        window = window.slice(-policy.successStreakRequired);
      }
      lastSuccessAt = entry.receivedAt;
    } else {
      streak = 0;
      window = [];
    }
    if (windowSatisfiesMastery(skill, window, policy)) masteredEver = true;
  }

  const currentlyMastered = windowSatisfiesMastery(skill, window, policy);
  const status: ProgressStatus = currentlyMastered
    ? "mastered"
    : masteredEver
      ? "needs_reconfirmation"
      : !assessed
        ? "not_assessed"
        : streak >= policy.successStreakRequired
          ? "needs_confirmation"
          : "learning";

  const progress: SkillProgress = {
    status,
    streak,
    nextReviewAt: nextReviewAt(status, streak, lastSuccessAt, lastQualifyingAt, policy),
  };
  if (skill === "reading") {
    progress.directions = directionCounts(window, policy);
  }
  return progress;
}

/** Opanowanie: seria sukcesów, potwierdzenie po przerwie i — dla reading —
 * co najmniej jeden sukces w każdym kierunku wśród ostatnich (arch §9.3). */
function windowSatisfiesMastery(
  skill: Skill,
  window: readonly WindowEntry[],
  policy: Policy,
): boolean {
  if (window.length < policy.successStreakRequired) return false;
  if (!window.some((entry) => entry.confirmationEligible)) return false;
  if (skill !== "reading") return true;
  return policy.readingDirections.every((direction) =>
    window.some((entry) => entry.direction === direction),
  );
}

function directionCounts(
  window: readonly WindowEntry[],
  policy: Policy,
): Partial<Record<ReadingDirection, number>> {
  const counts: Partial<Record<ReadingDirection, number>> = {};
  for (const direction of policy.readingDirections) {
    counts[direction] = window.filter((entry) => entry.direction === direction).length;
  }
  return counts;
}

function nextReviewAt(
  status: ProgressStatus,
  streak: number,
  lastSuccessAt: string | null,
  lastQualifyingAt: string | null,
  policy: Policy,
): string | null {
  if (status === "not_assessed") return null;
  if (status === "mastered" && lastSuccessAt !== null) {
    return addMs(lastSuccessAt, SUCCESS_INTERVALS_MS[SUCCESS_INTERVALS_MS.length - 1]!);
  }
  if (status === "needs_confirmation" && lastSuccessAt !== null) {
    // Najwcześniejszy moment, w którym sukces może potwierdzić opanowanie.
    return addMs(lastSuccessAt, policy.confirmationMinHours * 3_600_000);
  }
  if (status === "needs_reconfirmation" && lastQualifyingAt !== null) {
    return addMs(lastQualifyingAt, SUCCESS_INTERVALS_MS[0]!);
  }
  if (streak >= 1 && lastSuccessAt !== null) {
    return addMs(lastSuccessAt, SUCCESS_INTERVALS_MS[Math.min(streak, SUCCESS_INTERVALS_MS.length) - 1]!);
  }
  if (lastQualifyingAt !== null) {
    return addMs(lastQualifyingAt, SUCCESS_INTERVALS_MS[0]!);
  }
  return null;
}

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}
