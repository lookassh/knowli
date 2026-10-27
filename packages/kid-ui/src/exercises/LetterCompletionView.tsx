import { useEffect, useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import { ActionButton } from "../components/ActionButton";
import { LetterField } from "../components/LetterField";
import { m } from "motion/react";
import { kidEntranceAnimate, kidEntranceInitial, kidSpringGentle, kidStaggerDelay } from "../motion/kid-motion";
import { ExerciseFrame } from "./ExerciseFrame";
import { useRetryReset } from "./useRetryReset";
import type { ExerciseProps } from "./types";

/** Luki są jedynymi polami edycji; pełną odpowiedź ocenia istniejące Kid API. */
export function LetterCompletionView({ task, busy, recording, handlers, letterDraft, onLetterDraftChange, dock }: ExerciseProps) {
  const [localLetters, setLocalLetters] = useState<Record<number, string>>({});
  const letters = letterDraft ?? localLetters;
  const updateLetters = onLetterDraftChange ?? setLocalLetters;
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const fragment = task.prompt.kind === "letter_completion" ? task.prompt.fragment : "";
  const characters = Array.from(fragment);
  const gapPositions = characters.flatMap((character, index) => character === "_" ? [index] : []);
  const complete = gapPositions.length > 0 && gapPositions.every((position) => Boolean(letters[position]));
  const disabled = busy || recording;
  const formId = `kid-letters-${task.taskId}`;

  const focusFirstGap = () => {
    const firstEmpty = gapPositions.find((pos) => !letters[pos]) ?? gapPositions[0];
    if (firstEmpty !== undefined) {
      inputRefs.current[firstEmpty]?.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    if (task.prompt.kind !== "letter_completion") return;
    focusFirstGap();
  }, [task.taskId, task.prompt.kind]);
  // Wpis celowo zostaje na kolejną próbę tego zadania; wraca tylko fokus.
  useRetryReset(dock, () => {}, focusFirstGap);

  if (task.prompt.kind !== "letter_completion") return null;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <>
          <p className="kid-source" data-testid="kid-source">{task.prompt.prompt}</p>
          <form
            id={formId}
            className="kid-written"
            onSubmit={(event) => {
              event.preventDefault();
              if (complete && !disabled) {
                handlers.onSubmitText(characters.map((character, index) => character === "_" ? letters[index] : character).join(""));
              }
            }}
          >
            <div className="kid-letter-fragment" data-testid="kid-fragment" role="group" aria-label={messages.kid.fillLetters}>
              {characters.map((character, index) => character === "_" ? (
                <LetterField
                  key={index}
                  ref={(input) => { inputRefs.current[index] = input; }}
                  className="kid-letter-input"
                  data-testid="kid-letter-input"
                  aria-label={format(messages.kid.missingLetterPosition, { n: index + 1 })}
                  value={letters[index] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value.normalize("NFC");
                    if (Array.from(value).length > 1) return;
                    updateLetters({ ...letters, [index]: value });
                    handlers.onEdit();
                    if (value !== "") {
                      const nextPosition = gapPositions.find((position) => position > index);
                      if (nextPosition !== undefined) inputRefs.current[nextPosition]?.focus({ preventScroll: true });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace") {
                      if (!letters[index] || letters[index] === "") {
                        const prevPosition = [...gapPositions].reverse().find((position) => position < index);
                        if (prevPosition !== undefined) {
                          event.preventDefault();
                          const prevInput = inputRefs.current[prevPosition];
                          prevInput?.focus({ preventScroll: true });
                          prevInput?.select();
                        }
                      }
                    } else if (event.key === "ArrowLeft") {
                      const prevPosition = [...gapPositions].reverse().find((position) => position < index);
                      if (prevPosition !== undefined) {
                        event.preventDefault();
                        inputRefs.current[prevPosition]?.focus({ preventScroll: true });
                      }
                    } else if (event.key === "ArrowRight") {
                      const nextPosition = gapPositions.find((position) => position > index);
                      if (nextPosition !== undefined) {
                        event.preventDefault();
                        inputRefs.current[nextPosition]?.focus({ preventScroll: true });
                      }
                    }
                  }}
                  maxLength={1}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={disabled}
                />
              ) : (
                <m.span key={index} className="kid-letter-fixed" initial={kidEntranceInitial} animate={kidEntranceAnimate} transition={{ ...kidSpringGentle, delay: kidStaggerDelay(index) }} style={{ display: "inline-block" }}>{character}</m.span>
              ))}
            </div>
          </form>
        </>
      )}
      actions={(
        <ActionButton
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-submit"
          disabled={disabled || !complete}
        >
          {messages.kid.check}
        </ActionButton>
      )}
      secondaryActions={<div className="kid-secondary-actions">
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {messages.kid.notRemember}
        </ActionButton>
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </ActionButton>
      </div>}
    />
  );
}
