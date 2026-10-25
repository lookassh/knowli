import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";
import { ActionButton } from "../components/ActionButton";

export function PictureRecallView({ task, busy, mediaUrl, micAvailable, recordingPhase, microphoneReady, inputLevel, recordingNotice, recordingMode, dock, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "picture_recall") return null;
  return <ExerciseFrame task={task}
      dock={dock}
    content={<>
      <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
      <p className="kid-hint">{messages.kid.pictureRecallPrompt}</p>
      {micAvailable && <SpeechRecordButton phase={recordingPhase} ready={microphoneReady} disabled={busy} level={inputLevel} notice={recordingNotice} mode={recordingMode} onPrepare={handlers.onPrepareRecording} onStart={handlers.onRecord} onStop={handlers.onStopRecording} onCancel={handlers.onCancelRecording} />}
    </>}
    actions={<ActionButton fullWidth={false} type="button" className="kid-audio-round" disabled={busy} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></ActionButton>}
    secondaryActions={<div className="kid-secondary-actions">
      <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-not-remember" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onNotRemember}><KidIcon name="question" />{messages.kid.mockTestNotRemember}</ActionButton>
      <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-skip" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onSkip}><KidIcon name="arrow-right" />{messages.kid.skip}</ActionButton>
    </div>} />;
}
