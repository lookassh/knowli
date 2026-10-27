import type { ReactElement, ReactNode } from "react";
import { m, useIsPresent } from "motion/react";
import { kidDockExit, kidDockExitTransition, kidSpringGentle } from "../motion/kid-motion";
import classes from "./ExerciseFeedbackDock.module.css";

export type FeedbackDockTone = "correct" | "incorrect" | "partial" | "technical" | "neutral";

/**
 * Wspólny dolny panel wyniku ćwiczenia: wysuwa się w stopce ramy zadania,
 * nie podmienia bodźca ani odpowiedzi. Treść i akcje pochodzą z istniejących
 * kart feedbacku; dock odpowiada wyłącznie za prezentację i jedną akcję główną.
 * Animacja wejścia: Motion (sprężyna, tylko transform i opacity).
 */
export function ExerciseFeedbackDock({
  tone,
  kind = "answer",
  compact = false,
  children,
  primary,
  secondary,
}: {
  tone: FeedbackDockTone;
  kind?: "answer" | "speech";
  compact?: boolean;
  children: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
}): ReactElement {
  const isPresent = useIsPresent();
  return (
    <m.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ ...kidDockExit, transition: kidDockExitTransition }}
      transition={kidSpringGentle}
      inert={!isPresent}
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
      data-testid="kid-feedback-dock"
      data-tone={tone}
      data-dock-kind={kind}
      data-compact={compact || undefined}
      className={`${classes.dock} ${compact ? classes.compact : ""} ${tone === "correct" ? classes.correct : tone === "incorrect" ? classes.incorrect : tone === "partial" ? classes.partial : tone === "technical" ? classes.technical : ""}`}
    >
      <div className={classes.scroll}>
        <div className={classes.content}>{children}</div>
      </div>
      <div className={classes.actions}>
        {primary}
      </div>
      {secondary !== undefined && secondary !== null && (
        <div className={classes.secondary}>
          {secondary}
        </div>
      )}
    </m.div>
  );
}
