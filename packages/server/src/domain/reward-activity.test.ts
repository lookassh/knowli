import { describe, expect, it } from "vitest";
import { capActivityInterval, MAX_ACTIVITY_GAP_MS } from "./reward-activity";

describe("reward activity accounting", () => {
  it("caps a confirmed interval at its accepted signals and idle boundary", () => {
    const started = new Date("2026-10-16T10:00:00.000Z");
    expect(capActivityInterval(started, new Date(started.getTime() + MAX_ACTIVITY_GAP_MS), started.getTime() + 60_000))
      .toEqual({ start: started, end: new Date(started.getTime() + MAX_ACTIVITY_GAP_MS), milliseconds: MAX_ACTIVITY_GAP_MS, pauseReason: null });
  });

  it("does not count offline gaps or client-supplied elapsed time", () => {
    const started = new Date("2026-10-16T10:00:00.000Z");
    expect(capActivityInterval(started, new Date(started.getTime() + 120_000), started.getTime() + 120_000))
      .toEqual({ start: started, end: started, milliseconds: 0, pauseReason: "signal_timeout" });
  });
});
