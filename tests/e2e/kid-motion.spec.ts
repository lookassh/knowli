import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

// Motion runs for real here (no reduced-motion emulation): the animated
// task switch, tap feedback and feedback dock must keep the flow usable.
test("animated task switch and feedback dock keep the session flow working", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, pictureChoiceLayoutFixture(), { reducedMotion: false });
  const audio = Buffer.alloc(204);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  await page.route("**/api/v1/media/10000000-0000-4000-8000-000000000012", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: audio }));

  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_exposure");

  // Task switch animates (exit + enter); the next task must land and work.
  await page.getByTestId("kid-done").click();
  // The exiting pane must be inert while it animates out, and the switch
  // must actually animate (sampled mid-transition, not just eventually).
  await expect.poll(() => page.getByTestId("kid-task-transition").evaluate((el) => el.hasAttribute("inert")), { intervals: [20, 50, 100] }).toBe(true);
  await expect.poll(() => page.getByTestId("kid-task-transition").evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity)), { intervals: [50, 100, 200] }).toBeLessThan(1);
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");

  await page.getByTestId("kid-option").first().click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();

  await page.getByTestId("kid-next").click();
  // The exiting pane is inert: a stray second activation must not advance again.
  await page.evaluate(() => { document.querySelector<HTMLElement>("[data-testid=kid-next]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await expect(page.getByTestId("kid-summary-guidance")).toBeVisible();
});
