import { useState } from "react";
import { messages } from "@learning/contracts";
import { ActionButton } from "./ActionButton";
import { IconActionButton } from "./IconActionButton";
import { KidIcon } from "./KidIcon";
import { SoundRing } from "../motion/SoundRing";

/** „Posłuchaj pytania” (design szkoły §11.4): odsłuch nagrania polecenia
 * i pytania na żądanie, w wierszu instrukcji za tekstem. Ponowne dotknięcie
 * zaczyna od początku; błąd odtwarzania nie blokuje zadania. */
export function QuestionAudioButton({ onPlay, disabled }: {
  onPlay: () => Promise<void>;
  disabled: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    setFailed(false);
    setPlaying(true);
    try {
      await onPlay();
    } catch {
      setFailed(true);
    } finally {
      setPlaying(false);
    }
  };
  return <>
    <IconActionButton className="kid-icon-button" data-testid="kid-question-audio" variant="outlined" disabled={disabled}
      aria-label={messages.kid.listenLessonQuestion} data-sound-active={playing || undefined} onClick={() => void play()}>
      <KidIcon name="volume" />
      {playing && <SoundRing />}
    </IconActionButton>
    {failed && <div className="kid-notice" role="alert" data-testid="kid-question-audio-error">
      <p>{messages.kid.questionAudioUnavailable}</p>
      <ActionButton priority="secondary" fullWidth={false} size="sm" onClick={() => void play()}>{messages.kid.questionAudioRetry}</ActionButton>
    </div>}
  </>;
}
