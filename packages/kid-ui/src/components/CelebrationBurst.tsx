"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { m } from "motion/react";
import { kidBurstSeconds, kidBurstSizes, kidCelebrationTransition, type KidBurstSize } from "../motion/kid-motion";
import classes from "./CelebrationBurst.module.css";

const PARTICLE_COLORS = ["#79d3a0", "#e3a008", "#aec0ff", "#ff9fb3", "#e3a008"] as const;

/** Deterministic burst offsets: no randomness, so tests and replays stay stable. */
export function particleOffset(index: number, size: KidBurstSize = "lg"): { x: number; y: number } {
  const { count, distance, spread } = kidBurstSizes[size];
  const angle = (index / count) * Math.PI * 2 + 0.35;
  const reach = distance + (index % 3) * spread;
  return { x: Math.round(Math.cos(angle) * reach), y: Math.round(Math.sin(angle) * reach * 0.72) };
}

/** Particles flying out of the centre of the nearest positioned ancestor.
 * Decorative only (aria-hidden); animates transform and opacity only.
 * Every other particle is a star, so the burst reads as a reward.
 * `transient` unmounts the faded particles, so they never linger at their
 * end positions and widen the scroll range of a tight answer list. */
export function BurstParticles({ size = "lg", transient = false, testId = "kid-celebration" }: {
  size?: KidBurstSize;
  transient?: boolean;
  testId?: string;
}): ReactElement | null {
  const { count, particle, baseDelay } = kidBurstSizes[size];
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!transient) return;
    const timer = setTimeout(() => setDone(true), kidBurstSeconds(size) * 1000);
    return () => clearTimeout(timer);
  }, [transient, size]);
  if (done) return null;
  return (
    <span className={classes.burst} aria-hidden="true" data-testid={testId} data-size={size}>
      {Array.from({ length: count }, (_, index) => {
        const { x, y } = particleOffset(index, size);
        const star = index % 2 === 1;
        const color = PARTICLE_COLORS[index % PARTICLE_COLORS.length];
        return (
          <m.span
            key={index}
            className={star ? classes.star : classes.particle}
            style={star
              ? { color, fontSize: particle * 1.8, width: particle * 2, height: particle * 2, margin: -particle }
              : { backgroundColor: color, width: particle, height: particle, margin: -particle / 2 }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.4, rotate: 0 }}
            animate={{ opacity: [0, 1, 0], x: [0, x, x], y: [0, y, y + 14], scale: [0.4, 1.1, 0.7], rotate: star ? [0, 90, 160] : 0 }}
            transition={kidCelebrationTransition(index, baseDelay)}
          >
            {star ? "★" : null}
          </m.span>
        );
      })}
    </span>
  );
}

/** One-shot burst around the summary title when a session had tasks. */
export function CelebrationBurst({ active, size = "lg", children }: { active: boolean; size?: KidBurstSize; children: ReactNode }): ReactElement {
  return (
    <span className={classes.wrap}>
      {children}
      {active && <BurstParticles size={size} />}
    </span>
  );
}
