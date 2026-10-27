import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { useStimulusBounce } from "./useStimulusBounce";
import { ExerciseFrame } from "./ExerciseFrame";
import { KidIcon } from "../components/KidIcon";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";
import { shouldIgnoreKeyboardShortcut } from "./useChoiceKeyboard";
import { ActionButton } from "../components/ActionButton";

export function PictureExposureView({ task, busy, mediaUrl, dock, handlers }: ExerciseProps) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const [bounceKey, playWithBounce] = useStimulusBounce(handlers.onPlay);

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
        if (task.prompt.kind === "picture_exposure" && task.prompt.audioAssetId && !busy) {
          event.preventDefault();
          playWithBounce();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [task.taskId, task.prompt, busy, handlers]);

  if (task.prompt.kind !== "picture_exposure") return null;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <div className="kid-exposure-content">
          <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} bounceKey={bounceKey} />
          <ActionButton
            fullWidth={false}
            type="button"
            className="kid-play-big"
            data-testid="kid-play"
            disabled={busy || !task.prompt.audioAssetId}
            onClick={playWithBounce}
            aria-label={messages.kid.listen}
          >
            <KidIcon name="volume" />
          </ActionButton>
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
