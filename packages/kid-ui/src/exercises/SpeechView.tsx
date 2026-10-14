import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { Visual } from "../visuals/Visual";
import { ExerciseFrame } from "./ExerciseFrame";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";

/**
 * Ćwiczenie wymowy (SPEC §12.6): dziecko widzi angielskie słowo, może
 * usłyszeć wzorzec (oczekiwana część nauki — §13.2), potem je wypowiada.
 * Bez działającego mikrofonu pozostaje komunikat i „Pomiń” — bez oceny.
 */
export function SpeechView({ task, busy, recordingPhase, microphoneReady, inputLevel, recordingNotice, recordingMode, micAvailable, mediaUrl, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "speech") {
    return null;
  }
  return (
    <ExerciseFrame
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
          <button
            type="button"
            className="kid-audio-round kid-audio-round-sm"
            data-testid="kid-play"
            aria-label={messages.kid.listen}
            disabled={busy || recordingPhase !== "idle"}
            onClick={handlers.onPlay}
          >
            <KidIcon name="volume" />
          </button>
        )}
      </div>}
      secondaryActions={<div className="kid-secondary-actions">
        {/* świadome pominięcie bez oceny — także po awarii technicznej próby,
            żeby dziecko nie utknęło na jednym słowie (SPEC §15.3) */}
        <button type="button" data-testid="kid-skip" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </button>
      </div>}
    />
  );
}
