import { useEffect, useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { KidIcon } from "../../components/KidIcon";
import { ActionButton } from "../../components/ActionButton";
import { AnswerField } from "../../components/AnswerField";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";

/**
 * Pole zdania dla `lesson_error_fix` / `lesson_transform` / `lesson_open_answer`
 * oraz wyniku `lesson_calculation`:
 * polecenie (z ramki), zdanie wyjściowe i pole tekstowe bez autokorekty.
 * „Sprawdź” wysyła odpowiedź `text`. `lesson_open_answer` nie ma deterministycznej
 * oceny do czasu zadania 15 — serwer odpowie wtedy `not_assessed`, a widok
 * feedbacku pokaże komunikat techniczny bez sugerowania błędu. Gdy przedmiot ma
 * TTS odpowiedzi, pojawia się „Posłuchaj” — odsłuch zdania wzorcowego jest
 * dozwolonym wsparciem (wym. 4.6; serwer pieczętuje ekspozycję przed bajtami).
 */
export function LessonSentenceView({ task, busy, dock, handlers }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [task.taskId]);
  useRetryReset(dock, () => setText(""), () => inputRef.current?.focus({ preventScroll: true }));

  if (
    task.prompt.kind !== "lesson_error_fix" &&
    task.prompt.kind !== "lesson_transform" &&
    task.prompt.kind !== "lesson_open_answer" &&
    task.prompt.kind !== "lesson_calculation"
  ) {
    return null;
  }
  // Rachunek: polskie polecenie i wynik z jednostką wpisany dosłownie (przecinek,
  // spacje tysięcy); poprawność liczy wyłącznie serwer.
  const calculation = task.prompt.kind === "lesson_calculation";
  const source = task.prompt.kind === "lesson_open_answer" || task.prompt.kind === "lesson_calculation"
    ? task.prompt.prompt
    : task.prompt.statement;
  const hasAudio = task.prompt.kind !== "lesson_calculation" && task.prompt.audioAssetId !== undefined;
  // Język pytania: rachunek zawsze po polsku; odpowiedź otwarta podaje go, gdy jest
  // jednoznaczny (szkoła) — wtedy dziecko odpowiada w tym samym języku.
  const knownLocale = calculation ? "pl-PL" : task.prompt.kind === "lesson_open_answer" ? task.prompt.promptLocale : undefined;
  const sourceLang = knownLocale ?? "en-GB";
  const disabled = busy;
  const formId = `kid-lesson-sentence-${task.taskId}`;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <>
          <p className="kid-lesson-source" data-testid="kid-lesson-source" lang={sourceLang}>{source}</p>
          <form
            id={formId}
            className="kid-written"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() !== "" && !disabled) handlers.onSubmitText(text);
            }}
          >
            <AnswerField
              ref={inputRef}
              data-testid="kid-lesson-input"
              value={text}
              onChange={(event) => { setText(event.target.value); handlers.onEdit(); }}
              placeholder={calculation ? messages.kid.lessonCalculationPlaceholder : messages.kid.typeWord}
              aria-label={calculation ? messages.kid.lessonCalculationInput : messages.kid.lessonSourceSentence}
              {...(knownLocale ? { lang: knownLocale } : {})}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
            />
          </form>
          {hasAudio && (
            <ActionButton
              type="button"
              className="kid-play"
              priority="secondary"
              size="sm"
              fullWidth={false}
              style={{ minHeight: 48 }}
              data-testid="kid-lesson-listen"
              disabled={disabled}
              onClick={handlers.onPlay}
              aria-label={messages.kid.listen}
            >
              <KidIcon name="volume" />
            </ActionButton>
          )}
        </>
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
        <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {messages.kid.notRemember}
        </ActionButton>
        <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </ActionButton>
      </div>}
    />
  );
}
