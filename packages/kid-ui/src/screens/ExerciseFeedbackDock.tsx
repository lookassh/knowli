import type { ReactElement, ReactNode } from "react";
import { m, useIsPresent } from "motion/react";
import { kidDockAnimate, kidDockExit, kidDockExitTransition, kidDockInitial, kidDockOrigin, kidSpringGentle } from "../motion/kid-motion";
import { BurstParticles } from "../components/CelebrationBurst";
import classes from "./ExerciseFeedbackDock.module.css";

export type FeedbackDockTone = "correct" | "incorrect" | "partial" | "technical" | "neutral";

/**
 * Wspólny dolny panel wyniku ćwiczenia: wysuwa się w stopce ramy zadania,
 * nie podmienia bodźca ani odpowiedzi. Treść i akcje pochodzą z istniejących
 * kart feedbacku; dock odpowiada wyłącznie za prezentację i jedną akcję główną.
 * Animacja wejścia: Motion (sprężyna, tylko transform i opacity).
 * `celebrate` dodaje mały wybuch gwiazdek z górnej krawędzi — dla poprawnych
 * odpowiedzi bez kafla wyboru (pismo, mowa), który ma własny wybuch.
 */
export function ExerciseFeedbackDock({
  tone,
  kind = "answer",
  compact = false,
  children,
  primary,
  secondary,
  celebrate = false,
}: {
  tone: FeedbackDockTone;
  kind?: "answer" | "speech";
  compact?: boolean;
  children: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  celebrate?: boolean;
}): ReactElement {
  const isPresent = useIsPresent();
  return (
    <m.div
      initial={kidDockInitial}
      animate={kidDockAnimate}
      exit={{ ...kidDockExit, transition: kidDockExitTransition }}
      transition={kidSpringGentle}
      inert={!isPresent}
      style={{ pointerEvents: isPresent ? "auto" : "none", transformOrigin: kidDockOrigin }}
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
      {celebrate && (
        <span className={classes.burstAnchor} aria-hidden="true">
          <BurstParticles size="sm" transient testId="kid-answer-burst" />
        </span>
      )}
      {secondary !== undefined && secondary !== null && (
        <div className={classes.secondary}>
          {secondary}
        </div>
      )}
    </m.div>
  );
}
