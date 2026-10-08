import { messages } from "@learning/contracts";
import { Visual } from "../visuals/Visual";
import type { ExerciseProps } from "./types";

/**
 * Poznanie słowa (SPEC §12.1): angielskie słowo, polskie znaczenie i pomoc
 * wizualna; wzorcowa wymowa odtwarzana po świadomym „Start” sesji, ponowny
 * odsłuch na żądanie. Bez odpowiedzi i bez oceny.
 */
export function ExposureView({ task, busy, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "exposure") {
    return null;
  }
  return (
    <section className="kid-card">
      <Visual text={task.prompt.target} />
      <p className="kid-word" data-testid="kid-target">
        {task.prompt.target}
      </p>
      <p className="kid-source" data-testid="kid-source">
        {task.prompt.source}
      </p>
      {task.prompt.example !== null && <p className="kid-example">{task.prompt.example}</p>}
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
