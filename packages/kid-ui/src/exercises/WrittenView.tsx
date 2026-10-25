import { useEffect, useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { SpeechRecordButton } from "./SpeechRecordButton";
import { ExerciseFrame } from "./ExerciseFrame";
import { useRetryReset } from "./useRetryReset";
import type { ExerciseProps } from "./types";
import { AnswerField } from "../components/AnswerField";
import { ActionButton } from "../components/ActionButton";

/**
 * Samodzielne przypomnienie i samodzielna pisownia
 * (SPEC §12.5, §12.8). Pola pisowni wyłączają autokorektę, sprawdzanie
 * pisowni, autouzupełnianie i automatyczną kapitalizację w zakresie dostępnym
 * na urządzeniu. Odpowiedź ustna jest dostępna wyłącznie dla samodzielnego
 * Recall; wsparcie pisowni pozostaje zadaniem tekstowym. Dostępne są też
 * „Nie pamiętam — pokaż” i „Pomiń”.
 */
export function WrittenView({ task, busy, recording, recordingPhase, microphoneReady, inputLevel, recordingNotice, recordingMode, micAvailable, dock, handlers, mockTest }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = `kid-written-${task.taskId}`;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [task.taskId]);
  useRetryReset(dock, () => setText(""), () => inputRef.current?.focus({ preventScroll: true }));
  if (task.prompt.kind !== "recall" && task.prompt.kind !== "spelling") {
    return null;
  }
  const disabled = busy || recording || recordingPhase !== "idle";
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
              if (text.trim() !== "" && !disabled) {
                handlers.onSubmitText(text);
              }
            }}
          >
            <AnswerField
              ref={inputRef}
              data-testid="kid-input"
              value={text}
              onChange={(event) => { setText(event.target.value); handlers.onEdit(); }}
              placeholder={messages.kid.typeWord}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={disabled}
              aria-label={messages.kid.typeWord}
            />
          </form>
          {micAvailable && task.prompt.kind === "recall" && (
            <SpeechRecordButton
              phase={recordingPhase}
              ready={microphoneReady}
              disabled={busy}
              level={inputLevel}
              notice={recordingNotice}
              mode={recordingMode}
              onPrepare={handlers.onPrepareRecording}
              onStart={handlers.onRecord}
              onStop={handlers.onStopRecording}
              onCancel={handlers.onCancelRecording}
            />
          )}
        </>
      )}
      actions={(
        <ActionButton
          form={formId}
          type="submit"
          className="kid-primary"
          data-testid="kid-submit"
          disabled={disabled || text.trim() === ""}
        >
          {mockTest ? messages.kid.mockTestSubmit : messages.kid.check}
        </ActionButton>
      )}
      secondaryActions={<div className="kid-secondary-actions">
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {mockTest ? messages.kid.mockTestNotRemember : messages.kid.notRemember}
        </ActionButton>
        <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </ActionButton>
      </div>}
    />
  );
}
