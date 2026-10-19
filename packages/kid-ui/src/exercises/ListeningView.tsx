import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";
import { useChoiceKeyboard } from "./useChoiceKeyboard";

/**
 * Rozpoznawanie ze słuchu (SPEC §12.2): audio jest pytaniem — angielski
 * zapis nie jest widoczny przed odpowiedzią; ponowny odsłuch nie zdradza
 * polskiej odpowiedzi (§13.2).
 */
export function ListeningView({ task, busy, optionOutcomes, result, resultActions, handlers, mockTest }: ExerciseProps) {
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
      content={(
        <>
          <button
            ref={playRef}
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
