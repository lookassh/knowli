import { useState } from "react";
import { messages, type MockTestSummaryDto, type SessionDto } from "@learning/contracts";
import { format } from "../format";
import { computeMockTestScore, mockTestSolutionDetail, mockTestWordStatus, type MockTestWordStatus } from "./mock-test-score";

type Solution = MockTestSummaryDto["solutions"][number];

const SOLUTION_ICONS: Record<MockTestWordStatus, string> = { correct: "✓", incorrect: "✗", notAssessed: "–" };

function resultBadgeLabel(result: Solution["results"][number]): string {
  const skill = messages.kid.mockTestSkill[result.skill];
  if (result.outcome === "correct") return `${skill} ✓`;
  if (result.outcome === "incorrect") return `${skill} ✗`;
  return `${skill}: ${result.outcome === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}`;
}

function resultBadgeClass(result: Solution["results"][number]): string {
  if (result.outcome === "correct") return "kid-mock-badge kid-mock-badge--correct";
  if (result.outcome === "incorrect") return "kid-mock-badge kid-mock-badge--incorrect";
  return "kid-mock-badge";
}

export function MockTestReadyScreen({ session, onStart, onCancel }: { session: SessionDto; onStart: () => Promise<void>; onCancel: () => Promise<void> }) {
  const [error, setError] = useState(false);
  return <main className="kid-screen">
    <h1>{messages.kid.mockTest}</h1>
    <p data-testid="kid-mock-budget">{format(messages.kid.mockTestBudget, { n: session.taskBudget })}</p>
    <p>{messages.kid.mockTestInfo}</p>
    {error && <p role="alert">{messages.kid.offlineMessage}</p>}
    <button type="button" className="kid-primary" data-testid="kid-mock-confirm" onClick={() => void onStart().catch(() => setError(true))}>{messages.kid.mockTestStart}</button>
    <button type="button" className="kid-end" onClick={() => void onCancel().catch(() => setError(true))}>{messages.kid.end}</button>
  </main>;
}

export function MockTestSummaryScreen({ summary, onPlay, onPractice, onSwitchProfile }: {
  summary: MockTestSummaryDto; onPlay: (taskId: string) => Promise<void>; onPractice: () => Promise<void>; onSwitchProfile: () => Promise<void>;
}) {
  const [error, setError] = useState(false);
  const run = (promise: Promise<void>) => { setError(false); void promise.catch(() => setError(true)); };
  const score = computeMockTestScore(summary.solutions);
  const tone = score.percent >= 80 ? "good" : score.percent >= 50 ? "mid" : "low";
  return <main className="kid-screen" data-testid="kid-mock-summary">
    <h1>{messages.kid.mockTestFinished}</h1>
    {!summary.complete && <p>{messages.kid.mockTestPartial}</p>}
    {score.total > 0 && <div className="kid-mock-score" data-testid="kid-mock-score" data-tone={tone}>
      <p className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</p>
      <p className="kid-mock-score__stars" role="img" aria-label={format(messages.kid.mockTestStarsLabel, { n: score.stars })}>{"★".repeat(score.stars)}{"☆".repeat(6 - score.stars)}</p>
    </div>}
    <h2>{messages.kid.mockTestReview}</h2>
    <ul className="kid-mock-list">{summary.solutions.map(solution => {
      const status = mockTestWordStatus(solution.results);
      const detail = mockTestSolutionDetail(solution.results);
      return <li className={`kid-mock-row kid-mock-row--${status}`} key={solution.taskId} data-testid="kid-mock-solution" data-status={status}>
        <span className="kid-mock-row__icon" aria-hidden="true">{SOLUTION_ICONS[status]}</span>
        <div className="kid-mock-row__body">
          <p className="kid-mock-row__words">{solution.source} → <strong>{solution.target}</strong></p>
          {detail.type === "label" && <p className="kid-mock-row__detail">
            <span className="kid-mock-badge">{detail.label === "skipped" ? messages.kid.mockTestSkipped : messages.kid.mockTestNotTested}</span>
          </p>}
          {detail.type === "perSkill" && <p className="kid-mock-row__detail">
            {solution.results.map(result => <span className={resultBadgeClass(result)} key={result.skill}>{resultBadgeLabel(result)}</span>)}
          </p>}
        </div>
        {solution.audioAssetId && <button type="button" className="kid-mock-row__audio" aria-label={messages.kid.listen} onClick={() => run(onPlay(solution.taskId))}>🔊</button>}
      </li>;
    })}</ul>
    {error && <p role="alert">{messages.kid.offlineMessage}</p>}
    <button type="button" className="kid-primary" data-testid="kid-mock-practice" onClick={() => run(onPractice())}>{messages.kid.mockTestPractice}</button>
    <button type="button" onClick={() => run(onSwitchProfile())}>{messages.kid.profilesTitle}</button>
  </main>;
}

export function SessionConflictScreen({ onResume, onClose }: { onResume: () => Promise<void>; onClose: () => Promise<void> }) {
  const [error, setError] = useState(false);
  return <main className="kid-screen">
    <p>{messages.kid.sessionConflict}</p>
    {error && <p role="alert">{messages.kid.offlineMessage}</p>}
    <button type="button" className="kid-primary" onClick={() => void onResume().catch(() => setError(true))}>{messages.kid.sessionResume}</button>
    <button type="button" onClick={() => void onClose().catch(() => setError(true))}>{messages.kid.sessionClose}</button>
  </main>;
}
