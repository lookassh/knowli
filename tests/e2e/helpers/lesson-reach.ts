import { expect, type Locator, type Page } from "@playwright/test";
import { expectFrameFillsViewport } from "./kid-frame";

/**
 * Osiągalność elementów ćwiczeń z przypisaniami („Połącz w pary”, „Pogrupuj”,
 * „Uzupełnij tekst”): po przewinięciu do widoku element mieści się
 * w viewporcie i w kontenerze materiału, cele dotykowe mają minimum, a strona
 * i materiał nie przewijają się w poziomie.
 */

export interface ReachTarget {
  testId: string;
  nth?: number;
  /** Minimalna wysokość celu dotykowego (szerokość zawsze ≥48 px). */
  minHeight?: number;
  /** Element wyższy niż niski viewport (akapit tekstu) — sprawdzany tylko w poziomie. */
  tall?: boolean;
}

interface Box { x: number; y: number; width: number; height: number }

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("element has no layout box");
  return box;
}

/** Odcinek [start, end] mieści się w [min, max] z tolerancją 1 px. */
function expectSpanWithin(start: number, end: number, min: number, max: number, name: string): void {
  expect(start, name).toBeGreaterThanOrEqual(min - 1);
  expect(end, name).toBeLessThanOrEqual(max + 1);
}

function locate(page: Page, target: ReachTarget): Locator {
  const all = page.getByTestId(target.testId);
  return target.nth === undefined ? all : all.nth(target.nth);
}

export async function expectTargetsReachable(page: Page, viewport: { width: number; height: number }, targets: readonly ReachTarget[]): Promise<void> {
  const label = `${viewport.width}x${viewport.height}`;
  await expectFrameFillsViewport(page, viewport);
  const material = await boxOf(page.getByTestId("kid-material"));
  for (const target of targets) {
    const locator = locate(page, target);
    await locator.scrollIntoViewIfNeeded();
    const box = await boxOf(locator);
    const name = `${target.testId}${target.nth === undefined ? "" : `[${target.nth}]`} at ${label}`;
    expectSpanWithin(box.x, box.x + box.width, 0, viewport.width, name);
    expectSpanWithin(box.x, box.x + box.width, material.x, material.x + material.width, `${name} inside material`);
    if (!target.tall) expectSpanWithin(box.y, box.y + box.height, 0, viewport.height, name);
    if (target.minHeight !== undefined) {
      expect(box.height, `${name} height`).toBeGreaterThanOrEqual(target.minHeight);
      expect(box.width, `${name} width`).toBeGreaterThanOrEqual(48);
    }
  }
  const overflow = await page.evaluate(() => {
    const material = document.querySelector<HTMLElement>("[data-testid='kid-material']");
    return {
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      material: material !== null && material.scrollWidth > material.clientWidth + 1,
    };
  });
  expect(overflow, `horizontal overflow at ${label}`).toEqual({ page: false, material: false });
}

/** Przyciski nie ucinają tekstu: długi tekst się zawija. */
export async function expectButtonsNotClipped(page: Page, testId: string, label: string): Promise<void> {
  const clipped = await page.getByTestId(testId).evaluateAll((buttons) => buttons.filter((button) =>
    button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1).length);
  expect(clipped, `${testId} clipped at ${label}`).toBe(0);
}
