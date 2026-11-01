import type { ReactElement, ReactNode } from "react";
import { m, useIsPresent } from "motion/react";
import { messages } from "@learning/contracts";
import { kidDockAnimate, kidDockExit, kidDockExitTransition, kidDockInitial, kidDockOrigin, kidSpringGentle } from "../motion/kid-motion";
import { BurstParticles } from "../components/CelebrationBurst";
import { KidIcon, type KidIconName } from "../components/KidIcon";
import { ListenButton } from "../components/ListenButton";
import { SoundRing } from "../motion/SoundRing";
import type { SentenceRate } from "../session/session-controller";
import classes from "./ExerciseFeedbackDock.module.css";

/** Odczyt pełnego zdania w doku lekcji: tempo, które gra, ostatni nieudany
 * ręczny odsłuch i blokada, gdy kontroler i tak zignorowałby dotknięcie. */
export interface FeedbackDockSentenceAudio {
  playing: SentenceRate | null;
  error: { rate: SentenceRate; seq: number } | null;
  disabled: boolean;
  onPlay: (rate: SentenceRate) => void;
}

const SENTENCE_BUTTONS = [
  { rate: "normal", icon: "volume", testId: "kid-sentence-audio", label: messages.kid.listenExample },
  { rate: "slow", icon: "turtle", testId: "kid-sentence-audio-slow", label: messages.kid.listenSlower },
] as const;

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
  /** Powtórka nagrania pełnego zdania w feedbacku lekcji: „Posłuchaj zdania”
   * i „Posłuchaj wolniej” w grupie, nad górnym wierszem region błędu. */
  sentenceAudio?: FeedbackDockSentenceAudio | null;
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
      {/* Stały region nad górnym wierszem: dok w nakładce stoi przy dolnej krawędzi
          i rośnie w górę, więc pojawiający się tekst nie przesuwa przycisków zdania
          ani „Dalej” pod palcem. Pusty nie zajmuje miejsca; tekst w elemencie
          kluczowanym `seq` montuje się od nowa, więc czytnik ogłasza każdy błąd. */}
      {sentenceAudio && (
        <div className={classes.sentenceError} aria-live="polite" data-testid="kid-sentence-audio-error">
          {sentenceAudio.error !== null ? <span key={sentenceAudio.error.seq}>{messages.kid.sentenceAudioFailed}</span> : null}
        </div>
      )}
      <div className={classes.scroll}>
        <span className={classes.badge} data-testid="kid-feedback-tone-icon" data-icon={FEEDBACK_TONE_ICONS[tone]} aria-hidden="true">
          <KidIcon name={FEEDBACK_TONE_ICONS[tone]} />
        </span>
        <div className={classes.content}>{children}</div>
        {sentenceAudio && (
          <div className={classes.sentenceGroup} data-testid="kid-sentence-audio-group">
            {SENTENCE_BUTTONS.map(({ rate, icon, testId, label }) => {
              const playing = sentenceAudio.playing === rate;
              const failKey = sentenceAudio.error?.rate === rate ? sentenceAudio.error.seq : undefined;
              return (
                <ListenButton key={rate} data-testid={testId} icon={icon} aria-label={label} title={label}
                  disabled={sentenceAudio.disabled} data-sound-active={playing || undefined}
                  {...(failKey !== undefined ? { failKey } : {})} onClick={() => sentenceAudio.onPlay(rate)}>
                  {playing && <SoundRing />}
                </ListenButton>
              );
            })}
          </div>
        )}
        {guidance && <div className={classes.guidance}>{guidance}</div>}
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
