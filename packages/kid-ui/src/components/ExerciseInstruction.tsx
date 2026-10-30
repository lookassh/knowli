import type { ReactNode, Ref } from "react";
import { messages } from "@learning/contracts";
import { KidIcon, type KidIconName } from "./KidIcon";
import { ListenButton } from "./ListenButton";
import classes from "./ExerciseInstruction.module.css";

export interface ExerciseInstructionAudio {
  onPlay: () => void;
  disabled: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Instrukcja zadania, opcjonalny odsłuch bodźca przez kontroler sesji (z przodu)
 * i opcjonalny odsłuch samej instrukcji (`guidance`, za tekstem). */
export function ExerciseInstruction({ instruction, icon, audio, guidance }: {
  instruction: string;
  icon: KidIconName;
  audio?: ExerciseInstructionAudio;
  guidance?: ReactNode;
}) {
  return (
    <header className={`kid-exercise-instruction ${classes.root}`} data-testid="kid-instruction">
      {audio ? (
        <ListenButton ref={audio.ref} disabled={audio.disabled} onClick={audio.onPlay}
          aria-label={messages.kid.listen} data-testid="kid-play" />
      ) : <KidIcon name={icon} className="kid-exercise-instruction-icon" />}
      <span className={classes.text}>{instruction}</span>
      {guidance}
    </header>
  );
}
