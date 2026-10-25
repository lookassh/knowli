import { messages, type LessonMockTestSummaryDto, type SessionActivityResultDto } from "@learning/contracts";
import { Badge, Paper, Stack, Text, Title } from "@mantine/core";
import { SessionActivityResultView } from "./SessionActivityResultView";
import { ActionButton } from "../components/ActionButton";
import { KidScreen } from "../layout/KidScreen";
import { format } from "../format";
import { computeLessonMockScore, LESSON_MOCK_STATUS_ICONS, lessonMockOutcomeStatus } from "./lesson-mock-score";
import { mockTestScoreTone } from "./mock-test-score";
import { useAutoFocus } from "./useAutoFocus";

/**
 * Omówienie próbnej kartkówki lekcji dla dziecka po zamknięciu (requirements
 * 9.4, SPEC §19.1). Lista rozwiązanych slotów z odpowiedzią dziecka i poprawną
 * odpowiedzią oraz prostym wynikiem per zadanie; wyjątek procentowy omówienia
 * jak w słówkach. Bez kategorii błędów i werdyktu modelu — te widzi rodzic.
 */
export function LessonMockTestSummaryScreen({ summary, activity, detailsLoading, detailsError, onRetryDetails, onPractice, onSwitchProfile }: {
  summary: LessonMockTestSummaryDto;
  activity: SessionActivityResultDto | null;
  detailsLoading: boolean;
  detailsError: boolean;
  onRetryDetails: () => Promise<void>;
  onPractice: () => Promise<void>;
  onSwitchProfile: () => Promise<void>;
}) {
  const practiceRef = useAutoFocus<HTMLButtonElement>(true);

  const score = computeLessonMockScore(summary.solutions);
  const tone = mockTestScoreTone(score);
  const run = (promise: Promise<void>) => { void promise.catch(() => undefined); };
  return <KidScreen className="kid-screen kid-screen--mock-summary" data-testid="kid-lesson-mock-summary">
    <KidScreen.Header>
      <Title order={1}>{messages.kid.mockTestFinished}</Title>
      {!summary.complete && <Text>{messages.kid.mockTestPartial}</Text>}
      <SessionActivityResultView activity={activity} />
      {score.total > 0 && <Paper className="kid-mock-score" data-testid="kid-lesson-mock-score" data-tone={tone} radius="lg" p="md" withBorder>
        <Text className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</Text>
        <Text className="kid-mock-score__stars" role="img" aria-label={format(messages.kid.mockTestStarsLabel, { n: score.stars })}>{"★".repeat(score.stars)}{"☆".repeat(6 - score.stars)}</Text>
      </Paper>}
    </KidScreen.Header>
    <KidScreen.Content>
      <Title order={2}>{messages.kid.mockTestReview}</Title>
      {detailsLoading && <Text role="status" data-testid="kid-lesson-mock-details-loading">{messages.kid.loading}</Text>}
      {detailsError && <Paper role="alert" data-testid="kid-lesson-mock-details-error" p="sm" withBorder><Text>{messages.kid.mockTestDetailsError}</Text><ActionButton priority="secondary" size="sm" fullWidth={false} styles={{ root: { minHeight: 48 } }} onClick={() => run(onRetryDetails())}>{messages.kid.offlineRetry}</ActionButton></Paper>}
      <Stack component="ul" className="kid-mock-list" gap="sm">{summary.solutions.map(solution => {
      const status = lessonMockOutcomeStatus(solution.outcome);
      return <Paper component="li" className={`kid-mock-row kid-mock-row--${status}`} key={solution.taskId} data-testid="kid-lesson-mock-solution" data-status={status} radius="md" p="xs" withBorder>
        <span className="kid-mock-row__icon" aria-hidden="true">{LESSON_MOCK_STATUS_ICONS[status]}</span>
        <div className="kid-mock-row__body">
          <Text component="p" className="kid-mock-row__objective">{format(messages.kid.mockTestObjectiveLabel, { title: solution.titlePl })}</Text>
          <Text component="p" className="kid-mock-row__words">{solution.prompt}</Text>
          <Stack component="p" className="kid-mock-row__detail" gap={4}>
            <Text component="span" className="kid-mock-answer kid-mock-answer--child">{messages.kid.mockTestYourAnswer}: {solution.childAnswer.trim() === "" ? messages.kid.mockTestNoAnswer : solution.childAnswer}</Text>
            <Text component="span" className="kid-mock-answer kid-mock-answer--correct">{messages.kid.mockTestCorrectAnswer}: {solution.correctAnswer}</Text>
          </Stack>
          {status === "notAssessed" && <Text component="p" className="kid-mock-row__detail">
            <Badge className="kid-mock-badge" variant="light">{solution.outcome === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</Badge>
          </Text>}
        </div>
      </Paper>;
    })}</Stack>
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => run(onSwitchProfile())}>{messages.kid.profilesTitle}</ActionButton>}>
      <ActionButton ref={practiceRef} data-testid="kid-lesson-mock-practice" onClick={() => run(onPractice())}>{messages.kid.mockTestPractice}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}
