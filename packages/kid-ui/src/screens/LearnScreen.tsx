import { useEffect, useRef } from "react";
import { messages, type FeedbackDto } from "@learning/contracts";
import { ExerciseView } from "../exercises/ExerciseView";
import type { ExerciseHandlers } from "../exercises/types";
import { optionOutcomes, type OptionOutcome } from "../exercises/option-outcome";
import { format } from "../format";
import { FeedbackDialog } from "./FeedbackDialog";
import { SpeechFeedbackCard } from "./SpeechFeedbackCard";
import type { LearningSessionController, LearningScreen as LearningScreenState } from "../session/session-controller";

/** Brak podświetleń poza feedbackem próby wyboru. */
const EMPTY_OUTCOMES: ReadonlyMap<string, OptionOutcome> = new Map();

function feedbackText(feedback: FeedbackDto | null): string {
  const dto = feedback ?? { kind: "not_assessed" as const };
  switch (dto.kind) {
    case "great":
      return messages.kid.feedbackGreat;
    case "almost":
      return messages.kid.feedbackAlmost;
    case "capitalization_hint":
      return format(messages.kid.feedbackCapitalization, { word: dto.correctText ?? "" });
    case "incorrect":
      return format(messages.kid.feedbackIncorrect, { word: dto.correctText ?? "" });
    case "content_matched":
      return messages.kid.feedbackContentMatched;
    case "not_assessed":
      return messages.kid.feedbackNotAssessed;
  }
}

/**
 * Tło feedbacku odpowiada wynikowi (SPEC §16): sukces na zielono, pomyłka
 * na ciepły bursztyn, próba nieoceniona pozostaje neutralna. Nigdy nie
 * chwalimy błędnej odpowiedzi sukcesem — także kolorem.
 */
export function feedbackTone(feedback: FeedbackDto | null): string {
  const dto = feedback ?? { kind: "not_assessed" as const };
  switch (dto.kind) {
    case "great":
    case "capitalization_hint":
      return "kid-feedback--correct";
    case "almost":
    case "incorrect":
      return "kid-feedback--retry";
    // treść usłyszana, ale wymowa bez oceny — neutralnie, bez udawanego wyniku
    case "content_matched":
    case "not_assessed":
      return "";
  }
}

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
  const feedbackBarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = feedbackBarRef.current;
    if (bar === null) return;
    // pasek w przepływie: przewijamy go w widok, by wynik był od razu czytelny
    bar.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    bar.scrollIntoView({ block: "end" });
  }, [screen.feedback]);
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
    onRecordingModeChange: (mode) => controller.setRecordingMode(mode),
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
              handlers={handlers}
            />
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

      {choiceFeedback && (
        // próba wyboru: wynik podświetla przyciski, a pasek w przepływie pod
        // zadaniem nie zasłania siatki odpowiedzi (design 2026-10-09);
        // te same komunikaty i tony co karteczka
        <section
          ref={feedbackBarRef}
          className={["kid-card", "kid-feedback-inline", feedbackTone(feedback.dto)]
            .filter(Boolean)
            .join(" ")}
          data-testid="kid-feedback"
          role="status"
          aria-labelledby="kid-feedback-title"
        >
          <div className="kid-feedback-content">
            <p className="kid-feedback-text" id="kid-feedback-title">{feedbackText(feedback.dto)}</p>
          </div>
          <button type="button" className="kid-primary" data-testid="kid-next" disabled={busy} onClick={() => void controller.continueLearning()}>
            {feedback.retry ? messages.kid.feedbackRetry : messages.kid.feedbackNext}
          </button>
        </section>
      )}

      {feedback !== null && feedback.modality === "audio" && !offline && screen.error === null && task !== null && (
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

      {feedback !== null && feedback.modality !== "audio" && !offline && screen.error === null && feedback.chosenOptionId === undefined && (
        <FeedbackDialog
          className={["kid-card", "kid-feedback", feedbackTone(feedback.dto)]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="kid-feedback-content">
            <p className="kid-feedback-text" id="kid-feedback-title">{feedbackText(feedback.dto)}</p>
            {feedback.dto?.heardText && (
              <p className="kid-heard-text" data-testid="kid-heard-text">
                {format(messages.kid.feedbackHeard, { word: feedback.dto.heardText })}
              </p>
            )}
            {feedback.dto?.fragments && feedback.dto.fragments.length > 0 && (
              <p className="kid-fragments" data-testid="kid-fragments">
                {feedback.dto.fragments.map((fragment, index) => (
                  <span
                    key={index}
                    className={`kid-fragment kid-fragment--${fragment.verdict}`}
                    data-testid="kid-fragment"
                  >
                    {fragment.text}
                  </span>
                ))}
              </p>
            )}
          </div>
          <button type="button" className="kid-primary" data-testid="kid-next" disabled={busy} onClick={() => void controller.continueLearning()}>
            {feedback.retry ? messages.kid.feedbackRetry : messages.kid.feedbackNext}
          </button>
        </FeedbackDialog>
      )}

      {task === null && !offline && screen.error === null && (
        <p className="kid-hint" data-testid="kid-loading-step">
          {messages.kid.loading}
        </p>
      )}
    </main>
  );
}
