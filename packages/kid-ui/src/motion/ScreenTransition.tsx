"use client";

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { kidScreenEnter, kidScreenExit, kidScreenExitTarget, kidScreenInitial, kidScreenTransition } from "./kid-motion";
import { PresencePane } from "./PresencePane";

/** Animated switch between flow screens (profile, decks, summaries).
 * The learning screen keeps its own TaskTransition. No initial={false}:
 * this tree remounts after the session screen, and suppressing the first
 * render would also skip the summary celebration. */
export function ScreenTransition({ screenId, children }: {
  screenId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <AnimatePresence mode="wait">
      <PresencePane key={screenId} testId="kid-screen-transition" from={kidScreenInitial} to={kidScreenEnter} away={kidScreenExitTarget} enter={kidScreenTransition} exit={kidScreenExit}>
        {children}
      </PresencePane>
    </AnimatePresence>
  );
}
