import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";
import { ExerciseFrame } from "./ExerciseFrame";
import { useChoiceKeyboard } from "./useChoiceKeyboard";
import { AnswerGrid } from "../components/AnswerGrid";
import { Text } from "@mantine/core";

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
        <Text component="p" className="kid-word" data-testid="kid-word">{visible}</Text>
        <AnswerGrid
          className="kid-options"
          choiceList
          options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
          outcomes={optionOutcomes}
          disabled={busy}
          optionRefs={optionRefs}
          onChoose={handlers.onAnswerChoice}
        />
      </>}
      actions={resultActions}
      reserveResult
      result={result}
    />
  );
}
