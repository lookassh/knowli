import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";

/**
 * Samodzielne przypomnienie, uzupełnianie liter i samodzielna pisownia
 * (SPEC §12.5, §12.7, §12.8). Pola pisowni wyłączają autokorektę, sprawdzanie
 * pisowni, autouzupełnianie i automatyczną kapitalizację w zakresie dostępnym
 * na urządzeniu. Odpowiedź ustna jest dostępna wyłącznie dla samodzielnego
 * Recall; wsparcie pisowni pozostaje zadaniem tekstowym. Dostępne są też
 * „Nie pamiętam — pokaż” i „Pomiń”.
 */
export function WrittenView({ task, busy, recording, micAvailable, handlers }: ExerciseProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  if (task.prompt.kind !== "recall" && task.prompt.kind !== "spelling" && task.prompt.kind !== "letter_completion") {
    return null;
  }
  const disabled = busy || recording;
  return (
    <section className="kid-card">
      <p className="kid-source" data-testid="kid-source">
        {task.prompt.prompt}
      </p>
      {task.prompt.kind === "letter_completion" && (
        <>
          <p className="kid-fragment" data-testid="kid-fragment">{task.prompt.fragment}</p>
          <p data-testid="kid-letter-instruction">{messages.kid.typeWholeWordWithLetters}</p>
        </>
      )}
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
          placeholder={task.prompt.kind === "letter_completion" ? messages.kid.fillLetters : messages.kid.typeWord}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          aria-label={messages.kid.typeWord}
        />
        <button type="submit" className="kid-primary" data-testid="kid-submit" disabled={disabled || text.trim() === ""}>
          {messages.kid.check}
        </button>
      </form>
      {micAvailable && task.prompt.kind === "recall" &&
        (recording ? (
          <div className="kid-recording-row">
            <span className="kid-recording" data-testid="kid-recording" role="status">
              ⏺ {messages.kid.recording}
            </span>
            <button type="button" className="kid-primary" data-testid="kid-stop-record" onClick={handlers.onStopRecording}>
              {messages.kid.stopRecording}
            </button>
          </div>
        ) : (
          <button type="button" data-testid="kid-record" disabled={busy} onClick={handlers.onRecord}>
            🎤 {messages.kid.record}
          </button>
        ))}
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
