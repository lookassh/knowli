import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

for (const kind of ["picture_listening", "picture_recognition"] as const) {
for (const correctText of ["płaszcz", "pracownia komputerowa"]) {
test(`${kind}: incorrect feedback keeps ${correctText} and retry label readable`, async ({ page }, testInfo) => {
  const fixture = pictureChoiceLayoutFixture();
  const task = fixture.tasks[1]!;
  if (task.prompt.kind !== "picture_listening") throw new Error("Expected picture listening");
  task.prompt.options[0]!.labelPl = correctText;
  task.prompt.options.push({ id: "10000000-0000-4000-8000-000000000016", labelPl: "sweter", visual: { kind: "color", color: "#0000ff" } });
  if (kind === "picture_recognition") {
    fixture.tasks = [fixture.tasks[0]!, { ...task, exerciseType: "picture_recognition", direction: "source_to_target",
      prompt: { kind, visual: { kind: "color", color: "#ffff00" }, source: correctText,
        options: task.prompt.options.map((option) => ({ id: option.id, text: option.labelPl })) } }, null];
  }
  fixture.attempts = [{ ...fixture.attempts![0]!, taskState: "issued",
    feedback: { kind: "incorrect", correctText } }];
  await installKidUiFixture(page, fixture);
  await page.route("**/api/v1/media/10000000-0000-4000-8000-000000000015", (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" />' }));
  await page.setViewportSize({ width: 384, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await page.getByTestId("kid-option").nth(1).click();
  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();

  for (const viewport of [{ width: 384, height: 640 }, { width: 360, height: 540 },
    { width: 640, height: 360 }, { width: 768, height: 1024 }, { width: 1440, height: 960 },
    { width: 360, height: 640, zoom: true }]) {
    await page.setViewportSize(viewport);
    await page.evaluate((zoom) => { document.documentElement.style.fontSize = zoom ? "200%" : ""; }, "zoom" in viewport);
    await page.screenshot({ path: testInfo.outputPath(`feedback-${viewport.width}x${viewport.height}${"zoom" in viewport ? "-zoom" : ""}.png`) });
    const retry = page.getByTestId("kid-next");
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport({ ratio: 0.98 });
    const labelFits = await retry.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      return [...range.getClientRects()].every((part) => part.top >= rect.top && part.bottom <= rect.bottom);
    });
    expect(labelFits, `retry text clipped at ${viewport.width}x${viewport.height}`).toBe(true);
    const action = await retry.boundingBox();
    expect(action!.height).toBeGreaterThanOrEqual(54);
    expect(action!.width).toBeGreaterThanOrEqual(48);
    const answer = page.getByTestId("kid-feedback-correct-answer");
    await expect(answer).toHaveText(correctText);
    await answer.scrollIntoViewIfNeeded();
    await answer.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(answer).toBeInViewport({ ratio: 0.98 });
    await expect(dock).toContainText("Poprawna odpowiedź");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (!("zoom" in viewport) && viewport.height >= 540) {
      const material = await page.getByTestId("kid-material").boundingBox();
      const panel = await dock.boundingBox();
      for (const option of await page.getByTestId("kid-option").all()) {
        // Readable options may scroll inside the material after the real
        // footer appears; check each one in that viewport, without shrinking it.
        await option.evaluate((element) => element.scrollIntoView({ block: "center" }));
        const bounds = await option.boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(material!.y - 1);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(material!.y + material!.height + 1);
        expect(bounds!.height).toBeGreaterThanOrEqual(kind === "picture_listening" ? 112 : 48);
        expect(bounds!.y + bounds!.height, "feedback must not cover an answer tile").toBeLessThanOrEqual(panel!.y + 1);
      }
    }
    if ("zoom" in viewport || viewport.height < 480) {
      for (const option of await page.getByTestId("kid-option").all()) {
        await option.scrollIntoViewIfNeeded();
        await option.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await expect(option).toBeInViewport({ ratio: 0.98 });
        const bounds = await option.boundingBox();
        const panel = await dock.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(panel!.y + 1);
      }
      await retry.scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: testInfo.outputPath(`feedback-${viewport.width}x${viewport.height}${"zoom" in viewport ? "-zoom" : ""}.png`) });
  }
});
}
}
