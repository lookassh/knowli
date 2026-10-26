import type { Ref } from "react";
import { messages } from "@learning/contracts";
import { IconActionButton } from "./IconActionButton";
import { KidIcon, type KidIconName } from "./KidIcon";
import classes from "./ExerciseInstruction.module.css";

export interface ExerciseInstructionAudio {
  onPlay: () => void;
  disabled: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/** Instrukcja zadania i opcjonalny odsłuch bodźca przez kontroler sesji. */
export function ExerciseInstruction({ instruction, icon, audio }: {
  instruction: string;
  icon: KidIconName;
  audio?: ExerciseInstructionAudio;
}) {
  return (
    <header className={`kid-exercise-instruction ${classes.root}`} data-testid="kid-instruction">
      {audio ? (
        <IconActionButton ref={audio.ref} disabled={audio.disabled} onClick={audio.onPlay}
          aria-label={messages.kid.listen} data-testid="kid-play">
          <KidIcon name="volume" />
        </IconActionButton>
      ) : <KidIcon name={icon} className="kid-exercise-instruction-icon" />}
      <span className={classes.text}>{instruction}</span>
    </header>
  );
}
