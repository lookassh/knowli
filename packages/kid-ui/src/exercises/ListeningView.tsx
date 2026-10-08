import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";

/**
 * Rozpoznawanie ze słuchu (SPEC §12.2): audio jest pytaniem — angielski
 * zapis nie jest widoczny przed odpowiedzią; ponowny odsłuch nie zdradza
 * polskiej odpowiedzi (§13.2).
 */
export function ListeningView({ task, busy, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "listening") {
    return null;
  }
  return (
    <section className="kid-card">
      <h2>{messages.kid.listenQuestion}</h2>
      <button
        type="button"
        className="kid-play-big"
        data-testid="kid-play"
        disabled={busy}
        onClick={handlers.onPlay}
        aria-label={messages.kid.listen}
      >
        🔊
      </button>
      <ul className="kid-options">
        {task.prompt.options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              data-testid="kid-option"
              disabled={busy}
              onClick={() => handlers.onAnswerChoice(option.id)}
            >
              {option.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
