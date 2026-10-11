import { describe, expect, it } from "vitest";
import { computeKidViewport } from "./viewport";

describe("computeKidViewport", () => {
  it("uses the visible viewport height and offset when the keyboard is open", () => {
    expect(computeKidViewport({
      innerHeight: 700,
      visualViewport: { height: 350, offsetTop: 24 },
    })).toEqual({ height: 350, offsetTop: 24, zoomed: false });
  });

  it("never lets visual viewport measurements extend below the window viewport", () => {
    expect(computeKidViewport({
      innerHeight: 800,
      visualViewport: { height: 1024, offsetTop: 0 },
    })).toEqual({ height: 800, offsetTop: 0, zoomed: false });
    expect(computeKidViewport({
      innerHeight: 800,
      visualViewport: { height: 900, offsetTop: 50 },
    })).toEqual({ height: 750, offsetTop: 50, zoomed: false });
  });

  it("falls back to the window height when visualViewport is unavailable or invalid", () => {
    expect(computeKidViewport({ innerHeight: 700, visualViewport: null }))
      .toEqual({ height: 700, offsetTop: 0, zoomed: false });
    expect(computeKidViewport({
      innerHeight: 700,
      visualViewport: { height: 0, offsetTop: Number.NaN, scale: Number.NaN },
    })).toEqual({ height: 700, offsetTop: 0, zoomed: false });
  });

  it("uses natural document flow while pinch-zoomed and returns to session sizing", () => {
    expect(computeKidViewport({
      innerHeight: 700,
      visualViewport: { height: 350, offsetTop: 24, scale: 2 },
    })).toEqual({ height: 700, offsetTop: 0, zoomed: true });
    expect(computeKidViewport({
      innerHeight: 700,
      visualViewport: { height: 700, offsetTop: 0, scale: 1.01 },
    })).toEqual({ height: 700, offsetTop: 0, zoomed: false });
  });

  it("normalizes invalid window measurements to a usable non-negative height", () => {
    expect(computeKidViewport({ innerHeight: Number.NaN, visualViewport: null }))
      .toEqual({ height: 0, offsetTop: 0, zoomed: false });
  });
});
