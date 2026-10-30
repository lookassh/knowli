import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { IconActionButton } from "./IconActionButton";
import { KidIcon } from "./KidIcon";
import { SoundRing } from "../motion/SoundRing";

/** „Posłuchaj pytania” (design szkoły §11.4): odsłuch nagrania polecenia
 * i pytania na żądanie, w wierszu instrukcji za tekstem. Ponowne dotknięcie
 * zaczyna od początku. Komunikat błędu pokazuje ekran nauki w pasku statusu
 * (`questionAudioError`), nie ten wiersz — jak odsłuch polecenia. */
export function QuestionAudioButton({ onPlay, disabled }: {
  onPlay: () => Promise<void>;
  disabled: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  // Ponowne dotknięcie zatrzymuje poprzednie odtwarzanie i domyka jego obietnicę;
  // wskaźnik gasi tylko ostatnie wywołanie, żeby nie zgasić nowego odsłuchu.
  const latest = useRef(0);
  const play = async () => {
    const run = ++latest.current;
    setPlaying(true);
    try {
      await onPlay();
    } catch {
      // Błąd odtwarzania raportuje kontroler sesji (`questionAudioError`).
    } finally {
      if (run === latest.current) setPlaying(false);
    }
  };
  return (
    <IconActionButton className="kid-icon-button" data-testid="kid-question-audio" variant="outlined" disabled={disabled}
      aria-label={messages.kid.listenLessonQuestion} data-sound-active={playing || undefined} onClick={() => void play()}>
      <KidIcon name="volume" />
      {playing && <SoundRing />}
    </IconActionButton>
  );
}
