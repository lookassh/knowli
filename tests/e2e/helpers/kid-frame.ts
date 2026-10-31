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
