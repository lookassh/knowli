import { useState } from "react";
import { messages, type UiAudioKey } from "@learning/contracts";
import { KidIcon } from "./KidIcon";

/** Jawny odsłuch krótkiej instrukcji albo komunikatu interfejsu. */
export function GuidanceButton({
  audioKey,
  onPlay,
  testId,
  showError = true,
}: {
  audioKey: UiAudioKey;
  onPlay: (key: UiAudioKey) => Promise<void>;
  testId: string;
  showError?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const play = async () => {
    setFailed(false);
    try {
      await onPlay(audioKey);
    } catch {
      setFailed(true);
    }
  };
  return <>
    <button type="button" className="kid-icon-button" data-testid={testId} aria-label={messages.kid.listen} onClick={() => void play()}>
      <KidIcon name="volume" />
    </button>
    {failed && showError && <div className="kid-notice" role="alert" data-testid={`${testId}-error`}>
      <p>{messages.errors.picture_guidance_unavailable}</p>
      <button type="button" onClick={() => void play()}>{messages.errors.picture_audio_retry}</button>
    </div>}
  </>;
}
