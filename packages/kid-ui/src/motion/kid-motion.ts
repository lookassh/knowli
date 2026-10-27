import type { Transition } from "motion/react";

/** Motion tokens for Kid UI: the only place with motion numbers.
 * Only transform and opacity are ever animated (geometry stays stable). */
export const kidTapScale = 0.97;
export const kidCoverHoverScale = 1.05;

export const kidSpringSnappy: Transition = { type: "spring", stiffness: 500, damping: 35 };
export const kidSpringGentle: Transition = { type: "spring", stiffness: 260, damping: 26 };

export const kidTaskTransition: Transition = { duration: 0.22, ease: "easeOut" };
export const kidTaskExit: Transition = { duration: 0.14, ease: "easeIn" };

export const kidStaggerSeconds = 0.05;
export const kidStaggerMaxIndex = 6;

/** Stagger delay for list entrances; capped so long lists never lag. */
export function kidStaggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), kidStaggerMaxIndex) * kidStaggerSeconds;
}

export const kidEntranceInitial = { opacity: 0, y: 8 } as const;
export const kidEntranceAnimate = { opacity: 1, y: 0 } as const;

/** Correct answer: one cheerful pop. Wrong answer: a gentle shake, never a punishment. */
export const kidOutcomePop = { scale: [1, 1.08, 1] };
export const kidOutcomePopTransition: Transition = { duration: 0.45, ease: "easeOut", times: [0, 0.45, 1] };
export const kidOutcomeShake = { x: [0, -5, 5, -3, 0] };
export const kidOutcomeShakeTransition: Transition = { duration: 0.35, ease: "easeInOut" };

export const kidOutcomeIconInitial = { opacity: 0, scale: 0.4, rotate: -24 } as const;
export const kidOutcomeIconAnimate = { opacity: 1, scale: 1, rotate: 0 } as const;

/** Remaining-tasks pill pops whenever the count changes. */
export const kidProgressPopInitial = { opacity: 0, scale: 0.82 } as const;
export const kidProgressPopAnimate = { opacity: 1, scale: 1 } as const;

/** Flow-screen switch (profile -> decks -> summary); the session screen keeps TaskTransition. */
export const kidScreenTransition: Transition = { duration: 0.24, ease: "easeOut" };
export const kidScreenExit: Transition = { duration: 0.14, ease: "easeIn" };

/** Loading dots bounce in sequence while the first screen loads. */
export const kidLoadingDotAnimate = { opacity: [0.25, 1, 0.25], y: [0, -4, 0] };
export function kidLoadingDotTransition(index: number): Transition {
  return { duration: 0.9, ease: "easeInOut", repeat: Infinity, delay: index * 0.15 };
}

/** Stimulus (picture/colour/number) settles in; on audio replay it bounces once. */
export const kidStimulusInitial = { opacity: 0, scale: 0.96 } as const;
export const kidStimulusAnimate = { opacity: 1, scale: 1 } as const;
export const kidStimulusBounce = { opacity: 1, scale: [0.96, 1.05, 1] };
export const kidStimulusBounceTransition: Transition = { duration: 0.45, ease: "easeOut", times: [0, 0.45, 1] };

/** A typed letter pops once when it lands in its gap. */
export const kidLetterPop = { scale: [1, 1.18, 1] };
export const kidLetterPopTransition: Transition = { duration: 0.3, ease: "easeOut" };

/** Feedback dock leaves the way it came in, only faster. */
export const kidDockExit = { opacity: 0, y: 24 } as const;
export const kidDockExitTransition: Transition = { duration: 0.14, ease: "easeIn" };

/** Summary celebration burst: particles fly out once and fade. */
export const kidCelebrationDurationSeconds = 0.9;
export function kidCelebrationTransition(index: number): Transition {
  return { duration: kidCelebrationDurationSeconds, ease: "easeOut", delay: 0.15 + index * 0.03 };
}
