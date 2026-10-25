export interface FeedbackDockRevealState {
  overlay: HTMLElement | null;
  required: boolean;
}

export function shouldRevealFeedbackDock(
  state: FeedbackDockRevealState,
  overlay: HTMLElement,
  required: boolean,
): boolean {
  const shouldReveal = required && (state.overlay !== overlay || !state.required);
  state.overlay = overlay;
  state.required = required;
  return shouldReveal;
}

export function scheduleFeedbackDockReveal(
  overlay: HTMLElement,
  requestFrame: typeof requestAnimationFrame = requestAnimationFrame,
  cancelFrame: typeof cancelAnimationFrame = cancelAnimationFrame,
): () => void {
  let cancelled = false;
  const frame = requestFrame(() => {
    if (!cancelled && overlay.isConnected) overlay.scrollIntoView({ block: "end" });
  });
  return () => {
    cancelled = true;
    cancelFrame(frame);
  };
}
