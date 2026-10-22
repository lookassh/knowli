import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";

export function PictureSpeechView(props: ExerciseProps) {
  const { task, busy, mediaUrl, micAvailable, recordingPhase, automaticRecording, microphoneReady, inputLevel, recordingNotice, recordingMode, handlers } = props;
  if (task.prompt.kind !== "picture_speech") return null;
  const captureBlocksActions = recordingPhase !== "idle" && !automaticRecording;
  return <ExerciseFrame
    task={task}
    content={<>
      <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
      <p className="kid-hint">{messages.kid.sayIt}</p>
      {micAvailable && <SpeechRecordButton phase={recordingPhase} ready={microphoneReady} disabled={busy} level={inputLevel} notice={recordingNotice} mode={recordingMode} onPrepare={handlers.onPrepareRecording} onStart={handlers.onRecord} onStop={handlers.onStopRecording} onCancel={handlers.onCancelRecording} />}
    </>}
    actions={task.prompt.audioAssetId ? <button type="button" data-testid="kid-play" className="kid-audio-round" disabled={busy || captureBlocksActions} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></button> : undefined}
    secondaryActions={<div className="kid-secondary-actions"><button type="button" data-testid="kid-skip" disabled={busy || captureBlocksActions} onClick={handlers.onSkip}>{messages.kid.skip}</button></div>}
  />;
}
