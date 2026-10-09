import { messages, type FeedbackDto } from "@learning/contracts";
import { ExerciseView } from "../exercises/ExerciseView";
import type { ExerciseHandlers } from "../exercises/types";
import { format } from "../format";
import type { LearningSessionController, LearningScreen as LearningScreenState } from "../session/session-controller";

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
  const micAvailable = screen.session.microphoneEnabled && !screen.micDenied;
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
              task={task}
              busy={busy || screen.feedback !== null || screen.reveal !== null}
              recording={screen.recording}
              micAvailable={micAvailable}
              mediaUrl={(assetId) => controller.mediaUrl(assetId)}
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

      {screen.feedback !== null && (
        <section
          className={["kid-card", "kid-feedback", feedbackTone(screen.feedback.dto)]
            .filter(Boolean)
            .join(" ")}
          data-testid="kid-feedback"
          role="status"
        >
          <p className="kid-feedback-text">{feedbackText(screen.feedback.dto)}</p>
          {screen.feedback.dto?.fragments && screen.feedback.dto.fragments.length > 0 && (
            <p className="kid-fragments" data-testid="kid-fragments">
              {screen.feedback.dto.fragments.map((fragment, index) => (
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
          <button type="button" className="kid-primary" data-testid="kid-next" onClick={() => void controller.continueLearning()}>
            {screen.feedback.retry ? messages.kid.feedbackRetry : messages.kid.feedbackNext}
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
