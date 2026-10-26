import { expect, test, type Locator } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";

async function expectReadable(control: Locator) {
  const contrast = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };
    const text = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return { color: style.color, background: style.backgroundColor,
      ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) };
  });
  expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
}

test("round audio buttons keep a readable icon on their resting background", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  const assetId = "10000000-0000-4000-8000-000000000012";
  fixture.tasks = [{ ...fixture.tasks[0]!, exerciseType: "exposure", direction: null, prompt: {
    kind: "exposure", source: "kot", target: "cat", example: "The cat is sleeping.",
    audioAssetId: assetId, exampleAudioAssetId: assetId, imageAssetId: assetId, visualType: "image",
  } }];
  await installKidUiFixture(page, fixture);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  for (const testId of ["kid-play", "kid-play-example"]) {
    const control = page.getByTestId(testId);
    await expect(control).toBeVisible();
    await expectReadable(control);
  }
  /* The round audio button keeps its 64px circle and soft resting surface,
     not the filled primary pill. */
  const play = page.getByTestId("kid-play");
  const box = await play.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(64);
  expect(Math.round(box!.height)).toBe(64);
  await expect.poll(() => play.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(48, 63, 100)");
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const kind of ["reading", "lesson_gap"] as const) {
    test(`${kind} answers remain readable with ${colorScheme} system theme`, async ({ page }, testInfo) => {
      const fixture = pictureVocabularyFixture();
      fixture.profiles[0]!.canRead = true;
      fixture.session.canRead = true;
      fixture.tasks = [{ ...fixture.tasks[0]!, exerciseType: kind, direction: null, prompt: kind === "reading"
        ? { kind, text: "leg", options: [
          { id: "10000000-0000-4000-8000-000000000081", text: "noga" },
          { id: "10000000-0000-4000-8000-000000000082", text: "ręka" },
          { id: "10000000-0000-4000-8000-000000000083", text: "głowa" },
        ] }
        : { kind, instructionPl: "Wpisz poprawną formę czasownika w okienko.", stemWithGap: "We ___ pizza.", hint: "eat" } }];
      await installKidUiFixture(page, fixture);
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto("/");
      await page.getByTestId("kid-profile").click();
      await page.getByTestId("kid-deck").first().click();
      const control = page.getByTestId(kind === "reading" ? "kid-option" : "kid-lesson-gap-input");
      await expect(control.first()).toBeVisible();
      if (kind === "lesson_gap") await control.fill("eat");
      for (const element of await control.all()) await expectReadable(element);
      await page.screenshot({ path: testInfo.outputPath(`${kind}-${colorScheme}.png`) });
    });
  }
}
