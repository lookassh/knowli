import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";

/**
 * Rozpoznawanie ze słuchu (SPEC §12.2): audio jest pytaniem — angielski
 * zapis nie jest widoczny przed odpowiedzią; ponowny odsłuch nie zdradza
 * polskiej odpowiedzi (§13.2).
 */
export function ListeningView({ task, busy, optionOutcomes, result, resultActions, handlers, mockTest }: ExerciseProps) {
  if (task.prompt.kind !== "listening") {
    return null;
  }
  return (
    <ExerciseFrame
      task={task}
      content={(
        <>
      <button
        type="button"
        className="kid-play-big"
        data-testid="kid-play"
        disabled={busy}
        onClick={handlers.onPlay}
        aria-label={messages.kid.listen}
      >
        <KidIcon name="volume" />
      </button>
      <ul className="kid-options">
        {task.prompt.options.map((option) => {
          const outcome = optionOutcomes.get(option.id);
          return (
            <li key={option.id}>
              <button type="button" data-testid="kid-option"
                className={outcome === undefined ? undefined : `kid-option--${outcome}`}
                aria-pressed={outcome === "pending"}
                disabled={busy} onClick={() => handlers.onAnswerChoice(option.id)}>
                {option.text}
              </button>
            </li>
          );
        })}
      </ul>
      </>
      )}
      actions={resultActions}
      secondaryActions={mockTest && <div className="kid-secondary-actions">
        <button type="button" data-testid="kid-not-remember" disabled={busy} onClick={handlers.onNotRemember}>{messages.kid.mockTestNotRemember}</button>
        <button type="button" data-testid="kid-skip" disabled={busy} onClick={handlers.onSkip}>{messages.kid.skip}</button>
      </div>}
      result={result}
      reserveResult
    />
  );
}
