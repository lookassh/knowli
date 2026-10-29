import { useState } from "react";
import { messages, type MockTestSummaryDto, type SessionActivityResultDto, type SessionDto } from "@learning/contracts";
import { ActionButton } from "../components/ActionButton";
import { ScoreStars } from "../components/ScoreStars";
import { Chip } from "../components/Chip";
import { IconActionButton } from "../components/IconActionButton";
import { KidIcon } from "../components/KidIcon";
import { RowList, RowListItem } from "../components/RowList";
import { EmptyScene } from "../illustrations/EmptyScene";
import { KidScreen } from "../layout/KidScreen";
import { SessionActivityResultView } from "./SessionActivityResultView";
import { format } from "../format";
import { MockTestStatusChip, MockTestStatusTile } from "./MockTestStatusChip";
import { computeMockTestScore, mockTestResultBadgeClass, mockTestResultBadgeLabel, mockTestScoreTone, mockTestSolutionDetail, mockTestWordStatus } from "./mock-test-score";
import { useAutoFocus } from "./useAutoFocus";

export function MockTestReadyScreen({ session, onStart, onCancel }: { session: SessionDto; onStart: () => Promise<void>; onCancel: () => Promise<void> }) {
  const [error, setError] = useState(false);
  const startRef = useAutoFocus<HTMLButtonElement>(true);
  // Liczba zadań jako duża cyfra w kafelku; reszta komunikatu to jego podpisy.
  const [budgetBefore = "", budgetAfter = ""] = messages.kid.mockTestBudget.split("{n}");

  return <KidScreen className="kid-screen kid-screen--mock-ready">
    <KidScreen.Header variant="band"><h1>{messages.kid.mockTest}</h1></KidScreen.Header>
    <KidScreen.Content>
      <div className="kid-stat kid-mock-budget" data-testid="kid-mock-budget">
        <span className="kid-stat__label">{budgetBefore}</span>
        <span className="kid-stat__value">{session.taskBudget}</span>
        <span className="kid-stat__label">{budgetAfter}</span>
      </div>
      <p className="kid-mock-info" data-testid="kid-mock-info">{messages.kid.mockTestInfo}</p>
      {error && <p role="alert" className="kid-alert">{messages.kid.offlineMessage}</p>}
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
  return <KidScreen className="kid-screen kid-screen--mock-summary" data-testid="kid-mock-summary">
    <KidScreen.Header variant="band" className="kid-mock-band">
      <h1>{messages.kid.mockTestFinished}</h1>
      {!summary.complete && <p className="kid-mock-band__note">{messages.kid.mockTestPartial}</p>}
      <SessionActivityResultView activity={activity} />
      {score.total > 0 && <div className="kid-mock-score" data-testid="kid-mock-score" data-tone={tone}>
        <p className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</p>
        <ScoreStars stars={score.stars} label={format(messages.kid.mockTestStarsLabel, { n: score.stars })} />
      </div>}
    </KidScreen.Header>
    <KidScreen.Content>
      <h2 id="kid-mock-review-title">{messages.kid.mockTestReview}</h2>
      {detailsLoading && <p role="status" data-testid="kid-mock-details-loading">{messages.kid.loading}</p>}
      {detailsError && <div role="alert" className="kid-details-error" data-testid="kid-mock-details-error"><p>{messages.kid.mockTestDetailsError}</p><ActionButton priority="secondary" size="sm" fullWidth={false} style={{ minHeight: 48 }} onClick={() => run(onRetryDetails())}>{messages.kid.offlineRetry}</ActionButton></div>}
      <RowList aria-labelledby="kid-mock-review-title" className="kid-mock-list">{summary.solutions.map(solution => {
        const status = mockTestWordStatus(solution.results);
        const detail = mockTestSolutionDetail(solution.results);
        const skipped = detail.type === "label" && detail.label === "skipped";
        return <RowListItem
          key={solution.taskId}
          className={`kid-mock-row kid-mock-row--${status}`}
          data-testid="kid-mock-solution"
          data-status={status}
          leading={<MockTestStatusTile status={status} />}
          title={<span className="kid-mock-row__words">{solution.source} → <strong lang="en-GB">{solution.target}</strong></span>}
          below={<span className="kid-mock-row__badges">
            <MockTestStatusChip status={status} skipped={skipped} data-testid="kid-mock-status" />
            {detail.type === "perSkill" && solution.results.map(result => <Chip className={mockTestResultBadgeClass(result)} key={result.skill}>{mockTestResultBadgeLabel(result)}</Chip>)}
          </span>}
          trailing={solution.audioAssetId ? <IconActionButton variant="tonal" className="kid-mock-row__audio" aria-label={messages.kid.listen} onClick={() => run(onPlay(solution.taskId))}><KidIcon name="volume" /></IconActionButton> : undefined}
        />;
      })}</RowList>
      {error && <p role="alert" className="kid-alert">{messages.kid.offlineMessage}</p>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => run(onSwitchProfile())}>{messages.kid.profilesTitle}</ActionButton>}>
      <ActionButton ref={practiceRef} data-testid="kid-mock-practice" onClick={() => run(onPractice())}>{messages.kid.mockTestPractice}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}

export function SessionConflictScreen({ onResume, onClose }: { onResume: () => Promise<void>; onClose: () => Promise<void> }) {
  const [error, setError] = useState(false);
  return <KidScreen className="kid-screen kid-screen--conflict">
    <KidScreen.Content>
      <EmptyScene className="kid-conflict-scene" />
      <p className="kid-conflict-info" data-testid="kid-conflict-info">{messages.kid.sessionConflict}</p>
      {error && <p role="alert" className="kid-alert">{messages.kid.offlineMessage}</p>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => void onClose().catch(() => setError(true))}>{messages.kid.sessionClose}</ActionButton>}>
      <ActionButton onClick={() => void onResume().catch(() => setError(true))}>{messages.kid.sessionResume}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}
