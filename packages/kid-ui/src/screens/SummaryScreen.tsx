import type { ReactNode } from "react";
import { messages, type KidProfileDto, type SessionSummaryDto } from "@learning/contracts";
import { format } from "../format";
import { KidIcon } from "../components/KidIcon";
import { ActionButton } from "../components/ActionButton";
import { KidScreen } from "../layout/KidScreen";
import { SessionActivityResultView } from "./SessionActivityResultView";
import { useAutoFocus } from "./useAutoFocus";

/** Ekran końca: odnosi się do faktycznych wyników, nie obiecuje opanowania. */
export function SummaryScreen({
  summary,
  profiles,
  onAgain,
  onSwitchProfile,
  guidance,
}: {
  summary: SessionSummaryDto;
  profiles: KidProfileDto[];
  onAgain: () => void;
  onSwitchProfile: () => void;
  guidance?: ReactNode;
}) {
  const againRef = useAutoFocus<HTMLButtonElement>(true);

  const { recall, spelling } = summary.independentSuccesses;
  const wordCount = (n: number) => {
    const plural = new Intl.PluralRules("pl-PL").select(n);
    return format(plural === "one" ? messages.kid.summaryWordOne
      : plural === "few" ? messages.kid.summaryWordFew : messages.kid.summaryWordMany, { n });
  };
  return (
    <KidScreen role="main" className="kid-screen kid-screen--summary">
      <KidScreen.Header>
        <h1 data-testid="kid-summary">{messages.kid.summaryTitle}</h1>
        {guidance}
        {summary.activity !== undefined && <SessionActivityResultView activity={summary.activity} />}
      </KidScreen.Header>
      <KidScreen.Content>
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
      {summary.objectives !== undefined && summary.objectives.length > 0 && (
        <section className="kid-summary-practice" aria-labelledby="kid-summary-objectives-title" data-testid="kid-summary-objectives">
          <h2 id="kid-summary-objectives-title">{messages.kid.lessonSummaryTitle}</h2>
          <ul className="kid-list">
            {summary.objectives.map(objective => (
              <li key={objective.objectiveId} data-testid="kid-summary-objective">
                {format(messages.kid.lessonSummaryObjective, { title: objective.titlePl })}
              </li>
            ))}
          </ul>
        </section>
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
      </KidScreen.Content>
      <KidScreen.Actions className="kid-actions" secondary={profiles.length > 1 && (
        <ActionButton priority="secondary" className="kid-summary-secondary" data-testid="kid-switch-profile" onClick={onSwitchProfile}>
          <KidIcon name="arrow-right" />
          {messages.kid.switchProfile}
        </ActionButton>
      )}>
        <ActionButton ref={againRef} type="button" className="kid-primary" data-testid="kid-again" onClick={onAgain}>
          <KidIcon name="retry" />
          {messages.kid.again}
        </ActionButton>
      </KidScreen.Actions>
    </KidScreen>
  );
}
