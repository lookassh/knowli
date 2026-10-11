import { messages } from "@learning/contracts";
import { ExerciseView } from "../exercises/ExerciseView";
import type { ExerciseHandlers } from "../exercises/types";
import { optionOutcomes, type OptionOutcome } from "../exercises/option-outcome";
import { format } from "../format";
import { AnswerFeedback } from "./AnswerFeedback";
import { ExerciseFrame } from "../exercises/ExerciseFrame";
import { SpeechFeedbackCard } from "./SpeechFeedbackCard";
import type { LearningSessionController, LearningScreen as LearningScreenState } from "../session/session-controller";

/** Brak podświetleń poza feedbackem próby wyboru. */
const EMPTY_OUTCOMES: ReadonlyMap<string, OptionOutcome> = new Map();

/**
 * Ekran nauki: jedno jasne zadanie na ekranie. Po utracie sieci treść
 * zadania znika (ukrycie wzorców), odsłuchy i oceniane próby są zablokowane,
 * a sukces może pochodzić wyłącznie z odpowiedzi serwera (plan zadania 9).
 */
export function LearnScreen({
  screen,
  controller,
}: {
  screen: LearningScreenState;
  controller: LearningSessionController;
}) {
  const { task, offline, busy } = screen;
  const remaining = controller.remainingFor(task);
  const micAvailable = screen.session.mode !== "mock_test" && screen.session.microphoneEnabled && !screen.micDenied;
  // feedback próby wyboru = pasek wyniku zamiast karteczki
  const feedback = screen.feedback;
  const choiceFeedback =
    feedback !== null && feedback.chosenOptionId !== undefined && !offline && screen.error === null;
  const speechFeedback = feedback !== null && feedback.modality === "audio" && !offline && screen.error === null;
  const writtenFeedback = feedback !== null && feedback.modality !== "audio" && feedback.chosenOptionId === undefined && !offline && screen.error === null;
  // podświetlenia opcji żyją tylko przy feedbacku próby wyboru
  const outcomes =
    task !== null && screen.feedback?.chosenOptionId !== undefined
      ? optionOutcomes(
          screen.feedback.dto,
          screen.feedback.chosenOptionId,
          "options" in task.prompt ? task.prompt.options : [],
        )
      : EMPTY_OUTCOMES;
  const handlers: ExerciseHandlers = {
    onPlay: () => void controller.playTaskAudio(),
    onPlayExample: () => void controller.playExampleAudio(),
    onAnswerChoice: (optionId) => void controller.answerChoice(optionId),
    onSubmitText: (text) => void controller.answerText(text),
    onNotRemember: () => void controller.notRemember(),
    onSkip: () => void controller.skip(),
    onComplete: () => void controller.completePresentation(),
    onRecord: () => void controller.startRecording(),
    onStopRecording: () => void controller.stopRecording(),
    onCancelRecording: () => controller.cancelRecording(),
    onPrepareRecording: () => void controller.prepareMicrophone(),
  };

  return (
    <main className="kid-screen kid-learning" data-task-id={task?.taskId ?? undefined}>
      <header className="kid-header">
        {remaining !== null && (
          <p className="kid-remaining" data-testid="kid-remaining">
            {format(messages.kid.remaining, { n: remaining })}
          </p>
        )}
        <button type="button" className="kid-end" data-testid="kid-end" disabled={busy} onClick={() => void controller.endNow()}>
          {messages.kid.end}
        </button>
      </header>
      {screen.session.mode === "mock_test" && <p className="kid-notice">{messages.kid.mockTestInfo}</p>}
      {screen.answerSaved && <p className="kid-notice" role="status">{messages.kid.answerSaved}</p>}

      {screen.micDenied && (
        <p className="kid-notice" data-testid="kid-mic-denied">
          {messages.kid.micDenied}
        </p>
      )}
      {screen.processing && (
        <p className="kid-notice" data-testid="kid-processing" role="status">
          {messages.kid.processing}
        </p>
      )}

      {offline ? (
        <section className="kid-card kid-offline" data-testid="kid-offline">
          <p>{messages.kid.offlineMessage}</p>
          <button type="button" className="kid-primary" data-testid="kid-retry" onClick={() => void controller.retry()}>
            {messages.kid.offlineRetry}
          </button>
        </section>
      ) : screen.error !== null ? (
        <section className="kid-card kid-error" data-testid="kid-error">
          <p>{screen.error}</p>
          <button type="button" className="kid-primary" data-testid="kid-retry" onClick={() => void controller.retry()}>
            {messages.kid.offlineRetry}
          </button>
        </section>
      ) : (
        task !== null && (
          <div className="kid-task">
            {speechFeedback && feedback !== null ? (
              <ExerciseFrame
                task={task}
                content={(
                  <SpeechFeedbackCard
                    dto={feedback.dto}
                    retry={feedback.retry}
                    busy={busy || screen.processing}
                    audioAvailable={feedback.dto?.referenceAudioAvailable === true}
                    audioError={feedback.audioError === true}
                    exerciseType={task.exerciseType}
                    onPlay={() => void controller.playFeedbackAudio()}
                    onRetry={() => void controller.continueLearning()}
                    onSkip={() => void controller.skip()}
                    onNext={() => void controller.continueLearning()}
                  />
                )}
              />
            ) : writtenFeedback && feedback !== null ? (
              <ExerciseFrame
                task={task}
                content={(
                  <AnswerFeedback
                    dto={feedback.dto}
                    retry={feedback.retry}
                    busy={busy}
                    onNext={() => void controller.continueLearning()}
                  />
                )}
              />
            ) : (
              <ExerciseView
                mockTest={screen.session.mode === "mock_test"}
                task={task}
                busy={busy || screen.feedback !== null || screen.reveal !== null}
                recording={screen.recording}
                recordingPhase={screen.recordingPhase}
                microphoneReady={screen.microphoneReady}
                inputLevel={screen.inputLevel}
                recordingNotice={screen.recordingNotice}
                recordingMode={screen.recordingMode}
                micAvailable={micAvailable}
                mediaUrl={(assetId) => controller.mediaUrl(assetId)}
                optionOutcomes={outcomes}
                result={choiceFeedback && feedback !== null ? (
                  <AnswerFeedback
                    dto={feedback.dto}
                    retry={feedback.retry}
                    busy={busy}
                    onNext={() => void controller.continueLearning()}
                  />
                ) : undefined}
                handlers={handlers}
              />
            )}
          </div>
        )
      )}

      {screen.reveal !== null && (
        <section className="kid-card kid-reveal" data-testid="kid-reveal">
          <p>{messages.kid.revealTitle}</p>
          <p className="kid-word">{screen.reveal.target}</p>
          <button type="button" className="kid-primary" data-testid="kid-next" onClick={() => void controller.confirmReveal()}>
            {messages.kid.understand}
          </button>
        </section>
      )}

      {task === null && !offline && screen.error === null && (
        <p className="kid-hint" data-testid="kid-loading-step">
          {messages.kid.loading}
        </p>
      )}
    </main>
  );
}
