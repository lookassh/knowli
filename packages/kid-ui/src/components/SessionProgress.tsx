import type { ReactElement } from "react";
import { m } from "motion/react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import { kidProgressPopAnimate, kidProgressPopInitial, kidSpringGentle } from "../motion/kid-motion";
import classes from "./SessionProgress.module.css";

export function SessionProgress({ remaining }: { remaining: number | null }): ReactElement | null {
  if (remaining === null) return null;

  return (
    <span className={[classes.root, "kid-remaining"].join(" ")} data-testid="kid-remaining">
      <m.span
        key={remaining}
        initial={kidProgressPopInitial}
        animate={kidProgressPopAnimate}
        transition={kidSpringGentle}
        style={{ display: "inline-block" }}
      >
        {format(messages.kid.remaining, { n: remaining })}
      </m.span>
    </span>
  );
}
