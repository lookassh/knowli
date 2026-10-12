import type { Policy, ProgressStatus, SkillOutcome } from "./types";

/**
 * Odstępy powtórek po sukcesach: 1 dzień, 3 dni, 7 dni (arch §9.3).
 * Odstępy liczymy na absolutnych instantach, więc zmiana czasu nie przesuwa
 * terminu o godzinę.
 */
export const SUCCESS_INTERVALS_MS = [86_400_000, 3 * 86_400_000, 7 * 86_400_000];

/**
 * Minimalny wpis serii: posortowana po `receivedAt` kwalifikacja jednej próby.
 * `itemId` i `direction` są opcjonalne — używa ich strategia opanowania
 * (`SeriesRules`), silnik samej serii ich nie interpretuje.
 */
export interface SeriesEntry {
  receivedAt: string;
  outcome: SkillOutcome;
  independent: boolean;
  confirmationEligible: boolean;
  itemId?: string;
  direction?: string;
}

/** Wynik projekcji jednej serii. `window` to okno ostatnich sukcesów. */
export interface SeriesProjection<E extends SeriesEntry> {
  status: ProgressStatus;
  streak: number;
  nextReviewAt: string | null;
  window: readonly E[];
}

/**
 * Strategia opanowania okna, wstrzykiwana przez konsumenta (słówka, cele).
 * `windowSatisfiesMastery` rozstrzyga, czy zebrane okno sukcesów spełnia
 * warunek opanowania (seria + potwierdzenie po przerwie + ewentualne reguły
 * składu okna, np. oba kierunki reading czy różne ćwiczenia celu).
 * `countsTowardWindow` (opcjonalna) pozwala, by sukces nie zwiększał okna, nie
 * przerywając przy tym serii — np. ponowny sukces na tym samym ćwiczeniu celu.
 */
export interface SeriesRules<E extends SeriesEntry> {
  windowSatisfiesMastery(window: readonly E[], policy: Policy): boolean;
  countsTowardWindow?(entry: E, window: readonly E[], policy: Policy): boolean;
}

/**
 * Generyczny projektor serii (arch §9.3, SPEC §18). Czysta funkcja: posortowane
 * wpisy kwalifikacji + polityka + strategia → status/seria/okno/nextReviewAt.
 * Interpretuje wyłącznie kwalifikujące próby; nieocenione i niesamodzielne są
 * neutralne (nie zwiększają ani nie przerywają serii, SPEC §18.4). Słówka i
 * cele dostarczają własnej reguły opanowania przez `rules`.
 */
export function projectSeries<E extends SeriesEntry>(
  entries: readonly E[],
  policy: Policy,
  rules: SeriesRules<E>,
): SeriesProjection<E> {
  let streak = 0;
  let window: E[] = [];
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
      // Sukces zawsze liczy do serii; do okna trafia tylko, gdy strategia na to
      // pozwala (np. nowe ćwiczenie celu) — brak wpisu w oknie nie przerywa serii.
      const countsTowardWindow = rules.countsTowardWindow
        ? rules.countsTowardWindow(entry, window, policy)
        : true;
      streak += 1;
      if (countsTowardWindow) {
        window.push(entry);
        if (window.length > policy.successStreakRequired) {
          window = window.slice(-policy.successStreakRequired);
        }
      }
      lastSuccessAt = entry.receivedAt;
    } else {
      streak = 0;
      window = [];
    }
    if (rules.windowSatisfiesMastery(window, policy)) masteredEver = true;
  }

  const currentlyMastered = rules.windowSatisfiesMastery(window, policy);
  const status: ProgressStatus = currentlyMastered
    ? "mastered"
    : masteredEver
      ? "needs_reconfirmation"
      : !assessed
        ? "not_assessed"
        : streak >= policy.successStreakRequired
          ? "needs_confirmation"
          : "learning";

  return {
    status,
    streak,
    nextReviewAt: nextReviewAt(status, streak, lastSuccessAt, lastQualifyingAt, policy),
    window,
  };
}

/**
 * Wspólny warunek bazowy okna: pełna seria i co najmniej jeden sukces
 * potwierdzony po przerwie (arch §9.3). Reguły domenowe (kierunki reading,
 * różne ćwiczenia celu) nakładają się na niego w `SeriesRules`.
 */
export function windowHasConfirmedStreak(
  window: readonly SeriesEntry[],
  policy: Policy,
): boolean {
  if (window.length < policy.successStreakRequired) return false;
  return window.some((entry) => entry.confirmationEligible);
}

export function nextReviewAt(
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
