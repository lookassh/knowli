// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { BurstParticles, CelebrationBurst, particleOffset } from "./CelebrationBurst";
import { kidBurstSeconds, kidBurstSizes } from "../motion/kid-motion";

afterEach(cleanup);

describe("CelebrationBurst", () => {
  it("stays quiet without tasks and bursts decoratively after a real session", () => {
    const { rerender } = renderKid(
      <CelebrationBurst active={false}><h1>Koniec</h1></CelebrationBurst>,
    );
    expect(screen.getByText("Koniec")).toBeTruthy();
    expect(screen.queryByTestId("kid-celebration")).toBeNull();

    rerender(
      <CelebrationBurst active><h1>Koniec</h1></CelebrationBurst>,
    );
    const burst = screen.getByTestId("kid-celebration");
    expect(burst.getAttribute("aria-hidden")).toBe("true");
    expect(burst.children).toHaveLength(kidBurstSizes.lg.count);
    // Every other particle is a star glyph, still hidden from assistive tech.
    expect(burst.textContent).toContain("★");
  });

  it("keeps the small answer burst compact and deterministic", () => {
    renderKid(<BurstParticles size="sm" testId="kid-answer-burst" />);
    expect(screen.getByTestId("kid-answer-burst").children).toHaveLength(kidBurstSizes.sm.count);
    expect(particleOffset(3, "sm")).toEqual(particleOffset(3, "sm"));
    const reach = Array.from({ length: kidBurstSizes.sm.count }, (_, index) => Math.hypot(particleOffset(index, "sm").x, particleOffset(index, "sm").y));
    expect(Math.max(...reach)).toBeLessThanOrEqual(kidBurstSizes.sm.distance + 2 * kidBurstSizes.sm.spread);
  });

  it("removes a transient burst once its particles have faded", () => {
    vi.useFakeTimers();
    try {
      renderKid(<BurstParticles size="sm" transient testId="kid-answer-burst" />);
      expect(screen.getByTestId("kid-answer-burst")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(kidBurstSeconds("sm") * 1000 + 10); });
      expect(screen.queryByTestId("kid-answer-burst")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
