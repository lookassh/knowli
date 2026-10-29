import { useRef, useState } from "react";
import { MAX_TEXT_ATTEMPT_LENGTH, messages } from "@learning/contracts";
import { format } from "../../format";
import { ActionButton } from "../../components/ActionButton";
import { AnswerTextArea } from "../../components/AnswerField";
import { AnswerSegments } from "../../components/AnswerSegments";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";

/**
 * „Skróć odpowiedź” (`lesson_shorten`, technicznie odpowiedź otwarta):
 * pytanie, własna odpowiedź dziecka z zaznaczonymi fragmentami do usunięcia
 * (pigułki z DTO serwera — nic nie jest wyliczane lokalnie) i pole
 * wieloliniowe, które startuje z tą odpowiedzią; dziecko usuwa zaznaczone
 * części i wysyła `text` przez „Sprawdź”. Ponowna próba wraca do oryginału.
 * Pole nie dostaje fokusu przy starcie, aby klawiatura ekranowa nie zasłoniła
 * zaznaczeń, zanim dziecko je przeczyta. Skrócenie można pominąć („Pomiń”).
 */
export function LessonShortenView({ task, busy, dock, handlers }: ExerciseProps) {
  const original = task.prompt.kind === "lesson_shorten" ? task.prompt.originalAnswer : "";
  const [text, setText] = useState(original);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useRetryReset(dock, () => setText(original), () => inputRef.current?.focus({ preventScroll: true }));

  if (task.prompt.kind !== "lesson_shorten") return null;
  const disabled = busy;
  const formId = `kid-lesson-shorten-${task.taskId}`;
  const inputId = `${formId}-input`;
  const removed = task.prompt.answerSegments.filter((segment) => segment.state === "pill").map((segment) => segment.text.trim());

  return (
    <ExerciseFrame
      actionLayout="inline"
      dock={dock}
      task={task}
      content={(
        <div className="kid-lesson-shorten" data-testid="kid-lesson-shorten">
          <p className="kid-lesson-source" data-testid="kid-lesson-source">{task.prompt.prompt}</p>
          <AnswerSegments
            layout="text"
            segments={task.prompt.answerSegments}
            label={messages.kid.lessonShortenOriginal}
            testid="kid-lesson-shorten-original"
            {...(removed.length > 0 ? { pillDescription: format(messages.kid.lessonShortenRemove, { fragments: removed.join(", ") }) } : {})}
          />
          <form
            id={formId}
            className="kid-written kid-lesson-shorten__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() !== "" && !disabled) handlers.onSubmitText(text);
            }}
          >
            <label className="kid-spelling-row-label" htmlFor={inputId}>{messages.kid.lessonShortenInput}</label>
            <AnswerTextArea
              ref={inputRef}
              id={inputId}
              data-testid="kid-lesson-input"
              value={text}
              onChange={(event) => { setText(event.target.value); handlers.onEdit(); }}
              submitOnEnter
              // Same cap as the server contract, so the edited answer is never rejected.
              maxLength={MAX_TEXT_ATTEMPT_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
            />
          </form>
        </div>
      )}
      actions={(
        <ActionButton
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-lesson-check"
          disabled={disabled || text.trim() === ""}
        >
          {messages.kid.lessonCheck}
        </ActionButton>
      )}
      secondaryActions={<div className="kid-secondary-actions">
        <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </ActionButton>
      </div>}
    />
  );
}
