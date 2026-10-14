import { messages } from "@learning/contracts";
import { ExerciseFrame } from "./ExerciseFrame";
import { KidIcon } from "../components/KidIcon";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";

export function PictureExposureView({ task, busy, mediaUrl, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "picture_exposure") return null;
  return <ExerciseFrame task={task} content={<div className="kid-exposure-content"><MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} /><button type="button" className="kid-play-big" data-testid="kid-play" disabled={busy || !task.prompt.audioAssetId} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></button></div>} actions={<button type="button" className="kid-primary" data-testid="kid-done" disabled={busy} onClick={handlers.onComplete}>{messages.kid.understand}</button>} />;
}
