import { expect, test } from "@playwright/test";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

const viewports = [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 727, height: 953 },
];

test("trzy odpowiedzi obrazkowe mieszczą się bez przewijania", async ({ page }, testInfo) => {
  await page.setViewportSize(viewports[0]!);
  await installKidUiFixture(page, pictureChoiceLayoutFixture());
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
  await page.getByTestId("kid-done").click();

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("żółty");
  await expect(options.nth(1)).toContainText("jeden");
  await expect(options.nth(2)).toContainText("kot");

  for (const [index, viewport] of viewports.entries()) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await assertKidLayout(page);

      const geometry = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".kid-material-content")!;
        const contentBounds = content.getBoundingClientRect();
        const viewportBounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const options = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")];
        const play = document.querySelector<HTMLElement>("[data-testid='kid-play']")!.getBoundingClientRect();
        const root = document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!;
        const scrolling = document.scrollingElement!;
        return {
          contentScrollHeight: content.scrollHeight,
          contentClientHeight: content.clientHeight,
          contentScrollWidth: content.scrollWidth,
          contentClientWidth: content.clientWidth,
          rootScrollHeight: root.scrollHeight,
          rootClientHeight: root.clientHeight,
          documentScrollHeight: scrolling.scrollHeight,
          documentClientHeight: scrolling.clientHeight,
          play: { width: play.width, height: play.height, top: play.top, bottom: play.bottom },
          options: options.map((option) => {
            const bounds = option.getBoundingClientRect();
            const visual = option.querySelector<HTMLElement>(".kid-picture-choice-visual")!.getBoundingClientRect();
            const label = option.querySelector<HTMLElement>(".kid-picture-choice-label")!.getBoundingClientRect();
            return {
              top: bounds.top,
              bottom: bounds.bottom,
              left: bounds.left,
              right: bounds.right,
              height: bounds.height,
              fullyInsideContent: bounds.top >= contentBounds.top && bounds.bottom <= contentBounds.bottom,
              fullyInsideViewport: bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom &&
                bounds.left >= viewportBounds.left && bounds.right <= viewportBounds.right,
              labelFollowsVisual: label.left >= visual.right,
            };
          }),
        };
      });

      expect(geometry.options, JSON.stringify(geometry)).toHaveLength(3);
      expect(geometry.options.every((option) => option.fullyInsideContent), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.fullyInsideViewport), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.height >= 48), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.labelFollowsVisual), JSON.stringify(geometry)).toBe(true);
      expect(geometry.play.width, JSON.stringify(geometry)).toBeGreaterThanOrEqual(48);
      expect(geometry.play.height, JSON.stringify(geometry)).toBeGreaterThanOrEqual(48);
      expect(geometry.play.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
      expect(geometry.play.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(viewport.height);
      expect(geometry.contentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientHeight + 1);
      expect(geometry.contentScrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientWidth + 1);
      expect(geometry.rootScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.rootClientHeight + 1);
      expect(geometry.documentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
      if (index === 0 || index === viewports.length - 1) {
        await page.screenshot({ path: testInfo.outputPath(`picture-options-${viewport.width}x${viewport.height}.png`) });
      }
    });
  }
});
