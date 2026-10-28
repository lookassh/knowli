"use client";

import type { ReactElement } from "react";
import { m, useReducedMotion } from "motion/react";
import { kidSoundRingAnimate, kidSoundRingTransition } from "./kid-motion";

/** Soft ring growing out of a control while sound plays or the microphone
 * listens. Decorative (aria-hidden), follows the parent's shape; the parent
 * must be positioned. Only transform and opacity move. Under reduced motion
 * MotionConfig still runs opacity loops, so the ring stays a still outline. */
export function SoundRing({ testId = "kid-sound-ring" }: { testId?: string }): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  return (
    <m.span
      className="kid-sound-ring"
      aria-hidden="true"
      data-testid={testId}
      initial={reduceMotion ? { scale: 1, opacity: 0.55 } : { scale: 1, opacity: 0 }}
      animate={reduceMotion ? { scale: 1, opacity: 0.55 } : kidSoundRingAnimate}
      transition={reduceMotion ? { duration: 0 } : kidSoundRingTransition}
    />
  );
}
