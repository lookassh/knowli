import { describe, expect, it } from "vitest";
import { cssZoomOf, toLayoutPx } from "./css-zoom";

/** An element as the browser reports it: `currentCSSZoom` only where CSS zoom is supported. */
const element = (currentCSSZoom?: number) =>
  (currentCSSZoom === undefined ? {} : { currentCSSZoom }) as unknown as Element;

describe("cssZoomOf", () => {
  it("falls back to 1 without currentCSSZoom", () => {
    expect(cssZoomOf(element())).toBe(1);
  });

  it("reads the effective zoom", () => {
    expect(cssZoomOf(element(1.5))).toBe(1.5);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("treats %s as no zoom", (zoom) => {
    expect(cssZoomOf(element(zoom))).toBe(1);
  });
});

describe("toLayoutPx", () => {
  it("divides screen pixels by the element's zoom", () => {
    expect(toLayoutPx(300, element(1.5))).toBe(200);
  });

  it("keeps screen pixels without zoom", () => {
    expect(toLayoutPx(300, element())).toBe(300);
    expect(toLayoutPx(300, element(0))).toBe(300);
    expect(toLayoutPx(300, element(Number.NaN))).toBe(300);
  });
});
