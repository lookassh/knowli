import { describe, expect, it } from "vitest";
import {
  kidCelebrationTransition,
  kidDockExit,
  kidEntranceAnimate,
  kidEntranceInitial,
  kidLetterPop,
  kidLoadingDotAnimate,
  kidLoadingDotTransition,
  kidOutcomeIconAnimate,
  kidOutcomeIconInitial,
  kidOutcomePop,
  kidOutcomeShake,
  kidProgressPopAnimate,
  kidProgressPopInitial,
  kidStaggerDelay,
  kidStaggerMaxIndex,
  kidStaggerSeconds,
  kidStimulusAnimate,
  kidStimulusBounce,
  kidStimulusInitial,
} from "./kid-motion";

const ANIMATED_VALUES = [
  kidEntranceInitial,
  kidEntranceAnimate,
  kidOutcomePop,
  kidOutcomeShake,
  kidOutcomeIconInitial,
  kidOutcomeIconAnimate,
  kidProgressPopInitial,
  kidProgressPopAnimate,
  kidStimulusInitial,
  kidStimulusAnimate,
  kidStimulusBounce,
  kidLetterPop,
  kidDockExit,
  kidLoadingDotAnimate,
];

describe("kid motion tokens", () => {
  it("animates only transform and opacity, never layout geometry", () => {
    for (const value of ANIMATED_VALUES) {
      for (const key of Object.keys(value)) {
        expect(["opacity", "scale", "x", "y", "rotate"]).toContain(key);
      }
    }
  });

  it("caps stagger delays so long lists never lag behind the child", () => {
    expect(kidStaggerDelay(0)).toBe(0);
    expect(kidStaggerDelay(2)).toBe(2 * kidStaggerSeconds);
    expect(kidStaggerDelay(100)).toBe(kidStaggerMaxIndex * kidStaggerSeconds);
    expect(kidStaggerDelay(-3)).toBe(0);
  });

  it("sequences loading dots and celebration particles deterministically", () => {
    expect(kidLoadingDotTransition(0).delay).toBe(0);
    expect(kidLoadingDotTransition(2).delay).toBeCloseTo(0.3);
    expect(kidLoadingDotTransition(1).repeat).toBe(Infinity);
    expect(kidCelebrationTransition(0).delay).toBeCloseTo(0.15);
    expect(kidCelebrationTransition(3).delay).toBeCloseTo(0.24);
  });
});
