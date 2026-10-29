import { expect, type Page } from "@playwright/test";

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Viewport { width: number; height: number }

/** Resizes the page and waits two frames, so KidPage has re-measured the viewport. */
export async function resizeAndSettle(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize(viewport);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** Page width, document scroll width and the rectangle of each selector (each must exist). */
export async function measure<K extends string>(page: Page, selectors: Record<K, string>): Promise<{ innerWidth: number; scrollWidth: number } & Record<K, Rect>> {
  return page.evaluate((entries) => {
    const rects = Object.fromEntries(Object.entries(entries).map(([key, selector]) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return [key, { left, top, right, bottom, width, height }];
    }));
    return { innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, ...rects };
  }, selectors as Record<string, string>) as Promise<{ innerWidth: number; scrollWidth: number } & Record<K, Rect>>;
}

/** The band header starts at the top edge and spans the KidScreen column exactly. */
export function expectBandSpansRoot(layout: { band: Rect; root: Rect }, name: string): void {
  expect(Math.round(layout.band.top), `band top: ${name}`).toBe(0);
  expect(Math.abs(layout.band.left - layout.root.left), `band left: ${name}`).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.band.right - layout.root.right), `band right: ${name}`).toBeLessThanOrEqual(1);
}

/** A rectangle stays inside the KidScreen column (1 px rounding tolerance). */
export function expectInsideRoot(rect: Rect, root: Rect, label: string): void {
  expect(rect.left, `${label} left`).toBeGreaterThanOrEqual(root.left - 1);
  expect(rect.right, `${label} right`).toBeLessThanOrEqual(root.right + 1);
}
