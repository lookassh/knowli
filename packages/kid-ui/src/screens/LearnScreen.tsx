import { useState } from "react";
import { messages } from "@learning/contracts";
import { ExerciseView } from "../exercises/ExerciseView";
import type { ExerciseHandlers } from "../exercises/types";
import { optionOutcomes, type OptionOutcome } from "../exercises/option-outcome";
import { format } from "../format";
import { AnswerFeedbackActions, AnswerFeedbackContent, AnswerFeedbackSecondaryActions } from "./AnswerFeedback";
import { ExerciseFrame } from "../exercises/ExerciseFrame";
import { KidIcon } from "../components/KidIcon";
import { GuidanceButton } from "../components/GuidanceButton";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { UiAudioKey } from "@learning/contracts";
import { SpeechFeedbackActions, SpeechFeedbackContent, SpeechFeedbackSecondaryActions } from "./SpeechFeedbackCard";
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
  const [letterDraft, setLetterDraft] = useState<{ taskId: string; letters: Record<number, string> } | null>(null);
  const activeLetterDraft = task?.prompt.kind === "letter_completion" && letterDraft?.taskId === task.taskId
    ? letterDraft.letters
    : {};
  const remaining = controller.remainingFor(task);
  const taskGuidanceKey: UiAudioKey | null = task?.prompt.kind === "picture_exposure" ? "exposure"
    : task?.prompt.kind === "picture_listening" ? "listening"
      : task?.prompt.kind === "picture_speech" ? "speech"
        : task?.prompt.kind === "picture_recall" ? "recall" : null;
  const feedback = screen.feedback;
  const feedbackGuidanceKey: UiAudioKey | null = feedback === null ? null
    : feedback.modality === "skip" ? "skip"
      : feedback.modality === "dont_remember" ? "dont_remember"
        : feedback.dto?.kind === "great" || feedback.dto?.kind === "capitalization_hint" || feedback.dto?.kind === "content_matched" ? "correct"
          : feedback.dto?.kind === "almost" || feedback.dto?.kind === "spelling_hint" || feedback.dto?.kind === "lesson_almost" || feedback.dto?.kind === "lesson_hint" ? "partial"
            : feedback.dto?.kind === "incorrect" ? "incorrect" : "unevaluated";
  const instructionAudioKey = feedbackGuidanceKey ?? taskGuidanceKey;
  const micAvailable = screen.session.mode !== "mock_test" && screen.session.microphoneEnabled && !screen.micDenied;
  const micState = screen.session.mode === "mock_test" ? "off"
    : !screen.session.microphoneEnabled ? "off"
      : screen.micDenied ? "unavailable"
        : screen.recordingNotice === messages.kid.recordingUnavailable ? "unavailable"
          : screen.microphoneReady ? "ready" : "pending";
  const micLabel = micState === "unavailable" ? messages.kid.microphoneUnavailable
    : micState === "off" ? messages.kid.microphoneOff
      : micState === "ready" ? messages.kid.microphoneReady : messages.kid.microphonePending;
  const micHint = micState === "unavailable" ? messages.kid.microphoneUnavailableHint
    : micState === "off" ? messages.kid.microphoneOffHint
      : micState === "ready" ? messages.kid.microphoneReadyHint : messages.kid.microphonePendingHint;
  // feedback próby wyboru = pasek wyniku zamiast karteczki
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
    onInteraction: () => controller.recordInteraction(),
    onPlay: () => void controller.playTaskAudio(),
    onPlayExample: () => void controller.playExampleAudio(),
    onAnswerChoice: (optionId) => void controller.answerChoice(optionId),
    onSubmitText: (text) => void controller.answerText(text),
    onAnswerSequence: (itemIds) => void controller.answerSequence(itemIds),
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
        {instructionAudioKey && <GuidanceButton audioKey={instructionAudioKey} onPlay={(key) => controller.playGuidance(key)} testId="kid-guidance-play" showError={false} />}
        {remaining !== null && (
          <p className="kid-remaining" data-testid="kid-remaining">
            {format(messages.kid.remaining, { n: remaining })}
          </p>
        )}
        <button type="button" className="kid-end" data-testid="kid-end" disabled={busy} onClick={() => void controller.endNow()}>
          {messages.kid.end}
        </button>
        <details className="kid-microphone-status" data-microphone-state={micState}>
          <summary aria-label={micLabel} data-testid="kid-microphone-status">
            <KidIcon name={micState === "off" || micState === "unavailable" ? "microphone-off" : "microphone"} />
          </summary>
          <p className="kid-microphone-hint" data-testid={micState === "unavailable" ? "kid-mic-denied" : "kid-microphone-hint"}>
            {micHint}
          </p>
        </details>
      </header>
      <div className="kid-session-status" data-testid="kid-session-status" role="status" aria-live="polite">
        {screen.activityPaused && <p className="kid-notice kid-activity-paused" data-testid="kid-activity-paused">{messages.kid.activityPaused}</p>}
        {screen.session.mode === "mock_test" && <p className="kid-notice">{messages.kid.mockTestInfo}</p>}
        {screen.answerSaved && <p className="kid-notice">{messages.kid.answerSaved}</p>}
        {screen.processing && (
          <p className="kid-notice" data-testid="kid-processing">
            {messages.kid.processing}
          </p>
        )}
        {screen.guidanceError && instructionAudioKey && <div className="kid-notice" data-testid="kid-guidance-error"><p>{messages.errors.picture_guidance_unavailable}</p><button type="button" onClick={() => void controller.playGuidance(instructionAudioKey).catch(() => undefined)}>{messages.errors.picture_audio_retry}</button><button type="button" onClick={() => void controller.endNow()}>{messages.kid.end}</button></div>}
        {screen.taskAudioError && <div className="kid-notice" role="alert" data-testid="kid-task-audio-error"><p>{screen.taskAudioError === "blocked" ? messages.errors.picture_audio_blocked : messages.errors.picture_audio_unavailable}</p><button type="button" data-testid="kid-task-audio-retry" onClick={() => void controller.playTaskAudio()}>{messages.errors.picture_audio_retry}</button><button type="button" onClick={() => void controller.endNow()}>{messages.kid.end}</button></div>}
      </div>

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
            {screen.reveal !== null ? (
              <ExerciseFrame task={task} content={(
                <section className="kid-card kid-reveal" data-testid="kid-reveal">
                  <p>{messages.kid.revealTitle}</p>
                  {screen.reveal.visual && <MeaningVisualView visual={screen.reveal.visual} mediaUrl={(assetId) => controller.mediaUrl(assetId)} />}
                  <p className="kid-word">{screen.reveal.target}</p>
                  {screen.reveal.audioAssetId && <button type="button" className="kid-audio-round" data-testid="kid-reveal-audio" onClick={() => void controller.playRevealAudio()} aria-label={messages.kid.listen}><KidIcon name="volume" /></button>}
                </section>
              )} actions={(<button type="button" className="kid-primary" data-testid="kid-next"
                onClick={() => void controller.confirmReveal()}>{messages.kid.understand}</button>)} />
            ) : speechFeedback && feedback !== null ? (
              <ExerciseFrame
                task={task}
                content={(
                  <SpeechFeedbackContent
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
                actions={<SpeechFeedbackActions
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
                />}
                secondaryActions={<SpeechFeedbackSecondaryActions
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
                />}
              />
            ) : writtenFeedback && feedback !== null ? (
              <ExerciseFrame
                task={task}
                content={<AnswerFeedbackContent dto={feedback.dto} busy={busy} />}
                actions={<AnswerFeedbackActions retry={feedback.retry} busy={busy}
                  onNext={() => void controller.continueLearning()} />}
                secondaryActions={<AnswerFeedbackSecondaryActions dto={feedback.dto} retry={feedback.retry} busy={busy}
                  onNext={() => void controller.continueLearning()} onSkip={() => void controller.skip()} />}
              />
            ) : (
              <ExerciseView
                mockTest={screen.session.mode === "mock_test"}
                task={task}
                letterDraft={activeLetterDraft}
                onLetterDraftChange={(letters) => setLetterDraft({ taskId: task.taskId, letters })}
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
                result={choiceFeedback && feedback !== null ? <AnswerFeedbackContent dto={feedback.dto} busy={busy} /> : undefined}
                resultActions={choiceFeedback && feedback !== null ? (
                  <AnswerFeedbackActions retry={feedback.retry} busy={busy}
                    onNext={() => void controller.continueLearning()} />
                ) : undefined}
                reserveResult={choiceFeedback}
                handlers={handlers}
              />
            )}
          </div>
        )
      )}

      {task === null && !offline && screen.error === null && (
        <p className="kid-hint" data-testid="kid-loading-step">
          {messages.kid.loading}
        </p>
      )}
    </main>
  );
}
