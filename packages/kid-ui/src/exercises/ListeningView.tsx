import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { ActionButton } from "../components/ActionButton";
import { AnswerGrid } from "../components/AnswerGrid";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";
import { useChoiceKeyboard } from "./useChoiceKeyboard";

/**
 * Rozpoznawanie ze słuchu (SPEC §12.2): audio jest pytaniem — angielski
 * zapis nie jest widoczny przed odpowiedzią; ponowny odsłuch nie zdradza
 * polskiej odpowiedzi (§13.2).
 */
export function ListeningView({ task, busy, optionOutcomes, dock, handlers, mockTest }: ExerciseProps) {
  const prompt = task.prompt.kind === "listening" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const playRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
    onPlay: handlers.onPlay,
  });

  useEffect(() => {
    if (task.prompt.kind === "listening") {
      playRef.current?.focus({ preventScroll: true });
    }
  }, [task.taskId, task.prompt.kind]);

  if (task.prompt.kind !== "listening") {
    return null;
  }

  return (
    <ExerciseFrame
      task={task}
      feedbackLayout="flow"
      instructionAudio={{ ref: playRef, disabled: busy, onPlay: handlers.onPlay }}
      content={(
        <>
          <AnswerGrid
            className="kid-options"
            choiceList
            options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
            outcomes={optionOutcomes}
            disabled={busy}
            optionRefs={optionRefs}
            onChoose={handlers.onAnswerChoice}
          />
        </>
      )}
      dock={dock}
      secondaryActions={mockTest && <div className="kid-secondary-actions">
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-not-remember" disabled={busy} onClick={handlers.onNotRemember}>{messages.kid.mockTestNotRemember}</ActionButton>
      </div>}
    />
  );
}
