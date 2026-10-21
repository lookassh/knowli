import type { SessionActivityResultDto } from "@learning/contracts";
import { messages } from "@learning/contracts";
import { format } from "../format";

/** Mały wynik punktowy po sesji: „Zdobyto N pkt” albo jawny brak oceny. */
export function SessionActivityResultView({ activity }: { activity: SessionActivityResultDto | null }) {
  if (activity === null) return null;
  return <p className="kid-summary-counts" data-testid="kid-summary-reward" role="status" aria-live="polite">
    {activity.status === "evaluated"
      ? format(messages.kid.rewardSession, { points: activity.pointsAwarded })
      : activity.status === "already_started"
        ? messages.kid.rewardAlreadyStarted
        : messages.kid.rewardError}
  </p>;
}
