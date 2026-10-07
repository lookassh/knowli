import { expect, test } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Pełny obieg rodzica z zadania 4: generuj → preview/edit → publikuj → przypisz.
 * Świat (baza, web, worker z fake providerami) stawia global-setup.
 */

function isoDate(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("pełny obieg rodzica: generuj, popraw, publikuj, przypisz", async ({ page, request }) => {
  test.slow();

  // Pierwsze uruchomienie: setup PIN rodzica i automatyczne zalogowanie.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: messages.auth.setupTitle })).toBeVisible();
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();

  // Profile dwojga dzieci.
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-name").fill("Ala");
  await page.getByTestId("child-year").fill("2018");
  await page.getByTestId("child-add").click();
  await expect(page.getByTestId("child-row-0")).toContainText("Ala");
  await page.getByTestId("child-name").fill("Bartek");
  await page.getByTestId("child-add").click();
  await expect(page.getByTestId("child-row-1")).toContainText("Bartek");

  // Nowy zestaw o znanym terminie sprawdzianu (za siedem dni).
  await page.getByTestId("tab-decks").click();
  await page.getByTestId("deck-prompt").fill("angielskie dni tygodnia dla początkującego dziecka");
  await page.getByTestId("deck-title").fill("Dni tygodnia");
  await page.getByTestId("generate-submit").click();
  // panel pokazuje nowy zestaw od razu po przyjęciu polecenia (202)
  await expect(page.getByTestId("deck-row-0")).toContainText("Dni tygodnia");

  // Odświeżenie strony w trakcie generowania: panel dalej prowadzi przegląd.
  await page.reload();
  const deckRow = page.getByTestId("deck-row-0");
  await expect(deckRow).toContainText("Dni tygodnia");
  await deckRow.click();
  await expect(page.getByTestId("generation-banner")).toContainText(messages.decks.generating);
  await expect(page.getByTestId("item-card-0")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("item-card-6")).toBeVisible();
  await expect(page.getByTestId("item-target-0")).toHaveValue("monday");
  await expect(page.getByTestId("item-accepted-4")).toHaveValue("Friday, Fri.");

  // Odtworzenie audio celu przed edycją.
  await expect(page.getByTestId("item-audio-state-0")).toContainText("gotowe", { timeout: 60_000 });
  const firstAudio = page.waitForResponse((r) => r.url().includes("/api/v1/media/"));
  await page.getByTestId("item-play-0").click();
  const firstAudioResponse = await firstAudio;
  expect(firstAudioResponse.status()).toBe(200);
  expect(firstAudioResponse.headers()["content-type"]).toContain("audio/mpeg");

  // Popraw słowo i wariant; kosztowna regeneracja dopiero po jawnym zapisie.
  await page.getByTestId("item-target-3").fill("thursday");
  await page.getByTestId("item-accepted-3").fill("Thursday");
  await page.getByTestId("save-items").click();
  await expect(page.getByTestId("item-target-3")).toHaveValue("thursday");
  await expect(page.getByTestId("item-audio-state-3")).toContainText("generowanie");

  // Publikacja zablokowana, dopóki obowiązkowe TTS nie jest gotowe.
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("api-error")).toContainText(messages.errors.validation);

  // Nowe audio gotowe → odtworzenie nowego zasobu.
  await expect(page.getByTestId("item-audio-state-3")).toContainText("gotowe", { timeout: 60_000 });
  const fixedAudio = page.waitForResponse((r) => r.url().includes("/api/v1/media/"));
  await page.getByTestId("item-play-3").click();
  const fixedAudioResponse = await fixedAudio;
  expect(fixedAudioResponse.status()).toBe(200);
  expect(fixedAudioResponse.headers()["content-type"]).toContain("audio/mpeg");

  // Zły obraz świadomie pominięty — publikacja bez niego jest dozwolona.
  await page.getByTestId("item-omit-image-3").click();
  await expect(page.getByTestId("item-image-state-3")).toContainText("pominięty");

  for (const index of [0, 1, 2, 4]) {
    await expect(page.getByTestId(`item-image-state-${index}`)).toContainText("gotowy", {
      timeout: 60_000,
    });
  }
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("publish-status")).toContainText(messages.decks.published);

  // Przypisanie dwojgu dzieciom z różnymi terminami sprawdzianu.
  const alaDate = isoDate(7);
  const bartekDate = isoDate(14);
  await page.getByTestId("assign-date-0").fill(alaDate);
  await page.getByTestId("assign-submit-0").click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  await page.getByTestId("assign-date-1").fill(bartekDate);
  await page.getByTestId("assign-submit-1").click();
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Przypisania przeżywają odświeżenie strony.
  await page.reload();
  await page.getByTestId("deck-row-0").click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Nieopublikowana treść nie jest dostępna w Kid API.
  const kid = await request.get("/api/v1/kid/decks?childId=00000000-0000-0000-0000-000000000000");
  expect(kid.status()).toBe(404);
});
