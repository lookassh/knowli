import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { useChoiceKeyboard } from "../useChoiceKeyboard";

/**
 * Krótka odpowiedź (`lesson_short_answer`): pytanie jest poleceniem (ramka
 * bierze je z prezentacji), a dziecko wybiera jedną z krótkich opcji —
 * odpowiedź `choice`. Wynik podświetlany z feedbacku serwera.
 */
export function LessonShortAnswerView({ task, busy, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "lesson_short_answer" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
  });

  if (task.prompt.kind !== "lesson_short_answer") return null;

  return (
    <ExerciseFrame
      task={task}
      content={<ul className="kid-options" data-testid="kid-lesson-short-answer">
        {options.map((option, index) => {
          const outcome = optionOutcomes.get(option.id);
          return (
            <li key={option.id}>
              <button
                ref={(btn) => { optionRefs.current[index] = btn; }}
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
      actions={resultActions}
      result={result}
      reserveResult
    />
  );
}
