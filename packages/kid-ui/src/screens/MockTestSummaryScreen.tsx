import { useState } from "react";
import { Badge, Box, Paper, Stack, Text, Title } from "@mantine/core";
import { messages, type MockTestSummaryDto, type SessionActivityResultDto, type SessionDto } from "@learning/contracts";
import { ActionButton } from "../components/ActionButton";
import { KidScreen } from "../layout/KidScreen";
import { SessionActivityResultView } from "./SessionActivityResultView";
import { KidIcon } from "../components/KidIcon";
import { format } from "../format";
import { computeMockTestScore, MOCK_TEST_SOLUTION_ICONS, mockTestResultBadgeClass, mockTestResultBadgeLabel, mockTestScoreTone, mockTestSolutionDetail, mockTestWordStatus } from "./mock-test-score";
import { useAutoFocus } from "./useAutoFocus";

export function MockTestReadyScreen({ session, onStart, onCancel }: { session: SessionDto; onStart: () => Promise<void>; onCancel: () => Promise<void> }) {
  const [error, setError] = useState(false);
  const startRef = useAutoFocus<HTMLButtonElement>(true);

  return <KidScreen mode="flow" className="kid-screen kid-screen--mock-ready">
    <KidScreen.Header><Title order={1}>{messages.kid.mockTest}</Title></KidScreen.Header>
    <KidScreen.Content>
      <Text className="kid-mock-budget" data-testid="kid-mock-budget">{format(messages.kid.mockTestBudget, { n: session.taskBudget })}</Text>
      <Text className="kid-mock-info" data-testid="kid-mock-info">{messages.kid.mockTestInfo}</Text>
      {error && <Text role="alert" c="red.3">{messages.kid.offlineMessage}</Text>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-end kid-flow-secondary" onClick={() => void onCancel().catch(() => setError(true))}>{messages.kid.end}</ActionButton>}>
      <ActionButton ref={startRef} data-testid="kid-mock-confirm" onClick={() => void onStart().catch(() => setError(true))}>{messages.kid.mockTestStart}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}

export function MockTestSummaryScreen({ summary, activity, detailsLoading, detailsError, onRetryDetails, onPlay, onPractice, onSwitchProfile }: {
  summary: MockTestSummaryDto; activity: SessionActivityResultDto | null; detailsLoading: boolean; detailsError: boolean; onRetryDetails: () => Promise<void>; onPlay: (taskId: string) => Promise<void>; onPractice: () => Promise<void>; onSwitchProfile: () => Promise<void>;
}) {
  const [error, setError] = useState(false);
  const practiceRef = useAutoFocus<HTMLButtonElement>(true);

  const run = (promise: Promise<void>) => { setError(false); void promise.catch(() => setError(true)); };
  const score = computeMockTestScore(summary.solutions);
  const tone = mockTestScoreTone(score);
  return <KidScreen mode="flow" className="kid-screen kid-screen--mock-summary" data-testid="kid-mock-summary">
    <KidScreen.Header>
      <Title order={1}>{messages.kid.mockTestFinished}</Title>
      {!summary.complete && <Text>{messages.kid.mockTestPartial}</Text>}
      <SessionActivityResultView activity={activity} />
      {score.total > 0 && <Paper className="kid-mock-score" data-testid="kid-mock-score" data-tone={tone} radius="lg" p="md" withBorder>
        <Text className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</Text>
        <Text className="kid-mock-score__stars" role="img" aria-label={format(messages.kid.mockTestStarsLabel, { n: score.stars })}>{"★".repeat(score.stars)}{"☆".repeat(6 - score.stars)}</Text>
      </Paper>}
    </KidScreen.Header>
    <KidScreen.Content>
      <Title order={2}>{messages.kid.mockTestReview}</Title>
      {detailsLoading && <Text role="status" data-testid="kid-mock-details-loading">{messages.kid.loading}</Text>}
      {detailsError && <Paper role="alert" data-testid="kid-mock-details-error" p="sm" withBorder><Text>{messages.kid.mockTestDetailsError}</Text><ActionButton priority="secondary" size="sm" fullWidth={false} styles={{ root: { minHeight: 44 } }} onClick={() => run(onRetryDetails())}>{messages.kid.offlineRetry}</ActionButton></Paper>}
      <Stack component="ul" className="kid-mock-list" gap="sm">{summary.solutions.map(solution => {
      const status = mockTestWordStatus(solution.results);
      const detail = mockTestSolutionDetail(solution.results);
      return <Paper component="li" className={`kid-mock-row kid-mock-row--${status}`} key={solution.taskId} data-testid="kid-mock-solution" data-status={status} radius="md" p="xs" withBorder>
        <span className="kid-mock-row__icon" aria-hidden="true">{MOCK_TEST_SOLUTION_ICONS[status]}</span>
        <div className="kid-mock-row__body">
          <Text component="p" className="kid-mock-row__words">{solution.source} → <strong>{solution.target}</strong></Text>
          {detail.type === "label" && <Text component="p" className="kid-mock-row__detail">
            <Badge className="kid-mock-badge" variant="light">{detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</Badge>
          </Text>}
          {detail.type === "perSkill" && <Box component="p" className="kid-mock-row__detail">
            {solution.results.map(result => <Badge variant="light" className={mockTestResultBadgeClass(result)} key={result.skill}>{mockTestResultBadgeLabel(result)}</Badge>)}
          </Box>}
        </div>
        {solution.audioAssetId && <ActionButton priority="secondary" size="sm" fullWidth={false} styles={{ root: { minWidth: 44, minHeight: 44 } }} className="kid-mock-row__audio" aria-label={messages.kid.listen} onClick={() => run(onPlay(solution.taskId))}><KidIcon name="volume" /></ActionButton>}
      </Paper>;
    })}</Stack>
      {error && <Text role="alert" c="red.3">{messages.kid.offlineMessage}</Text>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => run(onSwitchProfile())}>{messages.kid.profilesTitle}</ActionButton>}>
      <ActionButton ref={practiceRef} data-testid="kid-mock-practice" onClick={() => run(onPractice())}>{messages.kid.mockTestPractice}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}

export function SessionConflictScreen({ onResume, onClose }: { onResume: () => Promise<void>; onClose: () => Promise<void> }) {
  const [error, setError] = useState(false);
  return <KidScreen mode="flow" className="kid-screen kid-screen--conflict">
    <KidScreen.Content>
      <Text className="kid-conflict-info" data-testid="kid-conflict-info">{messages.kid.sessionConflict}</Text>
      {error && <Text role="alert" c="red.3">{messages.kid.offlineMessage}</Text>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => void onClose().catch(() => setError(true))}>{messages.kid.sessionClose}</ActionButton>}>
      <ActionButton onClick={() => void onResume().catch(() => setError(true))}>{messages.kid.sessionResume}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}
