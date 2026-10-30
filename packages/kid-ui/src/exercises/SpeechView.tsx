import { messages } from "@learning/contracts";
import { ListenButton } from "../components/ListenButton";
import { Visual } from "../visuals/Visual";
import { ExerciseFrame } from "./ExerciseFrame";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";
import { ActionButton } from "../components/ActionButton";

/**
 * Ćwiczenie wymowy (SPEC §12.6): dziecko widzi angielskie słowo, może
 * usłyszeć wzorzec (oczekiwana część nauki — §13.2), potem je wypowiada.
 * Przy problemie z mikrofonem dostępna jest neutralna kontynuacja bez oceny.
 */
export function SpeechView(props: ExerciseProps) {
  const { task, busy, recordingPhase, automaticRecording, microphoneReady, inputLevel, recordingNotice, technicalRecordingIssue, recordingMode, micAvailable, mediaUrl, dock, handlers } = props;
  if (task.prompt.kind !== "speech") {
    return null;
  }
  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <>
          {task.prompt.visualType === "image" && task.prompt.imageAssetId !== null ? (
            <img
              className="kid-illustration"
              data-testid="kid-illustration"
              src={mediaUrl(task.prompt.imageAssetId)}
              alt={task.prompt.text}
            />
          ) : (
            <Visual
              text={task.prompt.text}
              visualType={task.prompt.visualType}
              visualData={task.prompt.visualData}
            />
          )}
          <p className="kid-word" data-testid="kid-target">{task.prompt.text}</p>
          <p className="kid-hint">{messages.kid.sayIt}</p>
          {micAvailable && (
            <div className="kid-speech-recording-slot">
              <SpeechRecordButton
                phase={recordingPhase}
                ready={microphoneReady}
                disabled={busy}
                level={inputLevel}
                notice={recordingNotice}
                mode={recordingMode}
                onPrepare={handlers.onPrepareRecording}
                onStart={handlers.onRecord}
                onStop={handlers.onStopRecording}
                onCancel={handlers.onCancelRecording}
              />
            </div>
          )}
        </>
      )}
      actions={<div className="kid-speech-actions">
        {task.prompt.audioAssetId !== null && (
          <ListenButton
            data-testid="kid-play"
            aria-label={messages.kid.listen}
            disabled={busy || (recordingPhase !== "idle" && !automaticRecording)}
            onClick={handlers.onPlay}
          />
        )}
      </div>}
      secondaryActions={(!micAvailable || technicalRecordingIssue) && <div className="kid-secondary-actions">
        {/* świadome pominięcie bez oceny — także po awarii technicznej próby,
            żeby dziecko nie utknęło na jednym słowie (SPEC §15.3) */}
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-technical-next" disabled={busy || (recordingPhase !== "idle" && !automaticRecording)} onClick={handlers.onSkip}>
          {messages.kid.feedbackNext}
        </ActionButton>
      </div>}
    />
  );
}
