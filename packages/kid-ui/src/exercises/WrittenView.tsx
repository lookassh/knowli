import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";

/**
 * Samodzielne przypomnienie i samodzielna pisownia
 * (SPEC §12.5, §12.8). Pola pisowni wyłączają autokorektę, sprawdzanie
 * pisowni, autouzupełnianie i automatyczną kapitalizację w zakresie dostępnym
 * na urządzeniu. Odpowiedź ustna jest dostępna wyłącznie dla samodzielnego
 * Recall; wsparcie pisowni pozostaje zadaniem tekstowym. Dostępne są też
 * „Nie pamiętam — pokaż” i „Pomiń”.
 */
export function WrittenView({ task, busy, recording, recordingPhase, microphoneReady, inputLevel, recordingNotice, recordingMode, micAvailable, handlers, mockTest }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  if (task.prompt.kind !== "recall" && task.prompt.kind !== "spelling") {
    return null;
  }
  const disabled = busy || recording || recordingPhase !== "idle";
  return (
    <section className="kid-card">
      <p className="kid-source" data-testid="kid-source">
        {task.prompt.prompt}
      </p>
      <form
        className="kid-written"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== "" && !disabled) {
            handlers.onSubmitText(text);
          }
        }}
      >
        <input
          ref={inputRef}
          data-testid="kid-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={messages.kid.typeWord}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={messages.kid.typeWord}
        />
        <button type="submit" className="kid-primary" data-testid="kid-submit" disabled={disabled || text.trim() === ""}>
          {mockTest ? messages.kid.mockTestSubmit : messages.kid.check}
        </button>
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
      <div className="kid-secondary-actions">
        <button type="button" data-testid="kid-not-remember" disabled={disabled} onClick={handlers.onNotRemember}>
          {mockTest ? messages.kid.mockTestNotRemember : messages.kid.notRemember}
        </button>
        <button type="button" data-testid="kid-skip" disabled={disabled} onClick={handlers.onSkip}>
          {messages.kid.skip}
        </button>
      </div>
    </section>
  );
}
