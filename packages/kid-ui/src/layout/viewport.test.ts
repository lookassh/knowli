import { describe, expect, it } from "vitest";
import { computeKidLayoutScale, computeKidViewport } from "./viewport";

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

describe("computeKidLayoutScale", () => {
  it.each([
    // [width, height, expected] — wartości ze spec §3.4, wskaźnik precyzyjny
    [390, 750, 1],
    [1536, 730, 1],
    [1280, 600, 1],
    [1440, 900, 1],
    [1920, 950, 1.05],
    [1920, 1080, 1.2],
    [1440, 960, 1.06],
    [1392, 984, 1.09],
    [922, 1000, 1.09],
    [2560, 1300, 1.44],
    [3440, 1300, 1.44],
    [3440, 1440, 1.6],
    [1146, 1300, 1.36],
    [1720, 1300, 1.44],
    [3840, 2050, 1.6],
    // 949,2 / 840 to dokładnie 1,13 — zaokrąglenie w dół nie może zgubić setnej przez błąd zmiennoprzecinkowy.
    [949.2, 2000, 1.13],
  ])("scales a %f x %f window with a fine pointer to %f", (width, height, expected) => {
    expect(computeKidLayoutScale({ width, height, finePointer: true })).toBe(expected);
  });

  it("never scales without a fine pointer (phones and tablets)", () => {
    expect(computeKidLayoutScale({ width: 1366, height: 1024, finePointer: false })).toBe(1);
    expect(computeKidLayoutScale({ width: 3440, height: 1440, finePointer: false })).toBe(1);
  });

  it("falls back to 1 for NaN, infinite and negative measurements in either field", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(computeKidLayoutScale({ width: invalid, height: 1300, finePointer: true })).toBe(1);
      expect(computeKidLayoutScale({ width: 2560, height: invalid, finePointer: true })).toBe(1);
      expect(computeKidLayoutScale({ width: invalid, height: invalid, finePointer: true })).toBe(1);
    }
  });
});
