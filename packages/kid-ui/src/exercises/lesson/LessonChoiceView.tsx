import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { useChoiceKeyboard } from "../useChoiceKeyboard";
import { AnswerGrid } from "../../components/AnswerGrid";

/**
 * Wybór (`lesson_choice`): zdanie z luką/pytaniem (`stem`) i opcje do wyboru;
 * dotknięcie opcji wysyła `choice`. Podświetlenie wyniku z feedbacku serwera.
 */
export function LessonChoiceView({ task, busy, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "lesson_choice" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
  });

  if (task.prompt.kind !== "lesson_choice") return null;

  return (
    <ExerciseFrame
      task={task}
      content={<>
        <p className="kid-lesson-stem" data-testid="kid-lesson-stem">{task.prompt.stem}</p>
        <AnswerGrid
          options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
          outcomes={optionOutcomes}
          disabled={busy}
          optionRefs={optionRefs}
          onChoose={handlers.onAnswerChoice}
        />
      </>}
      actions={resultActions}
      result={result}
      reserveResult
    />
  );
}
