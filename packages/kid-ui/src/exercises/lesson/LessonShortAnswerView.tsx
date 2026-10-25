import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { useChoiceKeyboard } from "../useChoiceKeyboard";
import { AnswerGrid } from "../../components/AnswerGrid";

/**
 * Krótka odpowiedź (`lesson_short_answer`): pytanie jest poleceniem (ramka
 * bierze je z prezentacji), a dziecko wybiera jedną z krótkich opcji —
 * odpowiedź `choice`. Wynik podświetlany z feedbacku serwera.
 */
export function LessonShortAnswerView({ task, busy, optionOutcomes, dock, handlers }: ExerciseProps) {
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
      content={<AnswerGrid
        options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
        outcomes={optionOutcomes}
        disabled={busy}
        optionRefs={optionRefs}
        onChoose={handlers.onAnswerChoice}
        listTestId="kid-lesson-short-answer"
        className="kid-options"
        itemClassName={() => "kid-lesson-short-answer"}
      />}
      dock={dock}
    />
  );
}
