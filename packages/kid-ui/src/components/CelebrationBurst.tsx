"use client";

import type { ReactElement, ReactNode } from "react";
import { m } from "motion/react";
import { kidCelebrationTransition } from "../motion/kid-motion";
import classes from "./CelebrationBurst.module.css";

const PARTICLE_COUNT = 10;
const PARTICLE_COLORS = ["#2a7b4f", "#e3a008", "#203653", "#2a7b4f", "#e3a008"] as const;

/** Deterministic burst offsets: no randomness, so tests and replays stay stable. */
function particleOffset(index: number): { x: number; y: number } {
  const angle = (index / PARTICLE_COUNT) * Math.PI * 2 + 0.35;
  const distance = 52 + (index % 3) * 16;
  return { x: Math.round(Math.cos(angle) * distance), y: Math.round(Math.sin(angle) * distance * 0.72) };
}

/** One-shot star burst around the summary title when a session had tasks.
 * Decorative only (aria-hidden); animates transform and opacity only. */
export function CelebrationBurst({ active, children }: { active: boolean; children: ReactNode }): ReactElement {
  return (
    <span className={classes.wrap}>
      {children}
      {active && (
        <span className={classes.burst} aria-hidden="true" data-testid="kid-celebration">
          {Array.from({ length: PARTICLE_COUNT }, (_, index) => {
            const { x, y } = particleOffset(index);
            return (
              <m.span
                key={index}
                className={classes.particle}
                style={{ backgroundColor: PARTICLE_COLORS[index % PARTICLE_COLORS.length] }}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.5 }}
                animate={{ opacity: [0, 1, 0], x: [0, x, x], y: [0, y, y + 14], scale: [0.5, 1, 0.7] }}
                transition={kidCelebrationTransition(index)}
              />
            );
          })}
        </span>
      )}
    </span>
  );
}
