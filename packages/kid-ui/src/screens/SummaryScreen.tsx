import type { ReactNode } from "react";
import { messages, type KidProfileDto, type SessionSummaryDto } from "@learning/contracts";
import { format } from "../format";
import { KidIcon } from "../components/KidIcon";
import { ActionButton } from "../components/ActionButton";
import { CelebrationBurst } from "../components/CelebrationBurst";
import { RowList, RowListItem } from "../components/RowList";
import { m } from "motion/react";
import { kidEntranceAnimate, kidEntranceInitial, kidSpringGentle, kidStaggerDelay } from "../motion/kid-motion";
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
  const wordUnit = (n: number) => {
    const plural = new Intl.PluralRules("pl-PL").select(n);
    return format(plural === "one" ? messages.kid.summaryWordOne
      : plural === "few" ? messages.kid.summaryWordFew : messages.kid.summaryWordMany, { n: "" }).trim();
  };
  const stat = (testId: string, label: string, n: number, order: number) => (
    <m.div className="kid-stat" data-testid={testId} initial={kidEntranceInitial} animate={kidEntranceAnimate} transition={{ ...kidSpringGentle, delay: kidStaggerDelay(order) }}>
      <span className="kid-stat__figure">
        <span className="kid-stat__value">{n}</span>{" "}
        <span className="kid-stat__unit">{wordUnit(n)}</span>
      </span>
      <span className="kid-stat__label">{label}</span>
    </m.div>
  );
  return (
    <KidScreen role="main" className="kid-screen kid-screen--summary">
      <KidScreen.Header variant="band">
        {guidance && <header className="kid-top-bar">{guidance}</header>}
        <CelebrationBurst active={summary.tasksIssued > 0}><h1 data-testid="kid-summary">{messages.kid.summaryTitle}</h1></CelebrationBurst>
      </KidScreen.Header>
      <KidScreen.Content>
      {summary.activity !== undefined && <SessionActivityResultView activity={summary.activity} />}
      {(recall > 0 || spelling > 0) && (
        <div className="kid-summary-stats">
          {recall > 0 && stat("kid-summary-recall", messages.kid.summaryRecallLabel, recall, 1)}
          {spelling > 0 && stat("kid-summary-spelling", messages.kid.summarySpellingLabel, spelling, 2)}
        </div>
      )}
      {recall === 0 && spelling === 0 && (
        <p className="kid-hint" data-testid="kid-summary-neutral">
          {summary.tasksIssued === 0 ? messages.kid.summaryEmpty : messages.kid.summaryNeutral}
        </p>
      )}
      {summary.objectives !== undefined && summary.objectives.length > 0 && (
        <section className="kid-summary-practice" aria-labelledby="kid-summary-objectives-title" data-testid="kid-summary-objectives">
          <h2 id="kid-summary-objectives-title">{messages.kid.lessonSummaryTitle}</h2>
          <RowList aria-labelledby="kid-summary-objectives-title" className="kid-summary-rows">
            {summary.objectives.map(objective => (
              <RowListItem
                key={objective.objectiveId}
                data-testid="kid-summary-objective"
                leading={<KidIcon name="check" className="kid-summary-row-icon" />}
                title={format(messages.kid.lessonSummaryObjective, { title: objective.titlePl })}
              />
            ))}
          </RowList>
        </section>
      )}
      {summary.practiceItems.length > 0 && (
        <section className="kid-summary-practice" aria-labelledby="kid-summary-practice-title" data-testid="kid-summary-practice">
          <h2 id="kid-summary-practice-title">{messages.kid.summaryPractice}</h2>
          <RowList aria-labelledby="kid-summary-practice-title" className="kid-summary-rows">
            {summary.practiceItems.map(item => (
              <RowListItem
                key={item.itemId}
                title={<strong lang="en-GB">{item.target}</strong>}
                description={item.skills.map(skill => skill === "recall"
                  ? messages.kid.summarySkillRecall : messages.kid.summarySkillSpelling).join(", ")}
              />
            ))}
          </RowList>
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
