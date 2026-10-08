import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Pełny obieg rodzica z zadania 4: generuj → preview/edit → publikuj → przypisz.
 * Świat (baza, web, worker z fake providerami) stawia global-setup i jest
 * współdzielony z innymi specami — własne wiersze lokalizujemy po treści.
 */

const DECK_TITLE = "Dni tygodnia — obieg rodzica";

function deckRow(page: Page) {
  return page.locator('[data-testid^="deck-row"]').filter({ hasText: DECK_TITLE });
}

function isoDate(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

test("pełny obieg rodzica: generuj, popraw, publikuj, przypisz", async ({ page, request }) => {
  test.slow();

  // Pierwsze uruchomienie w czystym świecie: setup PIN rodzica; w świecie
  // współdzielonym z innymi specami ten sam formularz loguje istniejącym PIN-em.
  await page.goto("/");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();

  // Profile dwojga dzieci — świat współdzieli bazę z innymi specami,
  // więc szukamy wierszy po imieniu, a nie po indeksie.
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-name").fill("Ala");
  await page.getByTestId("child-year").fill("2018");
  await page.getByTestId("child-add").click();
  await expect(page.locator('[data-testid^="child-row"]').filter({ hasText: "Ala" })).toHaveCount(1);
  await page.getByTestId("child-name").fill("Bartek");
  await page.getByTestId("child-add").click();
  await expect(page.locator('[data-testid^="child-row"]').filter({ hasText: "Bartek" })).toHaveCount(1);

  // Nowy zestaw o znanym terminie sprawdzianu (za siedem dni).
  await page.getByTestId("tab-decks").click();
  await page.getByTestId("deck-prompt").fill("angielskie dni tygodnia dla początkującego dziecka");
  await page.getByTestId("deck-title").fill(DECK_TITLE);
  await page.getByTestId("generate-submit").click();
  // panel pokazuje nowy zestaw od razu po przyjęciu polecenia (202)
  await expect(deckRow(page)).toContainText(DECK_TITLE);

  // Odświeżenie strony w trakcie generowania: panel dalej prowadzi przegląd.
  await page.reload();
  await expect(deckRow(page)).toContainText(DECK_TITLE);
  await deckRow(page).click();
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
  const alaAssignRow = page.locator('[data-testid^="assign-row-"]').filter({ hasText: "Ala" });
  await alaAssignRow.locator('[data-testid^="assign-date-"]').fill(alaDate);
  await alaAssignRow.locator('[data-testid^="assign-submit-"]').click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  const bartekAssignRow = page.locator('[data-testid^="assign-row-"]').filter({ hasText: "Bartek" });
  await bartekAssignRow.locator('[data-testid^="assign-date-"]').fill(bartekDate);
  await bartekAssignRow.locator('[data-testid^="assign-submit-"]').click();
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Przypisania przeżywają odświeżenie strony.
  await page.reload();
  await deckRow(page).click();
  await expect(page.getByTestId("assignment-row-0")).toContainText(alaDate);
  await expect(page.getByTestId("assignment-row-1")).toContainText(bartekDate);

  // Nowa wersja opublikowanego materiału (SPEC §84): wgląd w opublikowane
  // elementy, szkic v2 z kopią treści i mediów, zmiana znaczenia słowa,
  // ponowna publikacja. Opublikowana wersja pozostaje niezmieniona.
  await expect(page.getByTestId("item-target-0")).toHaveValue("monday");
  await expect(page.getByTestId("item-source-0")).toBeDisabled();
  await page.getByTestId("new-version").click();
  await expect(page.getByTestId("item-source-0")).toBeEnabled();
  const mondaySource = await page.getByTestId("item-source-0").inputValue();
  await page.getByTestId("item-source-0").fill(`${mondaySource} (dzień)`);

  // Klik nie czeka na PATCH: stan mediów weryfikujemy w odpowiedzi zapisu,
  // a nie na DOM, który chwilę po kliknięciu pokazuje jeszcze stan przed zapisem.
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/drafts/"),
  );
  await page.getByTestId("save-items").click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const savedDraft = (await savedResponse.json()) as {
    items: { revisionId: string }[];
    assets: { itemRevisionId: string; role: string; state: string }[];
  };
  const mondayRevision = savedDraft.items[0]!.revisionId;
  // niezmieniony angielski cel zachowuje gotowe audio bez regeneracji
  const mondayAudio = savedDraft.assets.find(
    (asset) => asset.role === "target_audio" && asset.itemRevisionId === mondayRevision,
  );
  expect(mondayAudio?.state).toBe("approved");
  // obraz ilustruje znaczenie — zmiana źródła planuje nową generację
  const mondayImage = savedDraft.assets.find(
    (asset) => asset.role === "illustration" && asset.itemRevisionId === mondayRevision,
  );
  expect(mondayImage?.state).toBe("pending");

  // publikacja dopiero, gdy nowy obraz dojrzeje w workerze (fake delay 3 s)
  await expect(page.getByTestId("item-image-state-0")).toContainText("generowanie");
  await expect(page.getByTestId("item-image-state-0")).toContainText("gotowy", { timeout: 60_000 });
  await page.getByTestId("publish-deck").click();
  await expect(page.getByTestId("publish-status")).toContainText(messages.decks.published);

  // Nieopublikowana treść nie jest dostępna w Kid API.
  const kid = await request.get("/api/v1/kid/decks?childId=00000000-0000-0000-0000-000000000000");
  expect(kid.status()).toBe(404);
});
