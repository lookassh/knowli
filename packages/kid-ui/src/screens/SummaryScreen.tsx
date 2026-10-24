import type { ReactNode } from "react";
import { Box, Stack, Text, Title } from "@mantine/core";
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
    <KidScreen mode="flow" role="main" className="kid-screen kid-screen--summary">
      <KidScreen.Header>
        <Title order={1} data-testid="kid-summary">{messages.kid.summaryTitle}</Title>
        {guidance}
        {summary.activity !== undefined && <SessionActivityResultView activity={summary.activity} />}
      </KidScreen.Header>
      <KidScreen.Content>
      {recall > 0 && (
        <Text component="p" className="kid-summary-counts" data-testid="kid-summary-recall">
          {format(messages.kid.summaryRecall, { words: wordCount(recall) })}
        </Text>
      )}
      {spelling > 0 && (
        <Text component="p" className="kid-summary-counts" data-testid="kid-summary-spelling">
          {format(messages.kid.summarySpelling, { words: wordCount(spelling) })}
        </Text>
      )}
      {recall === 0 && spelling === 0 && (
        <Text component="p" className="kid-hint" data-testid="kid-summary-neutral">
          {summary.tasksIssued === 0 ? messages.kid.summaryEmpty : messages.kid.summaryNeutral}
        </Text>
      )}
      {summary.objectives !== undefined && summary.objectives.length > 0 && (
        <Box component="section" className="kid-summary-practice" aria-labelledby="kid-summary-objectives-title" data-testid="kid-summary-objectives">
          <Title order={2} id="kid-summary-objectives-title">{messages.kid.lessonSummaryTitle}</Title>
          <Stack component="ul" className="kid-list" gap="sm">
            {summary.objectives.map(objective => (
              <li key={objective.objectiveId} data-testid="kid-summary-objective">
                {format(messages.kid.lessonSummaryObjective, { title: objective.titlePl })}
              </li>
            ))}
          </Stack>
        </Box>
      )}
      {summary.practiceItems.length > 0 && (
        <Box component="section" className="kid-summary-practice" aria-labelledby="kid-summary-practice-title" data-testid="kid-summary-practice">
          <Title order={2} id="kid-summary-practice-title">{messages.kid.summaryPractice}</Title>
          <Stack component="ul" className="kid-list" gap="sm">
            {summary.practiceItems.map(item => (
              <li key={item.itemId}>
                <Text component="strong" lang="en-GB">{item.target}</Text>
                <Text component="span">{item.skills.map(skill => skill === "recall"
                  ? messages.kid.summarySkillRecall : messages.kid.summarySkillSpelling).join(", ")}</Text>
              </li>
            ))}
          </Stack>
        </Box>
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
