import { messages } from "@learning/contracts";
import { Visual } from "../visuals/Visual";
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
    <section className="kid-card">
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
      <p className="kid-word" data-testid="kid-target">
        {task.prompt.text}
      </p>
      <p className="kid-hint">{messages.kid.sayIt}</p>
      <div className="kid-actions">
        {task.prompt.audioAssetId !== null && (
          <button type="button" data-testid="kid-play" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onPlay}>
            🔊 {messages.kid.listen}
          </button>
        )}
        {micAvailable && (
          <SpeechRecordButton
            phase={recordingPhase}
            ready={microphoneReady}
            disabled={busy}
            level={inputLevel}
            notice={recordingNotice}
            mode={recordingMode}
            onModeChange={handlers.onRecordingModeChange}
            onPrepare={handlers.onPrepareRecording}
            onStart={handlers.onRecord}
            onStop={handlers.onStopRecording}
            onCancel={handlers.onCancelRecording}
          />
        )}
      </div>
      <div className="kid-secondary-actions">
        {/* świadome pominięcie bez oceny — także po awarii technicznej próby,
            żeby dziecko nie utknęło na jednym słowie (SPEC §15.3) */}
        <button type="button" data-testid="kid-skip" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </button>
      </div>
    </section>
  );
}
