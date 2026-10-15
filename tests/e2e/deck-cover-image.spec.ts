import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";

test("dedykowana okładka wygrywa z wizualizacją słowa bez utraty informacji karty", async ({ page }) => {
  const fixture = pictureVocabularyFixture();
  fixture.decks = [
    { ...fixture.decks[0]!, coverAssetId: "10000000-0000-4000-8000-000000000099" },
    fixture.decks[1]!,
  ];
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();

  const covered = page.getByTestId("kid-deck-card").first();
  await expect(covered.getByTestId("kid-deck-cover")).toHaveAttribute("src", "/api/v1/media/10000000-0000-4000-8000-000000000099");
  await expect(covered.locator(".kid-visual")).toHaveCount(0);
  await expect(covered.getByTestId("kid-deck-title")).toContainText("Kolory");
  await expect(covered.getByTestId("kid-deck-stars")).toBeVisible();
  await expect(covered.getByTestId("kid-deck")).toBeVisible();

  const fallback = page.getByTestId("kid-deck-card").nth(1);
  await expect(fallback.locator(".kid-visual")).toBeVisible();
});
