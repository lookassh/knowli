import { expect, test } from "@playwright/test";
import { installKidUiFixture, silentWavBuffer } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

// Motion runs for real here (no reduced-motion emulation): the animated
// task switch, tap feedback and feedback dock must keep the flow usable.
test("animated task switch and feedback dock keep the session flow working", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, pictureChoiceLayoutFixture(), { reducedMotion: false });
  await page.route("**/api/v1/media/10000000-0000-4000-8000-000000000012", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: silentWavBuffer() }));

  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  // Flow screens switch through ScreenTransition: measure the entering
  // deck pane specifically, not the exiting profile pane.
  await expect.poll(() => page.locator("[data-testid='kid-screen-transition']:has([data-testid='kid-deck-screen'])").evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)), { intervals: [20, 50, 100] }).toBeLessThan(1);
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_exposure");

  // Task switch animates (exit + enter); the next task must land and work.
  // Sample every frame of the switch: the panes must move sideways, and that
  // motion must never give the material scroller a horizontal range.
  const switchSamples = page.evaluate(() => new Promise<{ maxShift: number; overflowFrames: number }>((resolve) => {
    let maxShift = 0;
    let overflowFrames = 0;
    const started = performance.now();
    const frame = () => {
      for (const pane of document.querySelectorAll<HTMLElement>("[data-testid='kid-task-transition']")) {
        maxShift = Math.max(maxShift, Math.abs(new DOMMatrixReadOnly(getComputedStyle(pane).transform).m41));
      }
      for (const scroller of document.querySelectorAll<HTMLElement>("[data-testid='kid-material'], .kid-page--session")) {
        if (scroller.scrollWidth > scroller.clientWidth + 1) overflowFrames += 1;
      }
      if (performance.now() - started < 900) requestAnimationFrame(frame);
      else resolve({ maxShift, overflowFrames });
    };
    requestAnimationFrame(frame);
  }));
  await page.getByTestId("kid-done").click();
  // The exiting pane must be inert while it animates out, and the switch
  // must actually animate (sampled mid-transition, not just eventually).
  await expect.poll(() => page.getByTestId("kid-task-transition").evaluate((el) => el.hasAttribute("inert")), { intervals: [20, 50, 100] }).toBe(true);
  await expect.poll(() => page.getByTestId("kid-task-transition").evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)), { intervals: [50, 100, 200] }).toBeLessThan(1);
  const { maxShift, overflowFrames } = await switchSamples;
  expect(maxShift, "task panes slide sideways").toBeGreaterThan(8);
  expect(overflowFrames, "no horizontal scroll range during the slide").toBe(0);
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");

  // The answer pop and the dock entrance must never give any scroller a
  // transient range: a scrollbar flashing for a few frames reads as a glitch.
  const answerSamples = page.evaluate(() => new Promise<string[]>((resolve) => {
    const hits = new Set<string>();
    const started = performance.now();
    const frame = () => {
      for (const scroller of document.querySelectorAll<HTMLElement>("[data-testid='kid-exercise'], [data-testid='kid-material'], .kid-page--session")) {
        const style = getComputedStyle(scroller);
        if (/auto|scroll/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) hits.add(`${scroller.dataset.testid ?? scroller.className} Y`);
        if (/auto|scroll/.test(style.overflowX) && scroller.scrollWidth > scroller.clientWidth + 1) hits.add(`${scroller.dataset.testid ?? scroller.className} X`);
      }
      if (performance.now() - started < 1000) requestAnimationFrame(frame);
      else resolve([...hits]);
    };
    requestAnimationFrame(frame);
  }));
  await page.getByTestId("kid-option").first().click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
  expect(await answerSamples, "no transient scroll range while the answer animates").toEqual([]);
  // The chosen option reports its server outcome (pop/shake icon appears).
  await expect(page.locator("[data-testid='kid-outcome-correct'], [data-testid='kid-outcome-wrong']")).toHaveCount(1);
  // Only a tile the child chose correctly bursts (decoratively, then it is
  // removed); a wrong choice never celebrates the revealed answer.
  const choseWrong = await page.getByTestId("kid-outcome-wrong").count() > 0;
  if (choseWrong) {
    await expect(page.getByTestId("kid-answer-burst")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("kid-answer-burst")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("kid-answer-burst")).toHaveCount(0, { timeout: 3000 });
  }
  // The session header shows progress (bar or "Jeszcze N" pill with a fill).
  await expect(page.getByTestId("kid-progress-fill")).toHaveCount(1);

  await page.getByTestId("kid-next").click();
  // The summary mounts a fresh ScreenTransition after the session screen;
  // its entrance (and the celebration burst) must still animate instead of
  // being suppressed as a first render.
  await expect.poll(() => page.getByTestId("kid-screen-transition").evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)), { intervals: [20, 50, 100] }).toBeLessThan(1);
  await expect(page.getByTestId("kid-celebration")).toHaveCount(1);
  // The exiting pane is inert: a stray second activation must not advance again.
  await page.evaluate(() => { document.querySelector<HTMLElement>("[data-testid=kid-next]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await expect(page.getByTestId("kid-summary-guidance")).toBeVisible();
});
