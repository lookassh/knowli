import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";

/**
 * Wybór (`lesson_choice`): zdanie z luką/pytaniem (`stem`) i opcje do wyboru;
 * dotknięcie opcji wysyła `choice`. Podświetlenie wyniku z feedbacku serwera.
 */
export function LessonChoiceView({ task, busy, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "lesson_choice") return null;
  return (
    <ExerciseFrame
      task={task}
      content={<>
      <p className="kid-lesson-stem" data-testid="kid-lesson-stem">{task.prompt.stem}</p>
      <ul className="kid-options">
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
      </ul>
      </>}
      actions={resultActions}
      result={result}
      reserveResult
    />
  );
}
