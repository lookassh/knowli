import { messages } from "@learning/contracts";
import { Visual } from "../visuals/Visual";
import type { ExerciseProps } from "./types";

/**
 * Ćwiczenie wymowy (SPEC §12.6): dziecko widzi angielskie słowo, może
 * usłyszeć wzorzec (oczekiwana część nauki — §13.2), potem je wypowiada.
 * Bez działającego mikrofonu pozostaje komunikat i „Pomiń” — bez oceny.
 */
export function SpeechView({ task, busy, recording, micAvailable, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "speech") {
    return null;
  }
  return (
    <section className="kid-card">
      <Visual text={task.prompt.text} />
      <p className="kid-word" data-testid="kid-target">
        {task.prompt.text}
      </p>
      <p className="kid-hint">{messages.kid.sayIt}</p>
      <div className="kid-actions">
        {task.prompt.audioAssetId !== null && (
          <button type="button" data-testid="kid-play" disabled={busy} onClick={handlers.onPlay}>
            🔊 {messages.kid.listen}
          </button>
        )}
        {micAvailable &&
          (recording ? (
            <>
              <span className="kid-recording" data-testid="kid-recording" role="status">
                ⏺ {messages.kid.recording}
              </span>
              <button type="button" className="kid-primary" data-testid="kid-stop-record" onClick={handlers.onStopRecording}>
                {messages.kid.stopRecording}
              </button>
            </>
          ) : (
            <button type="button" className="kid-primary" data-testid="kid-record" disabled={busy} onClick={handlers.onRecord}>
              🎤 {messages.kid.record}
            </button>
          ))}
      </div>
      {!micAvailable && (
        <div className="kid-secondary-actions">
          <button type="button" data-testid="kid-skip" disabled={busy} onClick={handlers.onSkip}>
            {messages.kid.skip}
          </button>
        </div>
      )}
    </section>
  );
}
