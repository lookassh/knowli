"use client";

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence, m, useIsPresent, useReducedMotion } from "motion/react";
import { kidTaskExit, kidTaskTransition } from "./kid-motion";

function TaskPane({ children }: { children: ReactNode }): ReactElement {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();
  return (
    <m.div
      data-testid="kid-task-transition"
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: reduceMotion ? { duration: 0 } : kidTaskExit }}
      transition={reduceMotion ? { duration: 0 } : kidTaskTransition}
      style={{ height: "100%", minHeight: 0, pointerEvents: isPresent ? "auto" : "none" }}
    >
      {children}
    </m.div>
  );
}

/** Animated switch between tasks; the session header stays still.
 * The exiting pane is inert, so its controls cannot act on the new task.
 * Only transform and opacity move, so layout geometry is untouched. */
export function TaskTransition({ taskId, children }: { taskId: string; children: ReactNode }): ReactElement {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <TaskPane key={taskId}>{children}</TaskPane>
    </AnimatePresence>
  );
}
