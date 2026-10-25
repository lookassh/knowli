import type { ReactElement, ReactNode } from "react";
import { Box } from "@mantine/core";
import classes from "./ExerciseFeedbackDock.module.css";

export type FeedbackDockTone = "correct" | "incorrect" | "partial" | "technical" | "neutral";

/**
 * Wspólny dolny panel wyniku ćwiczenia: wysuwa się w stopce ramy zadania,
 * nie podmienia bodźca ani odpowiedzi. Treść i akcje pochodzą z istniejących
 * kart feedbacku; dock odpowiada wyłącznie za prezentację i jedną akcję główną.
 * Animacja jest własna (CSS), bo Mantine Transition wymaga eksportu
 * `Activity` z React, niedostępnego w przypiętej wersji.
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
  return (
    <Box
      data-testid="kid-feedback-dock"
      data-tone={tone}
      data-dock-kind={kind}
      data-compact={compact || undefined}
      className={`${classes.dock} ${compact ? classes.compact : ""} ${tone === "correct" ? classes.correct : tone === "incorrect" ? classes.incorrect : tone === "partial" ? classes.partial : tone === "technical" ? classes.technical : ""}`}
    >
      <Box className={classes.scroll}>
        <Box className={classes.content}>{children}</Box>
      </Box>
      <Box className={classes.actions}>
        {primary}
      </Box>
      {secondary !== undefined && secondary !== null && (
        <Box className={classes.secondary}>
          {secondary}
        </Box>
      )}
    </Box>
  );
}
