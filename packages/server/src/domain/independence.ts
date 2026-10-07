import type { AttemptQualification, EvaluationContext, IndependenceReason } from "./types";

/**
 * Kwalifikacja próby jako niezależnego sprawdzenia pamięci (SPEC §18.1–3):
 * pierwsza próba w zadaniu, bez wsparcia i po upływie czasu od ujawnienia
 * rozwiązania. Przerwa 12 godzin i inny dzień lokalny liczone są na absolutnych
 * instantach, więc zmiana czasu (DST) nie zafałszuje wyniku.
 */
export function qualifyAttempt(ctx: EvaluationContext): AttemptQualification {
  const reason = independenceReason(ctx);
  return {
    independent: reason === undefined,
    confirmationEligible: crossBreakEligible(ctx),
    ...(reason ? { reason } : {}),
  };
}

function independenceReason(ctx: EvaluationContext): IndependenceReason | undefined {
  if (!ctx.firstTry) return "not_first_try";
  if (ctx.assistance.length > 0) return "assisted";
  if (ctx.lastExposureAt !== null) {
    const elapsedMs = Date.parse(ctx.receivedAt) - Date.parse(ctx.lastExposureAt);
    if (elapsedMs < ctx.policy.independenceAfterSeconds * 1000) return "recent_exposure";
  }
  return undefined;
}

function crossBreakEligible(ctx: EvaluationContext): boolean {
  const previous = ctx.previousSessionContactAt;
  if (previous === null) return false;
  const elapsedMs = Date.parse(ctx.receivedAt) - Date.parse(previous);
  if (elapsedMs < ctx.policy.confirmationMinHours * 3_600_000) return false;
  return localDay(ctx.receivedAt, ctx.timezone) !== localDay(previous, ctx.timezone);
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Dzień lokalny (YYYY-MM-DD) w strefie czasowej rodziny. */
function localDay(iso: string, timeZone: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(iso));
}
