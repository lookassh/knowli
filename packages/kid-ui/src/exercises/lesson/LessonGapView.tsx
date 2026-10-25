import { useEffect, useRef, useState } from "react";
import { Text } from "@mantine/core";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { KidIcon } from "../../components/KidIcon";
import { ActionButton } from "../../components/ActionButton";
import { AnswerField } from "../../components/AnswerField";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";
import { splitGap } from "./gap";

/**
 * Luka (`lesson_gap`): zdanie z polem edycji dokładnie w miejscu luki i
 * podpowiedzią bezokolicznika pod spodem. Pole wyłącza autokorektę i
 * autouzupełnianie (jak pisownia słówek). „Sprawdź” wysyła całe wpisane słowo
 * jako odpowiedź `text`; serwer ocenia tylko element sprawdzany. Gdy przedmiot
 * ma TTS odpowiedzi, pod zdaniem pojawia się „Posłuchaj” — odsłuch zdania
 * wzorcowego jest dozwolonym wsparciem (wym. 4.6; serwer pieczętuje ekspozycję
 * i kwalifikuje próbę jako wspomaganą).
 */
export function LessonGapView({ task, busy, dock, handlers }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [task.taskId]);
  useRetryReset(dock, () => setText(""), () => inputRef.current?.focus({ preventScroll: true }));

  if (task.prompt.kind !== "lesson_gap") return null;
  const { before, after } = splitGap(task.prompt.stemWithGap);
  const hint = task.prompt.hint;
  const hasAudio = task.prompt.audioAssetId !== undefined;
  const disabled = busy;
  const formId = `kid-lesson-gap-${task.taskId}`;
  const submit = () => { if (text.trim() !== "" && !disabled) handlers.onSubmitText(text); };

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <form
          id={formId}
          className="kid-lesson-gap"
          data-testid="kid-lesson-gap"
          onSubmit={(event) => { event.preventDefault(); submit(); }}
        >
          <div className="kid-lesson-gap__stem">
            <Text component="span">{before}</Text>
            <AnswerField
              ref={inputRef}
              className="kid-lesson-gap__field"
              classNames={{ input: "kid-lesson-gap__input" }}
              data-testid="kid-lesson-gap-input"
              value={text}
              onChange={(event) => { setText(event.target.value); handlers.onEdit(); }}
              aria-label={messages.kid.lessonGapInput}
              placeholder="…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
            />
            <Text component="span">{after}</Text>
          </div>
          {hint !== undefined && (
            <Text component="p" className="kid-lesson-gap__hint" data-testid="kid-lesson-gap-hint">
              {format(messages.kid.lessonGapHint, { hint })}
            </Text>
          )}
          {hasAudio && (
            <ActionButton
              type="button"
              className="kid-play"
              priority="secondary"
              size="sm"
              fullWidth={false}
              styles={{ root: { minHeight: 48 } }}
              data-testid="kid-lesson-listen"
              disabled={disabled}
              onClick={handlers.onPlay}
              aria-label={messages.kid.listen}
            >
              <KidIcon name="volume" />
            </ActionButton>
          )}
        </form>
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
      secondaryActions={(
        <div className="kid-secondary-actions">
          <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
            {messages.kid.notRemember}
          </ActionButton>
          <ActionButton priority="secondary" size="sm" fullWidth={false} type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
            {messages.kid.skip}
          </ActionButton>
        </div>
      )}
    />
  );
}
