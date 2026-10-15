import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DeckDtoSchema, DraftDtoSchema } from "@learning/contracts";

test("domyślna nawigacja: strona główna otwiera wybór profilu dziecka, link do rodzica i powrót do nauki", async ({ page }) => {
  // 1. Wejście na stronę główną /
  await page.goto("/");
  await expect(page.getByTestId("kid-parent-link")).toBeVisible();
  await expect(page.getByTestId("kid-parent-link")).toHaveAttribute("href", "/parent");

  // 2. Kliknięcie w link do panelu rodzica
  await page.getByTestId("kid-parent-link").click();
  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByTestId("auth-secret")).toBeVisible();
  await expect(page.getByTestId("to-learning")).toBeVisible();

  // 3. Powrót ze strony logowania rodzica do nauki
  await page.getByTestId("to-learning").click();
  await expect(page).toHaveURL(/\/(#.*)?$/);

  // 4. Logowanie rodzica i utworzenie profilu z zestawem
  const request = page.request;
  const setup = await request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  expect([201, 409]).toContain(setup.status());
  expect((await request.post("/api/v1/parent/login", { data: { secret: "1234" } })).status()).toBe(200);

  const childName = `Nav-${randomUUID().slice(0, 6)}`;
  const childRes = await request.post("/api/v1/parent/children", {
    data: { displayName: childName, avatarKey: "cat", birthYear: 2018 },
  });
  expect(childRes.status()).toBe(201);
  const child = (await childRes.json()) as { id: string };

  const deckId = randomUUID();
  const deckRes = await request.post("/api/v1/parent/decks", {
    data: { deckId, title: `Talia-${childName}` },
  });
  expect(deckRes.status()).toBe(201);
  const deckRead = await request.get(`/api/v1/parent/decks/${deckId}`);
  expect(deckRead.status()).toBe(200);
  const deck = DeckDtoSchema.parse(await deckRead.json());
  expect(deck.draft).not.toBeNull();
  const draftId = deck.draft!.id;
  const saved = await request.patch(`/api/v1/parent/drafts/${draftId}`, {
    data: {
      expectedEditNumber: deck.draft!.editNumber,
      items: [{
        source: "kot", target: "cat", acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
      }],
    },
  });
  expect(saved.status()).toBe(200);
  await expect.poll(async () => {
    const response = await request.get(`/api/v1/parent/drafts/${draftId}`);
    expect(response.status()).toBe(200);
    const draft = DraftDtoSchema.parse(await response.json());
    const audio = draft.assets.filter((asset) => asset.role === "target_audio");
    return audio.length === 1 && audio[0]!.state === "approved";
  }, { timeout: 60_000 }).toBe(true);
  const draft = DraftDtoSchema.parse(await (await request.get(`/api/v1/parent/drafts/${draftId}`)).json());
  expect((await request.post(`/api/v1/parent/drafts/${draftId}/publish`, {
    data: { expectedEditNumber: draft.editNumber },
  })).status()).toBe(200);
  expect((await request.put(`/api/v1/parent/assignments/${child.id}/${deckId}`, {
    data: { testDate: null },
  })).status()).toBe(204);

  // 5. Zalogowany panel rodzica zawiera link do nauki
  await page.goto("/parent");
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await expect(page.getByTestId("to-learning")).toBeVisible();

  // 6. Przejście do nauki dziecka
  await page.getByTestId("to-learning").click();
  await expect(page.getByTestId("kid-parent-link")).toBeVisible();

  // 7. Wybór profilu dziecka -> widok talii ma link do rodzica
  const profileButton = page.getByTestId("kid-profile").filter({ hasText: childName });
  await expect(profileButton).toBeVisible();
  await profileButton.click();

  await expect(page.getByTestId("kid-deck")).toBeVisible();
  await expect(page.getByTestId("kid-parent-link")).toBeVisible();

  // 8. Wejście do nauki -> link do rodzica znika podczas ćwiczeń
  await page.getByTestId("kid-deck").first().click();
  await expect(page.locator("[data-task-id]")).toBeVisible();
  await expect(page.getByTestId("kid-parent-link")).not.toBeVisible();
});

test("panel rodzica: zakładki z ikonami i stanem aktywnym", async ({ page }) => {
  const request = page.request;
  await request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  expect((await request.post("/api/v1/parent/login", { data: { secret: "1234" } })).status()).toBe(200);

  await page.goto("/parent");
  // Zestawy są aktywne po wejściu; każda zakładka ma ikonę, aktywność steruje aria-current
  await expect(page.getByTestId("tab-decks")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("tab-decks").locator("svg")).toBeVisible();

  await page.getByTestId("tab-children").click();
  await expect(page.getByTestId("tab-children")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("tab-decks")).toHaveAttribute("aria-current", "false");
  await expect(page.getByTestId("tab-children").locator("svg")).toBeVisible();

  await page.getByTestId("tab-progress").click();
  await expect(page.getByTestId("tab-progress")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("tab-decks")).toHaveAttribute("aria-current", "false");
  await expect(page.getByTestId("tab-progress").locator("svg")).toBeVisible();
});
