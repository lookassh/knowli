import { useId, useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import type { ExerciseProps } from "./types";

/** Luki są jedynymi polami edycji; pełną odpowiedź ocenia istniejące Kid API. */
export function LetterCompletionView({ task, busy, recording, handlers }: ExerciseProps) {
  const [letters, setLetters] = useState<Record<number, string>>({});
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const instructionId = useId();
  if (task.prompt.kind !== "letter_completion") return null;

  const characters = Array.from(task.prompt.fragment);
  const gapPositions = characters.flatMap((character, index) => character === "_" ? [index] : []);
  const complete = gapPositions.length > 0 && gapPositions.every((position) => Boolean(letters[position]));
  const disabled = busy || recording;

  return (
    <section className="kid-card">
      <p className="kid-source" data-testid="kid-source">{task.prompt.prompt}</p>
      <p id={instructionId} data-testid="kid-letter-instruction">{messages.kid.fillLetters}</p>
      <form
        className="kid-written"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !disabled) {
            handlers.onSubmitText(characters.map((character, index) => character === "_" ? letters[index] : character).join(""));
          }
        }}
      >
        <div className="kid-letter-fragment" data-testid="kid-fragment" role="group" aria-labelledby={instructionId}>
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
                setLetters((previous) => ({ ...previous, [index]: value }));
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
        <button type="submit" className="kid-primary" data-testid="kid-submit" disabled={disabled || !complete}>
          {messages.kid.check}
        </button>
      </form>
      <div className="kid-secondary-actions">
        <button type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {messages.kid.notRemember}
        </button>
        <button type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </button>
      </div>
    </section>
  );
}
