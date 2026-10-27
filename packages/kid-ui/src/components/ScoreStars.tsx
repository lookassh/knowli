"use client";

import type { ReactElement } from "react";
import { m } from "motion/react";
import { kidSpringGentle, kidStaggerSeconds } from "../motion/kid-motion";

/** Score stars: filled stars pop in one by one; empty stars stay quiet. */
export function ScoreStars({ stars, label }: { stars: number; label: string }): ReactElement {
  return (
    <p className="kid-mock-score__stars" role="img" aria-label={label}>
      {Array.from({ length: 6 }, (_, index) => index < stars
        ? (
          <m.span
            key={index}
            aria-hidden="true"
            initial={{ opacity: 0, scale: 0.4, rotate: -24 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ ...kidSpringGentle, delay: index * kidStaggerSeconds * 2 }}
            style={{ display: "inline-block" }}
          >
            ★
          </m.span>
        )
        : <span key={index} aria-hidden="true">☆</span>)}
    </p>
  );
}
