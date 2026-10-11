import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";
import { ExerciseFrame } from "./ExerciseFrame";

/**
 * Rozpoznawanie tekstu i odwrotne (SPEC §12.3–12.4): widoczne słowo/prompt
 * i wybór odpowiedzi; wynik nie awansuje samodzielnego przypominania.
 */
export function ReadingView({ task, busy, optionOutcomes, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "reading" && task.prompt.kind !== "reverse_recognition") {
    return null;
  }
  const visible = task.prompt.kind === "reading" ? task.prompt.text : task.prompt.prompt;
  return (
    <ExerciseFrame
      task={task}
      content={(
      <p className="kid-word" data-testid="kid-word">
        {visible}
      </p>
      )}
      actions={<ul className="kid-options">
        {task.prompt.options.map((option) => {
          const outcome = optionOutcomes.get(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                data-testid="kid-option"
                className={outcome === undefined ? undefined : `kid-option--${outcome}`}
                disabled={busy}
                onClick={() => handlers.onAnswerChoice(option.id)}
              >
                {option.text}
              </button>
            </li>
          );
        })}
      </ul>}
    />
  );
}
