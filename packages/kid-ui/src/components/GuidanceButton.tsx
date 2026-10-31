import { useState } from "react";
import { messages, type UiAudioKey } from "@learning/contracts";
import { ActionButton } from "./ActionButton";
import { IconActionButton } from "./IconActionButton";
import { KidIcon } from "./KidIcon";
import { ListenButton } from "./ListenButton";
import { SoundRing } from "../motion/SoundRing";

/** Jawny odsłuch krótkiej instrukcji albo komunikatu interfejsu. W wierszu
 * instrukcji (`placement="instruction"`) przycisk jest obrysowany, ze znakiem
 * zapytania i własną nazwą, żeby nie udawał odsłuchu słowa stojącego obok.
 * `icon="question"` w doku: ten sam obrysowany „?” przy nazwie doku — gdy obok
 * stoi głośnik odczytu zdania, komunikat nie może wyglądać jak drugi głośnik. */
export function GuidanceButton({
  audioKey,
  onPlay,
  testId,
  showError = true,
  placement = "dock",
  icon,
}: {
  audioKey: UiAudioKey;
  onPlay: (key: UiAudioKey) => Promise<void>;
  testId: string;
  showError?: boolean;
  placement?: "instruction" | "dock";
  icon?: "speaker" | "question";
}) {
  const inInstruction = placement === "instruction";
  const question = (icon ?? (inInstruction ? "question" : "speaker")) === "question";
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    setFailed(false);
    setPlaying(true);
    try {
      await onPlay(audioKey);
    } catch {
      setFailed(true);
    } finally {
      setPlaying(false);
    }
  };
  return <>
    {question ? (
      <IconActionButton className="kid-icon-button" data-testid={testId} variant="outlined" data-guidance-icon="question"
        aria-label={inInstruction ? messages.kid.listenInstruction : messages.kid.listen} data-sound-active={playing || undefined} onClick={() => void play()}>
        <KidIcon name="question" />
        {playing && <SoundRing />}
      </IconActionButton>
    ) : (
      <ListenButton data-testid={testId} data-guidance-icon="speaker" aria-label={messages.kid.listen} data-sound-active={playing || undefined} onClick={() => void play()}>
        {playing && <SoundRing />}
      </ListenButton>
    )}
    {failed && showError && <div className="kid-notice" role="alert" data-testid={`${testId}-error`}>
      <p>{messages.errors.picture_guidance_unavailable}</p>
      <ActionButton priority="secondary" fullWidth={false} size="sm" onClick={() => void play()}>{messages.errors.picture_audio_retry}</ActionButton>
    </div>}
  </>;
}
