import type { ReactElement, ReactNode } from "react";
import { m, useIsPresent } from "motion/react";
import { messages } from "@learning/contracts";
import { kidDockAnimate, kidDockExit, kidDockExitTransition, kidDockInitial, kidDockOrigin, kidSpringGentle } from "../motion/kid-motion";
import { BurstParticles } from "../components/CelebrationBurst";
import { KidIcon, type KidIconName } from "../components/KidIcon";
import { ListenButton } from "../components/ListenButton";
import classes from "./ExerciseFeedbackDock.module.css";

export type FeedbackDockTone = "correct" | "incorrect" | "partial" | "technical" | "neutral";

/** Ikona odznaki w kółku: drugi kanał informacji o wyniku obok koloru panelu. */
export const FEEDBACK_TONE_ICONS: Record<FeedbackDockTone, KidIconName> = {
  correct: "check",
  partial: "almost",
  incorrect: "close",
  technical: "info",
  neutral: "info",
};

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
  guidance,
  sentenceAudio = null,
  explanation = null,
}: {
  tone: FeedbackDockTone;
  kind?: "answer" | "speech";
  compact?: boolean;
  children: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  celebrate?: boolean;
  /** Przycisk odsłuchu komunikatu o wyniku, za treścią w górnym wierszu (po odznace tonu). */
  guidance?: ReactNode;
  /** Powtórka nagrania pełnego zdania w feedbacku lekcji („Posłuchaj zdania”). */
  sentenceAudio?: { onPlay: () => void } | null;
  /**
   * Wyjaśnienie ćwiczenia po błędzie w lekcji: osobny wiersz na całą szerokość
   * pod górnym wierszem; „Posłuchaj wyjaśnienia” na początku, gdy jest nagranie.
   */
  explanation?: { text: string; onPlay?: () => void } | null;
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
      className={`${classes.dock} ${compact ? classes.compact : ""} ${classes[tone]}`}
    >
      <div className={`${classes.scroll} ${explanation ? `${classes.withExplanation} kid-feedback-scroll-limited` : ""}`}>
        <span className={classes.badge} data-testid="kid-feedback-tone-icon" data-icon={FEEDBACK_TONE_ICONS[tone]} aria-hidden="true">
          <KidIcon name={FEEDBACK_TONE_ICONS[tone]} />
        </span>
        <div className={classes.content}>{children}</div>
        {sentenceAudio && (
          <div className={classes.guidance}>
            <ListenButton data-testid="kid-sentence-audio" aria-label={messages.kid.listenExample}
              title={messages.kid.listenExample} onClick={sentenceAudio.onPlay} />
          </div>
        )}
        {guidance && <div className={classes.guidance}>{guidance}</div>}
        {explanation && (
          <div className={classes.explanation} data-testid="kid-explanation">
            {explanation.onPlay && (
              <ListenButton data-testid="kid-explanation-audio" aria-label={messages.kid.listenExplanation}
                title={messages.kid.listenExplanation} onClick={explanation.onPlay} />
            )}
            <p className={classes.explanationText} data-testid="kid-explanation-text">{explanation.text}</p>
          </div>
        )}
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
