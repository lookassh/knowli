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
          totalItems: 1, items: [{ ...report.items[0]!, source: "jabłko", target: "apple", meaningChanged: false,
            skills: { listening: "not_assessed", reading: "not_assessed", recall: "not_assessed",
              pronunciation: "not_assessed", spelling: "not_assessed" } }],
        };
      else throw new Error(`Nieoczekiwane API: ${url.pathname}`);
      await route.fulfill({ json: body });
    });
    await page.goto("/parent");
    await page.getByTestId("tab-progress").click();
    await page.getByTestId("progress-load").click();
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
    await page.getByTestId("progress-child").selectOption(otherChildId);
    await page.getByTestId("progress-deck").selectOption(otherDeckId);
    await page.getByTestId("progress-load").click();
    await expect(page.getByTestId("progress-heading")).toContainText("Owoce — Bartek");
    await expect(words).toHaveCount(1);
    await expect(words.first()).toContainText("apple");
    await expect(list).not.toContainText("Monday");
    await expect(list).not.toContainText("Zmieniono materiał");
    await page.getByTestId("progress-child").selectOption(childId);
    await page.getByTestId("progress-load").click();
    await expect(list).toContainText("Brak słów w tym zestawie.");
    await expect(words).toHaveCount(0);
    await expect(list.getByRole("table", { includeHidden: true })).toHaveCount(0);
  });
}
