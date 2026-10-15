import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";

export function PictureRecallView({ task, busy, mediaUrl, micAvailable, recordingPhase, microphoneReady, inputLevel, recordingNotice, recordingMode, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "picture_recall") return null;
  return <ExerciseFrame task={task}
    content={<>
      <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
      <p className="kid-hint">{messages.kid.pictureRecallPrompt}</p>
      {micAvailable && <SpeechRecordButton phase={recordingPhase} ready={microphoneReady} disabled={busy} level={inputLevel} notice={recordingNotice} mode={recordingMode} onPrepare={handlers.onPrepareRecording} onStart={handlers.onRecord} onStop={handlers.onStopRecording} onCancel={handlers.onCancelRecording} />}
    </>}
    actions={<button type="button" className="kid-audio-round" disabled={busy} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></button>}
    secondaryActions={<div className="kid-secondary-actions">
      <button type="button" data-testid="kid-not-remember" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onNotRemember}><KidIcon name="question" />{messages.kid.mockTestNotRemember}</button>
      <button type="button" data-testid="kid-skip" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onSkip}><KidIcon name="arrow-right" />{messages.kid.skip}</button>
    </div>} />;
}
