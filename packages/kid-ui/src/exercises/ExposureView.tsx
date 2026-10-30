import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ListenButton } from "../components/ListenButton";
import { Visual } from "../visuals/Visual";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";
import { shouldIgnoreKeyboardShortcut } from "./useChoiceKeyboard";
import { ActionButton } from "../components/ActionButton";

/**
 * Poznanie słowa (SPEC §12.1): angielskie słowo, polskie znaczenie i pomoc
 * wizualna; wzorcowa wymowa odtwarzana po świadomym „Start” sesji, ponowny
 * odsłuch na żądanie. Bez odpowiedzi i bez oceny.
 */
export function ExposureView({ task, busy, mediaUrl, dock, handlers }: ExerciseProps) {
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    doneRef.current?.focus({ preventScroll: true });
  }, [task.taskId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(event)) return;
      if (event.key === " " || event.code === "Space") {
        if (event.repeat) return;
        const active = typeof document !== "undefined" ? document.activeElement : null;
        if (active?.getAttribute("data-testid") === "kid-done") return;
        if (task.prompt.kind === "exposure" && task.prompt.audioAssetId !== null && !busy) {
          event.preventDefault();
          handlers.onPlay();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [task.taskId, task.prompt, busy, handlers]);

  if (task.prompt.kind !== "exposure") {
    return null;
  }
  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <div className="kid-exposure-content">
          {task.prompt.visualType === "image" && task.prompt.imageAssetId !== null ? (
            <img
              className="kid-illustration"
              data-testid="kid-illustration"
              src={mediaUrl(task.prompt.imageAssetId)}
              alt={task.prompt.target}
            />
          ) : (
            <Visual
              text={task.prompt.target}
              visualType={task.prompt.visualType}
              visualData={task.prompt.visualData}
            />
          )}
          <div className="kid-word-row">
              <p className="kid-word" data-testid="kid-target">
              {task.prompt.target}
              </p>
            {task.prompt.audioAssetId !== null && (
              <ListenButton
                size="lg"
                data-testid="kid-play"
                disabled={busy}
                onClick={handlers.onPlay}
                aria-label={messages.kid.listen}
              />
            )}
          </div>
          <p className="kid-source" data-testid="kid-source">
            {task.prompt.source}
          </p>
          {task.prompt.example !== null && (
            <div className="kid-example-block">
                <p className="kid-example" data-testid="kid-example">
                {task.prompt.example}
                </p>
              {task.prompt.exampleAudioAssetId !== null && (
                <ListenButton
                  data-testid="kid-play-example"
                  disabled={busy}
                  onClick={handlers.onPlayExample}
                  aria-label={messages.kid.listenExample}
                />
              )}
            </div>
          )}
        </div>
      )}
      actions={(
        <ActionButton
          ref={doneRef}
          type="button"
          className="kid-primary"
          data-testid="kid-done"
          disabled={busy}
          onClick={handlers.onComplete}
        >
          <KidIcon name="check" />
          {messages.kid.understand}
        </ActionButton>
      )}
    />
  );
}
