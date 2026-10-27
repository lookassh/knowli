"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { m, useIsPresent, useReducedMotion, type Transition } from "motion/react";

/** One animated pane inside an AnimatePresence switch. The exiting pane is
 * inert, so its controls cannot act on the incoming one. Only transform and
 * opacity move, so layout geometry is untouched. onMount fires only when
 * this pane is actually mounted (after the previous pane animated out in
 * "wait" mode), never earlier from a parent effect. */
export function PresencePane({ testId, enter, exit, onMount, fill = false, children }: {
  testId: string;
  enter: Transition;
  exit: Transition;
  onMount?: () => void;
  fill?: boolean;
  children: ReactNode;
}): ReactElement {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();
  const mountRef = useRef(onMount);
  mountRef.current = onMount;
  useEffect(() => {
    mountRef.current?.();
  }, []);
  return (
    <m.div
      data-testid={testId}
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: reduceMotion ? { duration: 0 } : exit }}
      transition={reduceMotion ? { duration: 0 } : enter}
      style={{ minHeight: 0, pointerEvents: isPresent ? "auto" : "none", ...(fill ? { height: "100%" } : {}) }}
    >
      {children}
    </m.div>
  );
}
