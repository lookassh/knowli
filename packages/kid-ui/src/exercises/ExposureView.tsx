import { messages } from "@learning/contracts";
import { Visual } from "../visuals/Visual";
import type { ExerciseProps } from "./types";

/**
 * Poznanie słowa (SPEC §12.1): angielskie słowo, polskie znaczenie i pomoc
 * wizualna; wzorcowa wymowa odtwarzana po świadomym „Start” sesji, ponowny
 * odsłuch na żądanie. Bez odpowiedzi i bez oceny.
 */
export function ExposureView({ task, busy, mediaUrl, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "exposure") {
    return null;
  }
  return (
    <section className="kid-card">
      {task.prompt.visualType === "image" && task.prompt.imageAssetId !== null ? (
        <img
          className="kid-illustration"
          data-testid="kid-illustration"
          src={mediaUrl(task.prompt.imageAssetId)}
          alt={task.prompt.target}
        />
      ) : (
        <Visual
          text={task.prompt.target}
          visualType={task.prompt.visualType}
          visualData={task.prompt.visualData}
        />
      )}
      <p className="kid-word" data-testid="kid-target">
        {task.prompt.target}
      </p>
      <p className="kid-source" data-testid="kid-source">
        {task.prompt.source}
      </p>
      {task.prompt.example !== null && (
        <div className="kid-example-block">
          <p className="kid-example" data-testid="kid-example">
            {task.prompt.example}
          </p>
          {task.prompt.exampleAudioAssetId !== null && (
            <button
              type="button"
              data-testid="kid-play-example"
              disabled={busy}
              onClick={handlers.onPlayExample}
            >
              🔊 {messages.kid.listenExample}
            </button>
          )}
        </div>
      )}
      <div className="kid-actions">
        {task.prompt.audioAssetId !== null && (
          <button type="button" data-testid="kid-play" disabled={busy} onClick={handlers.onPlay}>
            🔊 {messages.kid.listen}
          </button>
        )}
        <button
          type="button"
          className="kid-primary"
          data-testid="kid-done"
          disabled={busy}
          onClick={handlers.onComplete}
        >
          {messages.kid.understand}
        </button>
      </div>
    </section>
  );
}
