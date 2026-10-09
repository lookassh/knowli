import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

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
  await request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  await request.post("/api/v1/parent/login", { data: { secret: "1234" } });

  const childName = `Nav-${randomUUID().slice(0, 6)}`;
  const childRes = await request.post("/api/v1/parent/children", {
    data: { displayName: childName, avatarKey: "cat", birthYear: 2018 },
  });
  const child = (await childRes.json()) as { id: string };

  const deckRes = await request.post("/api/v1/parent/decks", {
    data: { title: `Talia-${childName}` },
  });
  const { deckId, draftId } = (await deckRes.json()) as { deckId: string; draftId: string };
  await request.patch(`/api/v1/parent/drafts/${draftId}`, {
    data: {
      expectedEditNumber: 1,
      items: [{ source: "kot", target: "cat", pronunciationTarget: "cat", options: [] }],
    },
  });
  await request.post(`/api/v1/parent/drafts/${draftId}/publish`);
  await request.put(`/api/v1/parent/assignments/${child.id}/${deckId}`, { data: { testDate: null } });

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
