import { expect, test } from "@playwright/test";
import { type ProgressDto } from "@learning/contracts";

const childId = "00000000-0000-4000-8000-000000000001";
const otherChildId = "00000000-0000-4000-8000-000000000002";
const deckId = "00000000-0000-4000-8000-000000000003";
const otherDeckId = "00000000-0000-4000-8000-000000000004";
const report: ProgressDto = {
  childId, childName: "Ala", deckId, deckTitle: "Dni tygodnia", testDate: null,
  totalItems: 2, skills: [], confusions: [], history: [],
  pronunciation: { assessed: false, latestScores: [] },
  activity: {
    days: 7, activeSeconds: 38 * 60, activeDays: 3, sessions: 5, answers: 84, interactions: 210,
    decks: [
      { deckId, deckTitle: "Dni tygodnia", sessions: 3 },
      { deckId: otherDeckId, deckTitle: "Owoce", sessions: 2 },
    ],
    daily: [
      { date: "2026-10-08", activeSeconds: 0, sessions: 0 },
      { date: "2026-10-09", activeSeconds: 15 * 60, sessions: 2 },
      { date: "2026-10-10", activeSeconds: 0, sessions: 0 },
      { date: "2026-10-11", activeSeconds: 5 * 60, sessions: 1 },
      { date: "2026-10-12", activeSeconds: 0, sessions: 0 },
      { date: "2026-10-13", activeSeconds: 0, sessions: 0 },
      { date: "2026-10-14", activeSeconds: 18 * 60, sessions: 2 },
    ],
  },
  items: [
    {
      itemId: "00000000-0000-4000-8000-000000000005", position: 0,
      source: "poniedziałek", target: "Monday", meaningChanged: false,
      skills: { listening: "mastered", reading: "needs_confirmation", recall: "needs_reconfirmation",
        pronunciation: "not_assessed", spelling: "practicing" },
    },
    {
      itemId: "00000000-0000-4000-8000-000000000006", position: 1,
      source: "środa", target: "Wednesday", meaningChanged: true,
      skills: { listening: "needs_confirmation", reading: "mastered", recall: "not_assessed",
        pronunciation: "not_assessed", spelling: "mastered" },
    },
  ],
};

for (const viewport of [{ width: 1280, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`pełna lista słów i osobne statusy umiejętności (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // Zastępujemy transport API; renderowanie, interakcje i CSS pozostają rzeczywiste.
    await page.route("**/api/v1/parent/**", async (route) => {
      const url = new URL(route.request().url());
      let body: unknown;
      if (url.pathname.endsWith("/login")) body = { authenticated: true, setupRequired: false };
      else if (url.pathname.endsWith("/children")) body = [
        { id: childId, displayName: "Ala", avatarKey: "star" },
        { id: otherChildId, displayName: "Bartek", avatarKey: "star" },
      ];
      else if (url.pathname.endsWith("/decks")) body = [deckId, otherDeckId].map((id, index) => ({
        deckId: id, title: index === 0 ? "Dni tygodnia" : "Owoce", state: "published",
        editableVersionId: null, publishedVersionId: id,
      }));
      else if (url.pathname.endsWith("/progress")) body = url.searchParams.get("childId") === childId
        && url.searchParams.get("deckId") === deckId ? report : url.searchParams.get("childId") === childId ? {
          ...report, deckId: otherDeckId, deckTitle: "Owoce", totalItems: 0, items: [],
        } : {
          ...report, childId: otherChildId, childName: "Bartek", deckId: otherDeckId, deckTitle: "Owoce",
          activity: {
            days: 7, activeSeconds: 0, activeDays: 0, sessions: 0, answers: 0, interactions: 0, decks: [],
            daily: [
              { date: "2026-10-08", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-09", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-10", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-11", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-12", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-13", activeSeconds: 0, sessions: 0 },
              { date: "2026-10-14", activeSeconds: 0, sessions: 0 },
            ],
          },
          totalItems: 1, items: [{ ...report.items[0]!, source: "jabłko", target: "apple", meaningChanged: false,
            skills: { listening: "not_assessed", reading: "not_assessed", recall: "not_assessed",
              pronunciation: "not_assessed", spelling: "not_assessed" } }],
        };
      else if (url.pathname.endsWith("/mock-tests")) body = [];
      else throw new Error(`Nieoczekiwane API: ${url.pathname}`);
      await route.fulfill({ json: body });
    });
    await page.goto("/parent");
    await page.getByTestId("tab-progress").click();
    // auto-load po wejściu: karty pojawiają się bez przycisku
    // paski opanowania czytają segmenty z etykiety aria
    const listeningBar = page.getByTestId("progress-skill-listening");
    await expect(listeningBar).toHaveAttribute("aria-label", "1 z 2: opanowane 1, do potwierdzenia 1, w trakcie nauki 0, nie sprawdzono 0");
    await expect(page.getByTestId("progress-skill-recall")).toHaveAttribute("aria-label", "0 z 2: opanowane 0, do potwierdzenia 1, w trakcie nauki 0, nie sprawdzono 1");
    await expect(page.getByTestId("progress-skills")).toContainText("Opanowane (potwierdzone po przerwie)");
    // karta aktywności dziecka: czas, dni, podejścia per zestaw, odpowiedzi, kliknięcia
    const activity = page.getByTestId("progress-activity");
    await expect(activity).toBeVisible();
    await expect(activity).toContainText("Aktywność (ostatnie 7 dni)");
    await expect(activity).toContainText("Czas nauki: 38 min");
    // kafelki dzienne
    const daily = activity.getByTestId("progress-activity-daily");
    await expect(daily).toBeVisible();
    const tiles = daily.locator('[data-testid^="progress-activity-day-"]');
    await expect(tiles).toHaveCount(7);
    await expect(tiles.last()).toContainText("Dziś");
    await expect(tiles.last()).toContainText("18 min");
    await expect(tiles.first()).toContainText("—");
    await expect(activity).toContainText("Dni z nauką: 3");
    await expect(activity).toContainText("Podejścia: 5");
    await expect(activity).toContainText("Dni tygodnia — 3");
    await expect(activity).toContainText("Owoce — 2");
    await expect(activity).toContainText("Odpowiedzi: 84");
    await expect(activity).toContainText("Kliknięcia: 210");
    const list = page.getByRole("region", { name: "Wszystkie słowa" });
    await expect(list).toBeVisible();
    const words = viewport.width > 900 ? list.getByRole("row").filter({ has: page.getByRole("rowheader") })
      : list.getByRole("listitem");
    await expect(words).toHaveCount(2);
    const monday = words.nth(0);
    await expect(monday).toContainText("Monday");
    await expect(monday).toContainText("poniedziałek");
    for (const status of ["Opanowane", "Do potwierdzenia", "Do ponownego potwierdzenia", "W trakcie nauki", "Nie sprawdzono"]) {
      await expect(monday).toContainText(status);
    }
    await expect(words.nth(1)).toContainText("Wednesday");
    await expect(words.nth(1)).toContainText("Zmieniono materiał — wymagane ponowne sprawdzenie");
    if (viewport.width > 900) {
      await expect(list.getByRole("columnheader")).toHaveCount(7);
      await expect(monday.getByRole("cell")).toHaveText([
        "poniedziałek", "Opanowane", "Do potwierdzenia", "Do ponownego potwierdzenia", "Nie sprawdzono", "W trakcie nauki",
      ]);
    }
    else {
      await expect(list.getByRole("table")).toBeHidden();
      await expect(monday.locator("dt")).toHaveText([
        "Rozpoznaje ze słuchu", "Rozpoznaje z tekstu", "Przypomina samodzielnie", "Wymawia", "Pisze samodzielnie",
      ]);
      await expect(monday.locator("dd")).toHaveText([
        "Opanowane", "Do potwierdzenia", "Do ponownego potwierdzenia", "Nie sprawdzono", "W trakcie nauki",
      ]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await list.screenshot({ path: test.info().outputPath(`words-${viewport.width}.png`) });
    await page.getByTestId("progress-child").getByRole("button", { name: "Bartek" }).click();
    await expect(page.getByTestId("progress-child").getByRole("button", { name: "Bartek" })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("progress-deck").selectOption(otherDeckId);
    await expect(page.getByTestId("progress-heading")).toContainText("Owoce — Bartek");
    // dziecko bez aktywności: jasny komunikat zamiast zer
    await expect(page.getByTestId("progress-activity")).toContainText("Brak rozpoczętej nauki w tym okresie.");
    await expect(words).toHaveCount(1);
    await expect(words.first()).toContainText("apple");
    await expect(list).not.toContainText("Monday");
    await expect(list).not.toContainText("Zmieniono materiał");
    await page.getByTestId("progress-child").getByRole("button", { name: "Ala" }).click();
    await expect(list).toContainText("Brak słów w tym zestawie.");
    await expect(words).toHaveCount(0);
    await expect(list.getByRole("table", { includeHidden: true })).toHaveCount(0);
  });
}

test("wygaśnięcie sesji podczas ładowania Postępów wraca do ekranu logowania", async ({ page }) => {
  await page.route("**/api/v1/parent/login", async (route) => {
    await route.fulfill({ json: { authenticated: true, setupRequired: false } });
  });
  await page.route("**/api/v1/parent/children", async (route) => {
    await route.fulfill({ json: [{ id: childId, displayName: "Ala", avatarKey: "star" }] });
  });
  await page.route("**/api/v1/parent/decks", async (route) => {
    await route.fulfill({ json: [{ deckId, title: "Dni tygodnia", state: "published", editableVersionId: null, publishedVersionId: deckId }] });
  });
  await page.route("**/api/v1/parent/progress", async (route) => {
    await route.fulfill({ status: 401, json: { code: "unauthorized", message: "sesja wygasła" } });
  });
  await page.goto("/parent");
  await page.getByTestId("tab-progress").click();
  await expect(page.getByTestId("auth-secret")).toBeVisible({ timeout: 10_000 });
});
