import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { useChoiceKeyboard } from "../useChoiceKeyboard";
import { AnswerGrid } from "../../components/AnswerGrid";
import { messages, type LessonVisualSubject } from "@learning/contracts";

/** Piktogram osoby/zwierzęcia z bodźca obrazkowego — treść zadania, nie dekoracja. */
const VISUAL_GLYPHS: Record<LessonVisualSubject, string> = {
  boy: "👦",
  girl: "👧",
  man: "👨",
  woman: "👩",
  group: "👦👧",
  dog: "🐶",
};

/**
 * Wybór (`lesson_choice`): zdanie z luką/pytaniem (`stem`) i opcje do wyboru;
 * dotknięcie opcji wysyła `choice`. Podświetlenie wyniku z feedbacku serwera.
 */
export function LessonChoiceView({ task, busy, optionOutcomes, dock, handlers }: ExerciseProps) {
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
      feedbackLayout="flow"
      content={<>
        {task.prompt.visualSubject && (
          <p className="kid-lesson-visual" data-testid="kid-lesson-visual" role="img" aria-label={messages.kid.lessonVisualSubjects[task.prompt.visualSubject]}>{VISUAL_GLYPHS[task.prompt.visualSubject]}</p>
        )}
        <p className="kid-lesson-stem" data-testid="kid-lesson-stem">{task.prompt.stem}</p>
        <AnswerGrid
          options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
          outcomes={optionOutcomes}
          disabled={busy}
          optionRefs={optionRefs}
          onChoose={handlers.onAnswerChoice}
          className="kid-options"
        />
      </>}
      dock={dock}
    />
  );
}
