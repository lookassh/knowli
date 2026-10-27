"use client";

import type { ReactElement, ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { kidTaskExit, kidTaskTransition } from "./kid-motion";
import { PresencePane } from "./PresencePane";

/** Animated switch between tasks; the session header stays still. */
export function TaskTransition({ taskId, onPaneMount, children }: {
  taskId: string;
  onPaneMount?: (taskId: string) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <PresencePane
        key={taskId}
        testId="kid-task-transition"
        enter={kidTaskTransition}
        exit={kidTaskExit}
        fill
        onMount={() => onPaneMount?.(taskId)}
      >
        {children}
      </PresencePane>
    </AnimatePresence>
  );
}
