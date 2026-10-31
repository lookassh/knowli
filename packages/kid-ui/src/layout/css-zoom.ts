/**
 * CSS zoom of a large window (KidPage, spec 2026-10-30-kid-ui-large-screens §4.4): rectangles
 * (getBoundingClientRect()) are screen pixels, while offset*, client*, scroll*, ResizeObserver sizes and every
 * length written into a style (also `left`/`top` of a `position: fixed` element) are inner (layout) pixels that
 * the zoom multiplies when painting. Convert before mixing the two: a value taken from a rectangle is divided by
 * cssZoomOf(...) before it is written into a style.
 */

/** Effective CSS zoom of the element; 1 where the browser does not report it (jsdom) or reports nonsense. */
export function cssZoomOf(element: Element): number {
  const zoom = element.currentCSSZoom;
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** A length measured on screen (e.g. from a rectangle) in the element's inner pixels. */
export function toLayoutPx(screenPx: number, element: Element): number {
  return screenPx / cssZoomOf(element);
}
