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

/**
 * Emulates a pinch zoom: `visualViewport.scale` reads 2 and a viewport resize event tells KidPage, which then marks
 * the page `data-zoomed="true"` (the session scrolls as a page). The window size and the Kid UI scale stay as they were.
 */
export async function emulatePinchZoom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("kid-session-frame")).toHaveAttribute("data-zoomed", "true");
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
      const overlay = document.querySelector<HTMLElement>(".kid-feedback-overlay");
      if (!overlay) throw new Error("settledDockReserve: no .kid-feedback-overlay (flow layout?)");
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

/** Browser-side state of the overlap probe (`installDockOverlapProbe`), kept on `window`. */
type DockOverlapProbeState = { samples: number[]; settled: number | null; scale: number; error: string | null };

/**
 * Records, frame by frame, how far the result panel covers the material content (spec 2026-10-31 §3.2, §5.1).
 * A `MutationObserver` waits for `.kid-feedback-overlay` (with `startNow`, an overlay already on the page starts the
 * probe at once). The first sample is taken right there: the `MutationObserver` callback runs at the end of the task
 * that inserted the panel, and the browser may paint right after that task, so the reserve must already be in place.
 * The probe then samples in its own `ResizeObserver` — created after the one in `ExerciseFrame`, and observers run in
 * creation order, so it sees the state after the frame's correction, just before paint — and after every paint
 * (`requestAnimationFrame` → `setTimeout(0)`) until five consecutive painted samples are identical.
 * An after-paint sample is skipped when the window or the DOM changed since the probe last ran inside that frame
 * (its `requestAnimationFrame` or `ResizeObserver` callback): other tasks may run between the paint and the timeout
 * (a `setViewportSize` landing there gave a 68 px sample of a layout that was never painted — the next frame's
 * observers corrected it first), and that layout is sampled in the next frame instead.
 * A sample is the lowest bottom edge among the children of `.kid-material-content` minus the top edge of
 * `.kid-feedback-overlay` (an element without the entrance transform), in screen pixels: positive means covered.
 */
export async function installDockOverlapProbe(page: Page, options: { startNow?: boolean } = {}): Promise<void> {
  await page.evaluate((startNow) => {
    const state: DockOverlapProbeState = { samples: [], settled: null, scale: 1, error: null };
    (window as unknown as { __kidDockOverlapProbe?: DockOverlapProbeState }).__kidDockOverlapProbe = state;
    const overlap = (): number | null => {
      const content = document.querySelector(".kid-material-content");
      const overlay = document.querySelector(".kid-feedback-overlay");
      if (!content || !overlay || content.children.length === 0) return null;
      return Math.max(...[...content.children].map((child) => child.getBoundingClientRect().bottom)) - overlay.getBoundingClientRect().top;
    };
    const record = () => {
      const value = overlap();
      if (value !== null) state.samples.push(value);
      return value;
    };
    const start = () => {
      record();
      // What the probe saw inside the current frame: DOM mutation count and window size.
      let mutations = 0;
      const mutationCounter = new MutationObserver((records) => { mutations += records.length; });
      mutationCounter.observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
      const frameState = () => `${mutations}:${window.innerWidth}x${window.innerHeight}`;
      let paintedState = frameState();
      const observer = new ResizeObserver(() => {
        record();
        paintedState = frameState();
      });
      for (const selector of [".kid-material", ".kid-material-content", ".kid-feedback-overlay"]) {
        const element = document.querySelector(selector);
        if (element) observer.observe(element);
      }
      // The document element follows the window, so a resize is sampled even when the frame has not reacted yet.
      observer.observe(document.documentElement);
      const stop = () => {
        observer.disconnect();
        mutationCounter.disconnect();
      };
      let previous: number | null = null;
      let identical = 0;
      let frames = 0;
      const afterPaint = () => requestAnimationFrame(() => {
        paintedState = frameState();
        setTimeout(() => {
          frames += 1;
          if (frameState() === paintedState) {
            const value = record();
            identical = value !== null && value === previous ? identical + 1 : 1;
            previous = value;
            if (value !== null && identical >= 5) {
              stop();
              state.scale = document.querySelector(".kid-page")?.currentCSSZoom ?? 1;
              state.settled = value;
              return;
            }
          }
          if (frames >= 600) {
            stop();
            state.error = `the overlap did not settle in 600 frames: ${JSON.stringify(state.samples.slice(-10))}`;
            return;
          }
          afterPaint();
        }, 0);
      });
      afterPaint();
    };
    if (startNow && document.querySelector(".kid-feedback-overlay")) {
      start();
      return;
    }
    const watcher = new MutationObserver(() => {
      if (!document.querySelector(".kid-feedback-overlay")) return;
      watcher.disconnect();
      start();
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  }, options.startNow ?? false);
}

/** Waits for the probe to settle and returns its samples, the settled overlap (screen px) and the Kid UI scale. */
export async function readDockOverlapProbe(page: Page): Promise<{ samples: number[]; settled: number; scale: number }> {
  const handle = await page.waitForFunction(() => {
    const state = (window as unknown as { __kidDockOverlapProbe?: DockOverlapProbeState }).__kidDockOverlapProbe;
    return state !== undefined && (state.settled !== null || state.error !== null) ? state : null;
  }, undefined, { timeout: 15_000 });
  const state = await handle.jsonValue() as DockOverlapProbeState;
  await handle.dispose();
  if (state.error !== null || state.settled === null) throw new Error(`dock overlap probe: ${state.error ?? "no settled value"}`);
  return { samples: state.samples, settled: state.settled, scale: state.scale };
}
