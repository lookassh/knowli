"use client";

import type { ReactElement } from "react";
import { m } from "motion/react";
import { kidOutcomeIconAnimate, kidOutcomeIconInitial, kidSpringBouncy, kidStarStaggerSeconds } from "../motion/kid-motion";

/** Score stars: filled stars bounce in one by one; empty stars stay quiet. */
export function ScoreStars({ stars, label }: { stars: number; label: string }): ReactElement {
  return (
    <p className="kid-mock-score__stars" role="img" aria-label={label}>
      {Array.from({ length: 6 }, (_, index) => index < stars
        ? (
          <m.span
            key={index}
            aria-hidden="true"
            initial={kidOutcomeIconInitial}
            animate={kidOutcomeIconAnimate}
            transition={{ ...kidSpringBouncy, delay: 0.2 + index * kidStarStaggerSeconds }}
            style={{ display: "inline-block" }}
          >
            ★
          </m.span>
        )
        : <span key={index} aria-hidden="true">☆</span>)}
    </p>
  );
}
