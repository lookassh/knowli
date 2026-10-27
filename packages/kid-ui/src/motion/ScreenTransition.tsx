"use client";

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence, m, useIsPresent, useReducedMotion } from "motion/react";
import { kidScreenExit, kidScreenTransition } from "./kid-motion";

function ScreenPane({ children }: { children: ReactNode }): ReactElement {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      data-testid="kid-screen-transition"
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10, transition: reduceMotion ? { duration: 0 } : kidScreenExit }}
      transition={reduceMotion ? { duration: 0 } : kidScreenTransition}
      style={{ minHeight: 0, pointerEvents: isPresent ? "auto" : "none" }}
    >
      {children}
    </m.div>
  );
}

/** Animated switch between flow screens (profile, decks, summaries).
 * No initial={false}: this tree remounts after the session screen, and
 * suppressing the first render would also skip the summary celebration.
 * The learning screen keeps its own TaskTransition. The exiting pane is
 * inert, so its controls cannot act while it fades out. Only transform
 * and opacity move, so layout geometry is untouched. */
export function ScreenTransition({ screenId, children }: {
  screenId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <AnimatePresence mode="wait">
      <ScreenPane key={screenId}>{children}</ScreenPane>
    </AnimatePresence>
  );
}
