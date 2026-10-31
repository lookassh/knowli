import { describe, expect, it } from "vitest";
import { feedbackCardMax, type FeedbackCardGeometry } from "./feedback-card-space";

const base: FeedbackCardGeometry = {
  frameHeight: 780,
  contentBottom: 300,
  scrollTop: 0,
  offsetGiven: 0,
  overlayHeight: 382,
  cardHeight: 300,
};

describe("feedbackCardMax", () => {
  it("leaves the footer clearance, the slack and the rest of the panel under the content", () => {
    // 780 − 300 − 24 − 8 − (382 − 300)
    expect(feedbackCardMax(base)).toBe(366);
  });

  it("does not change when the correcting scroll moved the content up", () => {
    expect(feedbackCardMax({ ...base, contentBottom: 250, scrollTop: 50 })).toBe(366);
  });

  it("does not change when the top offset gave way", () => {
    expect(feedbackCardMax({ ...base, contentBottom: 260, offsetGiven: 40 })).toBe(366);
  });

  it("rounds down", () => {
    expect(feedbackCardMax({ ...base, contentBottom: 300.6 })).toBe(365);
  });

  it("returns null when no space is left", () => {
    expect(feedbackCardMax({ ...base, contentBottom: 666 })).toBeNull();
    expect(feedbackCardMax({ ...base, contentBottom: 665.5 })).toBeNull();
    expect(feedbackCardMax({ ...base, contentBottom: 700 })).toBeNull();
  });
});
