import { expect, type Page } from "@playwright/test";
import type { Viewport } from "./kid-layout";

/**
 * Kid UI scales a large window with CSS zoom on `.kid-page` (spec 2026-10-30-kid-ui-large-screens §4.1).
 * Rectangles (getBoundingClientRect, boundingBox) are screen pixels; offset*, client*, scroll* are inner pixels.
 */

/** Waits until `.kid-page` reports the expected scale and the browser applies it as CSS zoom (± 0.005). */
export async function waitForKidScale(page: Page, expected: number): Promise<void> {
  await expect.poll(() => page.locator(".kid-page").evaluate((element, wanted) => {
    const attribute = Number(element.getAttribute("data-kid-scale"));
    const zoom = element.currentCSSZoom;
    return Math.abs(attribute - wanted) <= 0.005 && Math.abs(zoom - wanted) <= 0.005
      ? "ok"
      : JSON.stringify({ dataKidScale: element.getAttribute("data-kid-scale"), currentCSSZoom: zoom });
  }, expected), { message: `Kid UI scale ${expected}` }).toBe("ok");
}

/** The session frame covers the whole window (± 1 px) on screen, whatever the scale. */
export async function expectFrameFillsViewport(page: Page, viewport: Viewport): Promise<void> {
  const frame = page.getByTestId("kid-session-frame");
  await expect.poll(async () => {
    const box = await frame.boundingBox();
    if (!box) return "no frame box";
    const deviation = Math.max(Math.abs(box.x), Math.abs(box.y),
      Math.abs(box.width - viewport.width), Math.abs(box.height - viewport.height));
    return deviation <= 1 ? "ok" : JSON.stringify(box);
  }, { message: `session frame fills the ${viewport.width}x${viewport.height} window` }).toBe("ok");
}

/** Every element matching the selectors is a touch target of at least 48 x 48 screen pixels. */
export async function expectInteractiveTargets(page: Page, selectors: string[]): Promise<void> {
  const targets = await page.evaluate((wanted) => wanted.flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
      const rect = element.getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    }),
  ), selectors);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, `${target.selector} touch height`).toBeGreaterThanOrEqual(48);
    expect(target.width, `${target.selector} touch width`).toBeGreaterThanOrEqual(48);
  }
}

/** A `getBoundingClientRect()` snapshot: screen pixels, all six edges. */
export type ScreenRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** Screen rectangles of all elements matching the selector, in document order. */
export async function boxes(page: Page, selector: string): Promise<ScreenRect[]> {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }));
}

/** Waits two animation frames, so a layout change and the observers it triggers have run. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Tile rectangles (screen pixels) and the material rectangle that bounds them (inner pixels, as container units are). */
export async function pictureTiles(page: Page): Promise<{ tiles: ScreenRect[]; container: { width: number; height: number } }> {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    });
    // 100cqw / 100cqh come from the nearest size container above the tile grid.
    let container: HTMLElement | null = document.querySelector<HTMLElement>(".kid-picture-options")!.parentElement;
    while (container && !getComputedStyle(container).containerType.includes("size")) container = container.parentElement;
    return { tiles, container: { width: container!.clientWidth, height: container!.clientHeight } };
  });
}

/** `--kid-visual-choice-max-size` from expanded width on (spec 2026-10-30-kid-ui-large-screens §3.1), in inner pixels. */
export const VISUAL_CHOICE_MAX = 300;

/**
 * The tile size `--visual-choice-size` resolves to (inner pixels) in a material of the given size: the cap, half the
 * material width, or the material height shared by two rows (never below 112). `heightBound` is true when the height
 * term alone decides, i.e. it is smaller than both the cap and the width term.
 */
export function pictureTileLimit(container: { width: number; height: number }): { limit: number; heightBound: boolean } {
  const gap = 12;
  const byWidth = (container.width - gap) / 2;
  const byHeight = Math.max(112, (container.height - gap) / 2);
  return {
    limit: Math.min(VISUAL_CHOICE_MAX, byWidth, byHeight),
    heightBound: byHeight < Math.min(VISUAL_CHOICE_MAX, byWidth),
  };
}

/** The elements are the same ones in the same places (± tolerance px) before and after, e.g. after a verdict. */
export function expectRectsUnchanged(before: ScreenRect[], after: ScreenRect[], label: string, tolerance = 1): void {
  expect(after, `${label}: same number of elements`).toHaveLength(before.length);
  for (const [index, now] of after.entries()) {
    const was = before[index]!;
    for (const key of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(now[key] - was[key]), `${label}: element ${index} ${key}: ${JSON.stringify({ was, now })}`).toBeLessThanOrEqual(tolerance);
    }
  }
}

/**
 * Reads the overlay reserve geometry once it stops changing (the reserve and its correcting scroll take a few frames).
 * `contentBottom` is the lowest bottom edge among the children of `.kid-material-content` (as `ExerciseFrame` measures
 * it) and `dockTop` the top edge of `.kid-feedback-overlay`, both in screen pixels; the other values are inner pixels.
 */
export async function settledDockReserve(page: Page): Promise<{
  inlineReserve: number; scrollTop: number; scrollHeight: number; clientHeight: number; contentBottom: number; dockTop: number;
}> {
  return page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
    const read = () => {
      const material = document.querySelector<HTMLElement>("[data-testid='kid-material']")!;
      const content = material.querySelector<HTMLElement>(".kid-material-content")!;
      const overlay = document.querySelector<HTMLElement>(".kid-feedback-overlay")!;
      return {
        inlineReserve: Number.parseFloat(content.style.paddingBottom) || 0,
        scrollTop: material.scrollTop,
        scrollHeight: material.scrollHeight,
        clientHeight: material.clientHeight,
        contentBottom: Math.max(...[...content.children].map((child) => child.getBoundingClientRect().bottom)),
        dockTop: overlay.getBoundingClientRect().top,
      };
    };
    let previous = read();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await frame();
      await frame();
      const next = read();
      if (JSON.stringify(next) === JSON.stringify(previous)) return next;
      previous = next;
    }
    throw new Error(`the dock reserve did not settle in 60 frames: ${JSON.stringify(previous)}`);
  });
}
