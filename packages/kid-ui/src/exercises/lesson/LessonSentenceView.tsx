import { useState } from "react";
import { messages } from "@learning/contracts";
import { KidIcon } from "../../components/KidIcon";
import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";

/**
 * Pole zdania dla `lesson_error_fix` / `lesson_transform` / `lesson_open_answer`:
 * polecenie (z ramki), zdanie wyjściowe i pole tekstowe bez autokorekty.
 * „Sprawdź” wysyła odpowiedź `text`. `lesson_open_answer` nie ma deterministycznej
 * oceny do czasu zadania 15 — serwer odpowie wtedy `not_assessed`, a widok
 * feedbacku pokaże komunikat techniczny bez sugerowania błędu. Gdy przedmiot ma
 * TTS odpowiedzi, pojawia się „Posłuchaj” — odsłuch zdania wzorcowego jest
 * dozwolonym wsparciem (wym. 4.6; serwer pieczętuje ekspozycję przed bajtami).
 */
export function LessonSentenceView({ task, busy, handlers }: ExerciseProps) {
  const [text, setText] = useState("");
  if (
    task.prompt.kind !== "lesson_error_fix" &&
    task.prompt.kind !== "lesson_transform" &&
    task.prompt.kind !== "lesson_open_answer"
  ) {
    return null;
  }
  const source = task.prompt.kind === "lesson_open_answer" ? task.prompt.prompt : task.prompt.statement;
  const hasAudio = task.prompt.audioAssetId !== undefined;
  const disabled = busy;
  const formId = `kid-lesson-sentence-${task.taskId}`;

  return (
    <ExerciseFrame
      task={task}
      content={(
        <>
          <p className="kid-lesson-source" data-testid="kid-lesson-source" lang="en-GB">{source}</p>
          <form
            id={formId}
            className="kid-written"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() !== "" && !disabled) handlers.onSubmitText(text);
            }}
          >
            <input
              data-testid="kid-lesson-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={messages.kid.typeWord}
              aria-label={messages.kid.lessonSourceSentence}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
            />
          </form>
          {hasAudio && (
            <button
              type="button"
              className="kid-play"
              data-testid="kid-lesson-listen"
              disabled={disabled}
              onClick={handlers.onPlay}
              aria-label={messages.kid.listen}
            >
              <KidIcon name="volume" />
            </button>
          )}
        </>
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
