import { messages, type KidProfileDto, type SessionSummaryDto } from "@learning/contracts";
import { format } from "../format";

/** Ekran końca: odnosi się do faktycznych wyników, nie obiecuje opanowania. */
export function SummaryScreen({
  summary,
  profiles,
  onAgain,
  onSwitchProfile,
}: {
  summary: SessionSummaryDto;
  profiles: KidProfileDto[];
  onAgain: () => void;
  onSwitchProfile: () => void;
}) {
  return (
    <main className="kid-screen">
      <h1 data-testid="kid-summary">{messages.kid.summaryTitle}</h1>
      {summary.tasksIssued === 0 ? (
        <p className="kid-hint">{messages.kid.summaryEmpty}</p>
      ) : (
        <p className="kid-summary-counts" data-testid="kid-summary-counts">
          {format(messages.kid.summaryTasks, { n: summary.tasksIssued, m: summary.assessedTasksIssued })}
        </p>
      )}
      <div className="kid-actions">
        <button type="button" className="kid-primary" data-testid="kid-again" onClick={onAgain}>
          {messages.kid.again}
        </button>
        {profiles.length > 1 && (
          <button type="button" data-testid="kid-switch-profile" onClick={onSwitchProfile}>
            {messages.kid.switchProfile}
          </button>
        )}
      </div>
    </main>
  );
}
