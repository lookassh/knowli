import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";
import { ExerciseFrame } from "./ExerciseFrame";
import { useChoiceKeyboard } from "./useChoiceKeyboard";

/**
 * Rozpoznawanie tekstu i odwrotne (SPEC §12.3–12.4): widoczne słowo/prompt
 * i wybór odpowiedzi; wynik nie awansuje samodzielnego przypominania.
 */
export function ReadingView({ task, busy, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "reading" || task.prompt.kind === "reverse_recognition" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
  });

  if (task.prompt.kind !== "reading" && task.prompt.kind !== "reverse_recognition") {
    return null;
  }
  const visible = task.prompt.kind === "reading" ? task.prompt.text : task.prompt.prompt;
  return (
    <ExerciseFrame
      task={task}
      content={<>
        <p className="kid-word" data-testid="kid-word">{visible}</p>
        <ul className="kid-options">
        {options.map((option, index) => {
          const outcome = optionOutcomes.get(option.id);
          return (
            <li key={option.id}>
              <button
                ref={(btn) => { optionRefs.current[index] = btn; }}
                type="button"
                data-testid="kid-option"
                className={outcome === undefined ? undefined : `kid-option--${outcome}`}
                aria-pressed={outcome === "pending"}
                disabled={busy}
                onClick={() => handlers.onAnswerChoice(option.id)}
              >
                {option.text}
              </button>
            </li>
          );
        })}
        </ul>
      </>}
      actions={resultActions}
      reserveResult
      result={result}
    />
  );
}
