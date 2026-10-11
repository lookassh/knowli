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
  const { recall, spelling } = summary.independentSuccesses;
  const wordCount = (n: number) => {
    const plural = new Intl.PluralRules("pl-PL").select(n);
    return format(plural === "one" ? messages.kid.summaryWordOne
      : plural === "few" ? messages.kid.summaryWordFew : messages.kid.summaryWordMany, { n });
  };
  return (
    <main className="kid-screen kid-screen--summary">
      <h1 data-testid="kid-summary">{messages.kid.summaryTitle}</h1>
      {recall > 0 && (
        <p className="kid-summary-counts" data-testid="kid-summary-recall">
          {format(messages.kid.summaryRecall, { words: wordCount(recall) })}
        </p>
      )}
      {spelling > 0 && (
        <p className="kid-summary-counts" data-testid="kid-summary-spelling">
          {format(messages.kid.summarySpelling, { words: wordCount(spelling) })}
        </p>
      )}
      {recall === 0 && spelling === 0 && (
        <p className="kid-hint" data-testid="kid-summary-neutral">
          {summary.tasksIssued === 0 ? messages.kid.summaryEmpty : messages.kid.summaryNeutral}
        </p>
      )}
      {summary.practiceItems.length > 0 && (
        <section className="kid-summary-practice" aria-labelledby="kid-summary-practice-title" data-testid="kid-summary-practice">
          <h2 id="kid-summary-practice-title">{messages.kid.summaryPractice}</h2>
          <ul className="kid-list">
            {summary.practiceItems.map(item => (
              <li key={item.itemId}>
                <strong lang="en-GB">{item.target}</strong>
                <span>{item.skills.map(skill => skill === "recall"
                  ? messages.kid.summarySkillRecall : messages.kid.summarySkillSpelling).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
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
