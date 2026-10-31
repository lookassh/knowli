import { expect, test, type Page } from "@playwright/test";
import { completedRecallFixture, sessionId } from "./helpers/kid-fixtures";
import { expectFrameFillsViewport, expectInteractiveTargets, waitForKidScale } from "./helpers/kid-frame";
import { measure, resizeAndSettle, type Viewport } from "./helpers/kid-layout";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

// Large windows zoom the whole Kid UI by min(width / 840, height / 900), capped at 1.6 and rounded
// down to 0.01 (spec 2026-10-30-kid-ui-large-screens §3.4). Expected scales are written out on purpose.
const SESSION_WINDOWS = [
  { width: 1280, height: 600, scale: 1 },
  { width: 1536, height: 730, scale: 1 },
  { width: 1920, height: 1080, scale: 1.2 },
  { width: 1146, height: 1300, scale: 1.36 },
  { width: 3440, height: 1300, scale: 1.44 },
  { width: 3440, height: 1440, scale: 1.6 },
] as const;

const ULTRAWIDE = { width: 3440, height: 1440 };

async function openPictureChoice(page: Page) {
  await installKidUiFixture(page, pictureChoiceLayoutFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");
}

async function openWrittenRecall(page: Page) {
  await installKidUiFixture(page, completedRecallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

/** Document scroll size against the window: zoom must not make the page wider or taller than the screen. */
async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    width: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight - window.innerHeight,
  }));
}

async function expectSessionFitsWindow(page: Page, viewport: Viewport) {
  const name = `${viewport.width}x${viewport.height}`;
  await expectFrameFillsViewport(page, viewport);
  const overflow = await documentOverflow(page);
  expect(overflow.width, `horizontal overflow: ${name}`).toBeLessThanOrEqual(0);
  expect(overflow.height, `vertical overflow: ${name}`).toBeLessThanOrEqual(0);
}

for (const { width, height, scale } of SESSION_WINDOWS) {
  test(`session at ${width}x${height} uses scale ${scale} and fills the window`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPictureChoice(page);
    await waitForKidScale(page, scale);
    await expectSessionFitsWindow(page, { width, height });
  });
}

test("rescales on resize", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openPictureChoice(page);
  await waitForKidScale(page, 1.6);
  await expectSessionFitsWindow(page, ULTRAWIDE);

  const fullHd = { width: 1920, height: 1080 };
  await resizeAndSettle(page, fullHd);
  await waitForKidScale(page, 1.2);
  await expectSessionFitsWindow(page, fullHd);
});

test("short flow screens do not scroll", async ({ page }) => {
  const fixture: KidUiFixture = {
    ...completedRecallFixture(),
    summary: { sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1, endedAt: "2026-10-11T10:01:00.000Z",
      independentSuccesses: { recall: 1, spelling: 0 }, practiceItems: [] },
  };
  await installKidUiFixture(page, fixture);
  await page.setViewportSize(ULTRAWIDE);
  await page.goto("/");

  const expectFlowFitsWindow = async (name: string) => {
    await waitForKidScale(page, 1.6);
    // Window-unit tokens divide by --kid-zoom, so min-height 100dvh stays one screen tall under zoom.
    await expect.poll(async () => {
      const layout = await measure(page, { page: ".kid-page" });
      const overflow = await documentOverflow(page);
      const deviation = Math.max(Math.abs(layout.page.left), Math.abs(layout.page.top),
        Math.abs(layout.page.width - ULTRAWIDE.width), Math.abs(layout.page.height - ULTRAWIDE.height));
      return overflow.width <= 0 && overflow.height <= 1 && deviation <= 1 ? "ok" : JSON.stringify({ page: layout.page, overflow });
    }, { message: `${name} fits the window without scrolling` }).toBe("ok");
  };

  await expect(page.getByTestId("kid-profile")).toHaveCount(1);
  await expectFlowFitsWindow("profile screen");

  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck-screen")).toBeVisible();
  await expectFlowFitsWindow("deck screen");

  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();
  await page.getByTestId("kid-end-confirm-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expectFlowFitsWindow("summary");
});

test("answer text scales", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await waitForKidScale(page, 1.6);
  // A rectangle is in screen pixels and offsetHeight in inner pixels: their ratio is the zoom.
  const ratio = await page.getByTestId("kid-input").evaluate((element: HTMLElement) =>
    element.getBoundingClientRect().height / element.offsetHeight);
  expect(ratio).toBeGreaterThanOrEqual(1.59);
  expect(ratio).toBeLessThanOrEqual(1.61);
});

test("targets stay large", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await page.getByTestId("kid-input").fill("cat");
  await waitForKidScale(page, 1.6);
  await expectInteractiveTargets(page, [
    "[data-testid='kid-input']",
    "[data-testid='kid-submit']",
    "[data-testid='kid-not-remember']",
    "[data-testid='kid-end']",
  ]);
  const submit = await page.getByTestId("kid-submit").boundingBox();
  expect(submit!.height, "primary action height").toBeGreaterThanOrEqual(54);
});

test("end-session sheet", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await waitForKidScale(page, 1.6);
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();
  const layout = await measure(page, {
    scrim: "[data-testid='kid-end-confirm-scrim']",
    sheet: "[data-testid='kid-end-confirm']",
  });
  expect(Math.abs(layout.scrim.left), "scrim left").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.top), "scrim top").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.width - ULTRAWIDE.width), "scrim width").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.height - ULTRAWIDE.height), "scrim height").toBeLessThanOrEqual(1);
  // The sheet keeps its 560 px column cap in inner pixels, i.e. 560 x 1.6 on screen.
  expect(layout.sheet.width, "sheet width").toBeLessThanOrEqual(560 * 1.6 + 1);
  expect(Math.abs((layout.sheet.left + layout.sheet.right) / 2 - ULTRAWIDE.width / 2), "sheet centred").toBeLessThanOrEqual(1);
  expect(layout.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(layout.innerWidth);
});
