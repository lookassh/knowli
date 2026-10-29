import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";
import { ActionButton } from "../components/ActionButton";
import { IconActionButton } from "../components/IconActionButton";

export function PictureSpeechView(props: ExerciseProps) {
  const { task, busy, mediaUrl, micAvailable, recordingPhase, automaticRecording, microphoneReady, inputLevel, recordingNotice, technicalRecordingIssue, recordingMode, dock, handlers } = props;
  if (task.prompt.kind !== "picture_speech") return null;
  const captureBlocksActions = recordingPhase !== "idle" && !automaticRecording;
  return <ExerciseFrame
      dock={dock}
    task={task}
    content={<>
      <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
      {/* Odsłuch pod obrazkiem, jak w PictureRecallView; panel wyniku go blokuje. */}
      {task.prompt.audioAssetId && <IconActionButton className="kid-audio-round" radius="50%" style={{ width: 64, height: 64, minWidth: 64, minHeight: 64 }} data-testid="kid-play" disabled={busy || captureBlocksActions || dock !== undefined} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></IconActionButton>}
      <p className="kid-hint">{messages.kid.sayIt}</p>
      {micAvailable && <SpeechRecordButton phase={recordingPhase} ready={microphoneReady} disabled={busy} level={inputLevel} notice={recordingNotice} mode={recordingMode} onPrepare={handlers.onPrepareRecording} onStart={handlers.onRecord} onStop={handlers.onStopRecording} onCancel={handlers.onCancelRecording} />}
    </>}
    secondaryActions={(!micAvailable || technicalRecordingIssue) && <div className="kid-secondary-actions"><ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-technical-next" disabled={busy || captureBlocksActions} onClick={handlers.onSkip}>{messages.kid.feedbackNext}</ActionButton></div>}
  />;
}
