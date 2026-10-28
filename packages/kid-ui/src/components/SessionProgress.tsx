import { useEffect, useRef, type ReactElement } from "react";
import { AnimatePresence, m, useAnimate, useReducedMotion } from "motion/react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import {
  kidProgressFillTransition,
  kidProgressPopAnimate,
  kidProgressPopInitial,
  kidSpringGentle,
  kidStreakJump,
  kidStreakJumpTransition,
} from "../motion/kid-motion";
import classes from "./SessionProgress.module.css";

/** Session progress in the header: a fill that grows as tasks are done.
 * Near the end (and in mock tests) the fill sits behind the "Jeszcze N"
 * label; otherwise it is a slim bar. A streak of correct answers makes it
 * jump once and drops a star. Decorative fill and star are aria-hidden;
 * the label stays the accessible text. Only transform and opacity move.
 * One stable root: switching from bar to label never replays a reward. */
export function SessionProgress({ remaining, fraction = 0, milestone = 0 }: {
  /** Label count, or null when the label is not shown yet. */
  remaining: number | null;
  /** Share of the session already done, 0..1. */
  fraction?: number;
  /** Changes when a streak milestone is reached. */
  milestone?: number;
}): ReactElement {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const reduceMotion = useReducedMotion() === true;
  const seenMilestone = useRef(milestone);
  useEffect(() => {
    if (milestone <= seenMilestone.current) return;
    seenMilestone.current = milestone;
    if (!reduceMotion && scope.current) void animate(scope.current, kidStreakJump, kidStreakJumpTransition);
  }, [milestone, reduceMotion, animate, scope]);

  const labelled = remaining !== null;
  return (
    <span
      ref={scope}
      className={labelled ? [classes.root, "kid-remaining"].join(" ") : [classes.bar, "kid-progress-bar"].join(" ")}
      data-testid={labelled ? "kid-remaining" : "kid-progress-bar"}
      aria-hidden={labelled ? undefined : "true"}
    >
      <span className={classes.fillTrack} aria-hidden="true">
        <m.span
          className={classes.fill}
          data-testid="kid-progress-fill"
          initial={false}
          animate={{ scaleX: fraction }}
          transition={kidProgressFillTransition}
        />
      </span>
      <AnimatePresence initial={false}>
        {milestone > 0 && (
          <m.span
            key={milestone}
            className={classes.star}
            aria-hidden="true"
            data-testid="kid-streak-star"
            initial={{ opacity: 0, scale: 0.3, y: 0, rotate: -40 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.35, 1, 0.9], y: [0, -8, -12, -26], rotate: [-40, 10, 0, 0] }}
            transition={{ duration: 1.3, ease: "easeOut", times: [0, 0.3, 0.7, 1] }}
          >
            ★
          </m.span>
        )}
      </AnimatePresence>
      {labelled && (
        <m.span
          key={remaining}
          className={classes.label}
          initial={kidProgressPopInitial}
          animate={kidProgressPopAnimate}
          transition={kidSpringGentle}
        >
          {format(messages.kid.remaining, { n: remaining })}
        </m.span>
      )}
    </span>
  );
}
