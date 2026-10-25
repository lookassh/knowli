import { describe, expect, it, vi } from "vitest";
import { scheduleFeedbackDockReveal, shouldRevealFeedbackDock, type FeedbackDockRevealState } from "./feedback-dock-reveal";

describe("feedback dock reveal", () => {
  it("reveals once per required viewport period and again after entering it", () => {
    const firstOverlay = {} as HTMLElement;
    const secondOverlay = {} as HTMLElement;
    const state: FeedbackDockRevealState = { overlay: null, required: false };

    expect(shouldRevealFeedbackDock(state, firstOverlay, false)).toBe(false);
    expect(shouldRevealFeedbackDock(state, firstOverlay, true)).toBe(true);
    expect(shouldRevealFeedbackDock(state, firstOverlay, true)).toBe(false);
    expect(shouldRevealFeedbackDock(state, firstOverlay, false)).toBe(false);
    expect(shouldRevealFeedbackDock(state, firstOverlay, true)).toBe(true);
    expect(shouldRevealFeedbackDock(state, secondOverlay, true)).toBe(true);
  });

  it("cancels a queued reveal and ignores a detached target", () => {
    let scheduledCallback: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    const scrollIntoView = vi.fn();
    const target = { isConnected: true, scrollIntoView } as unknown as HTMLElement;
    const cleanup = scheduleFeedbackDockReveal(
      target,
      (callback) => {
        scheduledCallback = callback;
        return 17;
      },
      cancelFrame,
    );

    cleanup();
    scheduledCallback?.(0);
    expect(cancelFrame).toHaveBeenCalledWith(17);
    expect(scrollIntoView).not.toHaveBeenCalled();

    scheduleFeedbackDockReveal(
      { isConnected: false, scrollIntoView } as unknown as HTMLElement,
      (callback) => {
        callback(0);
        return 18;
      },
      cancelFrame,
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
