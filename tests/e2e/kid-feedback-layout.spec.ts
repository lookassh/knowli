import { expect, test, type Locator } from "@playwright/test";
import { waitForKidScale } from "./helpers/kid-frame";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

// Long text may exceed the available rectangle. Both ends must remain
// reachable through the frame/material, without a scroller inside the answer.
async function expectTextReachable(element: Locator) {
  for (const edge of ["start", "end"] as const) {
    const geometry = await element.evaluate((node, block) => {
      node.scrollIntoView({ block });
      const rect = node.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (!/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) continue;
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
      return { edge: block === "start" ? rect.top : rect.bottom, top, bottom };
    }, edge);
    expect(geometry.edge, `${edge} of text should be reachable`).toBeGreaterThanOrEqual(geometry.top - 1);
    expect(geometry.edge, `${edge} of text should be reachable`).toBeLessThanOrEqual(geometry.bottom + 1);
  }
}

for (const kind of ["picture_listening", "picture_recognition"] as const) {
for (const correctText of ["płaszcz", "pracownia komputerowa", "Nie wolno nam jeść w klasie.", "Podczas lekcji słuchamy nauczyciela, pomagamy kolegom i spokojnie wykonujemy wszystkie zadania zapisane na szkolnej tablicy."]) {
test(`${kind}: incorrect feedback keeps ${correctText} and retry label readable`, async ({ page }, testInfo) => {
  const fixture = pictureChoiceLayoutFixture();
  fixture.uiAudio = { ready: true, assets: {} };
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
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await page.getByTestId("kid-option").nth(1).click();
  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  // Before screenshots or manual scrolling, the verdict must reveal its action.
  await expect(page.getByTestId("kid-next")).toBeInViewport({ ratio: 0.98 });

  // 1440x960 zooms by 1.06. Rectangles are compared with rectangles or the window (screen pixels) and
  // scrollHeight with clientHeight (layout pixels), so no check mixes the two.
  for (const viewport of [{ width: 384, height: 640, scale: 1 }, { width: 360, height: 540, scale: 1 }, { width: 320, height: 480, scale: 1 },
    { width: 640, height: 360, scale: 1 }, { width: 768, height: 1024, scale: 1 }, { width: 1440, height: 960, scale: 1.06 }]) {
    await page.setViewportSize(viewport);
    await waitForKidScale(page, viewport.scale);
    await page.screenshot({ path: testInfo.outputPath(`feedback-${viewport.width}x${viewport.height}.png`) });
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
    const presentation = await answer.evaluate((element) => {
      const content = element.closest<HTMLElement>(".kid-feedback-content")!;
      const card = element.closest<HTMLElement>(".kid-answer-feedback")!;
      return {
        scrolls: content.scrollHeight > content.clientHeight + 1,
        background: getComputedStyle(card).backgroundColor,
        border: getComputedStyle(card).borderTopWidth,
      };
    });
    expect(presentation.scrolls, "correct answer should grow with its content").toBe(false);
    expect(presentation.background).toBe("rgba(0, 0, 0, 0)");
    expect(presentation.border).toBe("0px");
    await expectTextReachable(answer);
    await expect(dock).toContainText("Poprawna odpowiedź");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (viewport.height >= 480) {
      for (const option of await page.getByTestId("kid-option").all()) {
        // Readable options may scroll inside the material after the real
        // footer appears; check each one in that viewport, without shrinking it.
        await expectTextReachable(option);
        const material = await page.getByTestId("kid-material").boundingBox();
        const panel = await dock.boundingBox();
        const bounds = await option.boundingBox();
        if (bounds!.height <= material!.height) {
          await expect(option).toBeInViewport({ ratio: 0.98 });
          expect(bounds!.y).toBeGreaterThanOrEqual(material!.y - 1);
        }
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(material!.y + material!.height + 1);
        expect(bounds!.height).toBeGreaterThanOrEqual(kind === "picture_listening" ? 112 : 48);
        expect(bounds!.y + bounds!.height, "feedback must not cover an answer tile").toBeLessThanOrEqual(panel!.y + 1);
      }
    }
    if ("zoom" in viewport || viewport.height < 480) {
      for (const option of await page.getByTestId("kid-option").all()) {
        await expectTextReachable(option);
        const bounds = await option.boundingBox();
        const panel = await dock.boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(panel!.y + 1);
      }
      await retry.scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: testInfo.outputPath(`feedback-${viewport.width}x${viewport.height}.png`) });
  }
});
}
}
