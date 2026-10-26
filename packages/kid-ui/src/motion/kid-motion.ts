import type { Transition } from "motion/react";

/** Motion tokens for Kid UI: the only place with motion numbers.
 * Only transform and opacity are ever animated (geometry stays stable). */
export const kidTapScale = 0.97;

export const kidSpringSnappy: Transition = { type: "spring", stiffness: 500, damping: 35 };
export const kidSpringGentle: Transition = { type: "spring", stiffness: 260, damping: 26 };

export const kidTaskTransition: Transition = { duration: 0.22, ease: "easeOut" };
export const kidTaskExit: Transition = { duration: 0.14, ease: "easeIn" };

export const kidStaggerSeconds = 0.05;
