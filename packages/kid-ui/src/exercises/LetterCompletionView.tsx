import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";

/** Luki są jedynymi polami edycji; pełną odpowiedź ocenia istniejące Kid API. */
export function LetterCompletionView({ task, busy, recording, handlers, letterDraft, onLetterDraftChange }: ExerciseProps) {
  const [localLetters, setLocalLetters] = useState<Record<number, string>>({});
  const letters = letterDraft ?? localLetters;
  const updateLetters = onLetterDraftChange ?? setLocalLetters;
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  if (task.prompt.kind !== "letter_completion") return null;

  const characters = Array.from(task.prompt.fragment);
  const gapPositions = characters.flatMap((character, index) => character === "_" ? [index] : []);
  const complete = gapPositions.length > 0 && gapPositions.every((position) => Boolean(letters[position]));
  const disabled = busy || recording;
  const formId = `kid-letters-${task.taskId}`;

  return (
    <ExerciseFrame
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
                <input
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
                    handlers.onInteraction();
                    if (value !== "") {
                      const nextPosition = gapPositions.find((position) => position > index);
                      if (nextPosition !== undefined) inputRefs.current[nextPosition]?.focus();
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
                <span key={index} className="kid-letter-fixed">{character}</span>
              ))}
            </div>
          </form>
        </>
      )}
      actions={(
        <button
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-submit"
          disabled={disabled || !complete}
        >
          {messages.kid.check}
        </button>
      )}
      secondaryActions={<div className="kid-secondary-actions">
        <button type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {messages.kid.notRemember}
        </button>
        <button type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </button>
      </div>}
    />
  );
}
