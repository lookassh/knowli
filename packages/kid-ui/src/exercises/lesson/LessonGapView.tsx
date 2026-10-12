import { useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { splitGap } from "./gap";

/**
 * Luka (`lesson_gap`): zdanie z polem edycji dokładnie w miejscu luki i
 * podpowiedzią bezokolicznika pod spodem. Pole wyłącza autokorektę i
 * autouzupełnianie (jak pisownia słówek). „Sprawdź” wysyła całe wpisane słowo
 * jako odpowiedź `text`; serwer ocenia tylko element sprawdzany.
 */
export function LessonGapView({ task, busy, handlers }: ExerciseProps) {
  const [text, setText] = useState("");
  if (task.prompt.kind !== "lesson_gap") return null;
  const { before, after } = splitGap(task.prompt.stemWithGap);
  const hint = task.prompt.hint;
  const disabled = busy;
  const formId = `kid-lesson-gap-${task.taskId}`;
  const submit = () => { if (text.trim() !== "" && !disabled) handlers.onSubmitText(text); };

  return (
    <ExerciseFrame
      task={task}
      content={(
        <form
          id={formId}
          className="kid-lesson-gap"
          data-testid="kid-lesson-gap"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <p className="kid-lesson-gap__stem">
            <span>{before}</span>
            <input
              className="kid-lesson-gap__input"
              data-testid="kid-lesson-gap-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label={messages.kid.lessonGapInput}
              placeholder="…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
            />
            <span>{after}</span>
          </p>
          {hint !== undefined && (
            <p className="kid-lesson-gap__hint" data-testid="kid-lesson-gap-hint">
              {format(messages.kid.lessonGapHint, { hint })}
            </p>
          )}
        </form>
      )}
      actions={(
        <button
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-lesson-check"
          disabled={disabled || text.trim() === ""}
        >
          {messages.kid.lessonCheck}
        </button>
      )}
    />
  );
}
