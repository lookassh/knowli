import { useState } from "react";
import { messages, type UiAudioKey } from "@learning/contracts";
import { ActionButton } from "./ActionButton";
import { IconActionButton } from "./IconActionButton";
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
    <IconActionButton className="kid-icon-button" data-testid={testId} aria-label={messages.kid.listen} onClick={() => void play()}>
      <KidIcon name="volume" />
    </IconActionButton>
    {failed && showError && <div className="kid-notice" role="alert" data-testid={`${testId}-error`}>
      <p>{messages.errors.picture_guidance_unavailable}</p>
      <ActionButton priority="secondary" fullWidth={false} size="sm" onClick={() => void play()}>{messages.errors.picture_audio_retry}</ActionButton>
    </div>}
  </>;
}
