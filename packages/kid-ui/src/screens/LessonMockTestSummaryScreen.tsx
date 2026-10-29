import { messages, type LessonMockTestSummaryDto, type SessionActivityResultDto } from "@learning/contracts";
import { SessionActivityResultView } from "./SessionActivityResultView";
import { ActionButton } from "../components/ActionButton";
import { ScoreStars } from "../components/ScoreStars";
import { RowList, RowListItem } from "../components/RowList";
import { KidScreen } from "../layout/KidScreen";
import { format } from "../format";
import { MockTestStatusChip, MockTestStatusTile } from "./MockTestStatusChip";
import { computeLessonMockScore, lessonMockOutcomeStatus } from "./lesson-mock-score";
import { mockTestScoreTone } from "./mock-test-score";
import { useAutoFocus } from "./useAutoFocus";

/**
 * Omówienie próbnej kartkówki lekcji dla dziecka po zamknięciu (requirements
 * 9.4, SPEC §19.1). Lista rozwiązanych slotów z odpowiedzią dziecka i poprawną
 * odpowiedzią oraz prostym wynikiem per zadanie; wyjątek procentowy omówienia
 * jak w słówkach. Bez kategorii błędów i werdyktu modelu — te widzi rodzic.
 * Przedmiot szkolny dokłada gotową wskazówkę precyzji przy odpowiedzi otwartej
 * i listę „Warto powtórzyć” (design §8.2–8.3).
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
    <KidScreen.Header variant="band" className="kid-mock-band">
      <h1>{messages.kid.mockTestFinished}</h1>
      {!summary.complete && <p className="kid-mock-band__note">{messages.kid.mockTestPartial}</p>}
      <SessionActivityResultView activity={activity} />
      {score.total > 0 && <div className="kid-mock-score" data-testid="kid-lesson-mock-score" data-tone={tone}>
        <p className="kid-mock-score__value">{format(messages.kid.mockTestScore, { correct: score.correct, total: score.total, percent: score.percent })}</p>
        <ScoreStars stars={score.stars} label={format(messages.kid.mockTestStarsLabel, { n: score.stars })} />
      </div>}
    </KidScreen.Header>
    <KidScreen.Content>
      <h2 id="kid-lesson-mock-solutions-title">{messages.kid.mockTestReview}</h2>
      {detailsLoading && <p role="status" data-testid="kid-lesson-mock-details-loading">{messages.kid.loading}</p>}
      {detailsError && <div role="alert" className="kid-details-error" data-testid="kid-lesson-mock-details-error"><p>{messages.kid.mockTestDetailsError}</p><ActionButton priority="secondary" size="sm" fullWidth={false} style={{ minHeight: 48 }} onClick={() => run(onRetryDetails())}>{messages.kid.offlineRetry}</ActionButton></div>}
      <RowList aria-labelledby="kid-lesson-mock-solutions-title" className="kid-mock-list">{summary.solutions.map(solution => {
        const status = lessonMockOutcomeStatus(solution.outcome);
        return <RowListItem
          key={solution.taskId}
          className={`kid-mock-row kid-mock-row--${status}`}
          data-testid="kid-lesson-mock-solution"
          data-status={status}
          leading={<MockTestStatusTile status={status} />}
          title={<span className="kid-mock-row__words">{solution.prompt}</span>}
          description={format(messages.kid.mockTestObjectiveLabel, { title: solution.titlePl })}
          below={<>
            <p className="kid-mock-row__detail kid-mock-row__detail--answers">
              <span className="kid-mock-answer kid-mock-answer--child">{messages.kid.mockTestYourAnswer}: {solution.childAnswer.trim() === "" ? messages.kid.mockTestNoAnswer : solution.childAnswer}</span>
              <span className="kid-mock-answer kid-mock-answer--correct">{messages.kid.mockTestCorrectAnswer}: {solution.correctAnswer}</span>
            </p>
            {solution.hintPl && <p className="kid-mock-row__hint" data-testid="kid-lesson-mock-hint">{solution.hintPl}</p>}
            <span className="kid-mock-row__badges">
              <MockTestStatusChip status={status} skipped={solution.outcome === "skipped"} data-testid="kid-lesson-mock-status" />
            </span>
          </>}
        />;
      })}</RowList>
      {summary.reviewObjectives && summary.reviewObjectives.length > 0 && <section className="kid-mock-review" data-testid="kid-lesson-mock-review" aria-labelledby="kid-lesson-mock-review-title">
        <h2 id="kid-lesson-mock-review-title">{messages.kid.mockTestReviewObjectives}</h2>
        <ul className="kid-mock-review__list">{summary.reviewObjectives.map((objective) => <li key={objective.objectiveId}>{objective.titlePl}</li>)}</ul>
      </section>}
    </KidScreen.Content>
    <KidScreen.Actions secondary={<ActionButton priority="secondary" fullWidth={false} className="kid-flow-secondary" onClick={() => run(onSwitchProfile())}>{messages.kid.profilesTitle}</ActionButton>}>
      <ActionButton ref={practiceRef} data-testid="kid-lesson-mock-practice" onClick={() => run(onPractice())}>{messages.kid.mockTestPractice}</ActionButton>
    </KidScreen.Actions>
  </KidScreen>;
}
