import { useState } from "react";
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

  return <KidScreen className="kid-screen kid-screen--mock-ready">
    <KidScreen.Header><h1>{messages.kid.mockTest}</h1></KidScreen.Header>
    <KidScreen.Content>
      <p className="kid-mock-budget" data-testid="kid-mock-budget">{format(messages.kid.mockTestBudget, { n: session.taskBudget })}</p>
      <p className="kid-mock-info" data-testid="kid-mock-info">{messages.kid.mockTestInfo}</p>
      {error && <p role="alert" style={{ color: "var(--kid-wrong)" }}>{messages.kid.offlineMessage}</p>}
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
    <KidScreen.Header>
      <h1>{messages.kid.mockTestFinished}</h1>
      {!summary.complete && <p>{messages.kid.mockTestPartial}</p>}
      <SessionActivityResultView activity={activity} />
      {score.total > 0 && <div className="kid-mock-score" data-testid="kid-mock-score" data-tone={tone}>
        <p className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</p>
        <p className="kid-mock-score__stars" role="img" aria-label={format(messages.kid.mockTestStarsLabel, { n: score.stars })}>{"★".repeat(score.stars)}{"☆".repeat(6 - score.stars)}</p>
      </div>}
    </KidScreen.Header>
    <KidScreen.Content>
      <h2>{messages.kid.mockTestReview}</h2>
      {detailsLoading && <p role="status" data-testid="kid-mock-details-loading">{messages.kid.loading}</p>}
      {detailsError && <div role="alert" className="kid-details-error" data-testid="kid-mock-details-error"><p>{messages.kid.mockTestDetailsError}</p><ActionButton priority="secondary" size="sm" fullWidth={false} style={{ minHeight: 48 }} onClick={() => run(onRetryDetails())}>{messages.kid.offlineRetry}</ActionButton></div>}
      <ul className="kid-mock-list">{summary.solutions.map(solution => {
      const status = mockTestWordStatus(solution.results);
      const detail = mockTestSolutionDetail(solution.results);
      return <li className={`kid-mock-row kid-mock-row--${status}`} key={solution.taskId} data-testid="kid-mock-solution" data-status={status}>
        <span className="kid-mock-row__icon" aria-hidden="true">{MOCK_TEST_SOLUTION_ICONS[status]}</span>
        <div className="kid-mock-row__body">
          <p className="kid-mock-row__words">{solution.source} → <strong>{solution.target}</strong></p>
          {detail.type === "label" && <p className="kid-mock-row__detail">
            <span className="kid-mock-badge">{detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</span>
          </p>}
          {detail.type === "perSkill" && <p className="kid-mock-row__detail">
            {solution.results.map(result => <span className={mockTestResultBadgeClass(result)} key={result.skill}>{mockTestResultBadgeLabel(result)}</span>)}
          </p>}
        </div>
        {solution.audioAssetId && <ActionButton priority="secondary" size="sm" fullWidth={false} style={{ minWidth: 48, minHeight: 48 }} className="kid-mock-row__audio" aria-label={messages.kid.listen} onClick={() => run(onPlay(solution.taskId))}><KidIcon name="volume" /></ActionButton>}
      </li>;
    })}</ul>
      {error && <p role="alert" style={{ color: "var(--kid-wrong)" }}>{messages.kid.offlineMessage}</p>}
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
      <p className="kid-conflict-info" data-testid="kid-conflict-info">{messages.kid.sessionConflict}</p>
      {error && <p role="alert" style={{ color: "var(--kid-wrong)" }}>{messages.kid.offlineMessage}</p>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => void onClose().catch(() => setError(true))}>{messages.kid.sessionClose}</ActionButton>}>
      <ActionButton onClick={() => void onResume().catch(() => setError(true))}>{messages.kid.sessionResume}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}
