import { expect, test } from "@playwright/test";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 768, height: 1024 }]) {
test(`dziecko nieczytające uczy się bez pola tekstowego (${viewport.width}x${viewport.height})`, async ({ page }, testInfo) => {
  await page.setViewportSize(viewport);
  await installKidUiFixture(page, pictureVocabularyFixture());
  await page.goto("/");
  await expect(page.getByText("Uczę się bez czytania")).toBeVisible();
  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck-card").locator(".kid-visual")).toHaveCount(2);
  await expect(page.getByTestId("kid-deck-card").nth(0).locator(".kid-visual")).toHaveAttribute("aria-label", "Kolor");
  await expect(page.getByTestId("kid-deck-card").nth(1).locator(".kid-visual")).toHaveAttribute("aria-label", "4 elementów");
  await page.getByTestId("kid-deck").first().click();
  await assertKidLayout(page);
  await page.screenshot({ path: testInfo.outputPath("picture-task.png") });
  await expect(page.getByTestId("kid-illustration").or(page.locator(".kid-visual"))).toBeVisible();
  await expect(page.getByTestId("kid-input")).toHaveCount(0);
  await page.getByTestId("kid-done").click();

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("czerwony");
  await expect(options.first()).not.toContainText("red");
  await options.first().click();
  await assertKidLayout(page);
  await page.screenshot({ path: testInfo.outputPath("picture-feedback.png") });
  await page.getByTestId("kid-next").click();

  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_recall");
  await expect(page.getByTestId("kid-input")).toHaveCount(0);
  await expect(page.getByTestId("kid-record")).toHaveCount(0);
  await page.getByTestId("kid-skip").click();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-again")).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("picture-summary.png") });
});
}

test("karta wznowienia używa trybu aktywnej sesji i nie pokazuje nowych startów", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  fixture.decks = [
    { ...fixture.decks[0]!, resumeOnly: true, activeSession: { sessionId: fixture.session.sessionId, mode: "training" } },
  ];
  fixture.session.resumed = true;
  const startRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/kid/sessions") && request.method() === "POST");
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck")).toHaveCount(0);
  await expect(page.getByTestId("kid-mock-start")).toHaveCount(0);
  await expect(page.getByTestId("kid-end-active-session")).toBeVisible();
  await page.getByTestId("kid-resume-session").click();
  const request = await startRequest;
  expect(request.postDataJSON()).toMatchObject({ mode: "training", supportsPictureVocabulary: true });
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_exposure");
});
