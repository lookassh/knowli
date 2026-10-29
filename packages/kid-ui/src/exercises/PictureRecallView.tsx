import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import { SpeechRecordButton } from "./SpeechRecordButton";
import type { ExerciseProps } from "./types";
import { ActionButton } from "../components/ActionButton";
import { IconActionButton } from "../components/IconActionButton";

export function PictureRecallView({ task, busy, mediaUrl, micAvailable, recordingPhase, microphoneReady, inputLevel, recordingNotice, technicalRecordingIssue, recordingMode, dock, handlers, mockTest }: ExerciseProps) {
  if (task.prompt.kind !== "picture_recall") return null;
  // Odsłuch stoi w materiale, więc panel wyniku go nie odmontowuje: po ostatniej
  // próbie serwer odrzuciłby autoryzację odsłuchu, dlatego panel go blokuje.
  return <ExerciseFrame task={task}
      dock={dock}
    content={<>
      <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
      <IconActionButton className="kid-audio-round" radius="50%" style={{ width: 64, height: 64, minWidth: 64, minHeight: 64 }} disabled={busy || dock !== undefined} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></IconActionButton>
      <p className="kid-hint">{messages.kid.pictureRecallPrompt}</p>
      {micAvailable && <SpeechRecordButton phase={recordingPhase} ready={microphoneReady} disabled={busy} level={inputLevel} notice={recordingNotice} mode={recordingMode} onPrepare={handlers.onPrepareRecording} onStart={handlers.onRecord} onStop={handlers.onStopRecording} onCancel={handlers.onCancelRecording} />}
    </>}
    secondaryActions={<div className="kid-secondary-actions">
      <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-not-remember" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onNotRemember}>{messages.kid.mockTestNotRemember}</ActionButton>
      {!mockTest && (!micAvailable || technicalRecordingIssue) && <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-technical-next" disabled={busy || recordingPhase !== "idle"} onClick={handlers.onSkip}>{messages.kid.feedbackNext}</ActionButton>}
    </div>} />;
}
