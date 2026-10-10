import { useState } from "react";
import { messages, type MockTestSummaryDto, type SessionDto } from "@learning/contracts";
import { format } from "../format";

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
  return <main className="kid-screen" data-testid="kid-mock-summary">
    <h1>{messages.kid.mockTestFinished}</h1>
    {!summary.complete && <p>{messages.kid.mockTestPartial}</p>}
    <h2>{messages.kid.mockTestReview}</h2>
    <ul className="kid-list">{summary.solutions.map(solution => <li className="kid-card" key={solution.taskId} data-testid="kid-mock-solution">
      <p>{solution.source} → <strong>{solution.target}</strong></p>
      {solution.results.map(result => <p key={result.skill}>
        {messages.progress.skills[result.skill]}: {result.outcome === "correct" ? messages.kid.mockTestCorrect : result.outcome === "incorrect" ? messages.kid.mockTestPracticeWord : messages.kid.mockTestNotTested}
      </p>)}
      {solution.audioAssetId && <button type="button" onClick={() => run(onPlay(solution.taskId))}>{messages.kid.listen}</button>}
    </li>)}</ul>
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
