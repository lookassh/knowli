import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Geometria ramy panelu rodzica (plan 2026-10-29-parent-ui-mantine, faza 1):
 * dolny pasek na telefonie (< 600 px), zakładki od 600 px, cele ≥ 44 px,
 * brak przewijania w poziomie oraz zapamiętany tryb jasny/ciemny.
 * API rodzica jest zaślepione — zalogowany panel bez zestawów i dzieci.
 */

async function openSignedInPanel(page: Page, path = "/parent/decks"): Promise<void> {
  await page.route("**/api/v1/parent/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) {
      return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(path);
  await expect(page.getByTestId("tab-decks")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const TABS = ["tab-decks", "tab-sources", "tab-children", "tab-progress", "tab-work-card"];

test("telefon: dolny pasek sekcji przy dolnej krawędzi i menu z akcjami", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await openSignedInPanel(page);
    await expectNoHorizontalOverflow(page);
    let previousRight = 0;
    for (const id of TABS) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
      expect(box!.width, id).toBeGreaterThanOrEqual(44);
      expect(box!.x, id).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(box!.y, id).toBeGreaterThan(viewport.height - 100);
      // pięć zakładek w jednym rzędzie, bez nachodzenia na siebie
      expect(box!.x, id).toBeGreaterThanOrEqual(previousRight - 0.5);
      previousRight = box!.x + box!.width;
      // etykieta mieści się w swojej zakładce (bez ucięcia i wyjścia poza pasek)
      const label = await page.getByTestId(id).evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      expect(label.scroll, id).toBeLessThanOrEqual(label.client);
    }
    await expect(page.getByTestId("tab-sources")).toHaveText(messages.sources.tab);
    await expect(page.getByTestId("tab-sources")).toHaveAttribute("href", "/parent/sources");
    await expect(page.getByTestId("to-learning")).toHaveCount(0);

    const menu = page.getByTestId("parent-menu");
    expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await menu.click();
    for (const id of ["to-learning", "parent-logout"]) {
      await expect(page.getByTestId(id)).toBeVisible();
      expect((await page.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");
  }
});

test("od 600 px: zakładki pod nagłówkiem, akcje w nagłówku", async ({ page }) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await openSignedInPanel(page);
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("parent-menu")).toHaveCount(0);
    for (const id of [...TABS, "to-learning", "parent-logout", "color-scheme-menu"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
      expect(box!.y, id).toBeLessThan(140);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(viewport.width + 0.5);
    }
  }
});

test("wybrany tryb ciemny przeżywa odświeżenie strony", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSignedInPanel(page);
  await page.getByTestId("color-scheme-menu").click();
  await page.getByTestId("color-scheme-control").getByText("Ciemny").click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");

  await page.reload();
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");

  await page.getByTestId("color-scheme-menu").click();
  await page.getByTestId("color-scheme-control").getByText("Jasny").click();
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "light");
});

test("nieudane pierwsze wczytanie list pokazuje błąd z ponowieniem, nie pusty stan", async ({ page }) => {
  let failLists = true;
  await page.route("**/api/v1/parent/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) {
      return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    }
    if (failLists) {
      return route.fulfill({ status: 503, json: { code: "internal", message: "x", retryable: true, requestId: "r" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/parent/children");
  await expect(page.getByTestId("panel-load-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(messages.children.empty)).toHaveCount(0);

  failLists = false;
  await page.getByTestId("panel-load-retry").click();
  await expect(page.getByTestId("panel-load-error")).toHaveCount(0);
  await expect(page.getByText(messages.children.empty)).toBeVisible();
});

test("powrót sieci nie przełącza panelu na logowanie (sesję sprawdzają tylko odpowiedzi 401)", async ({ page, context }) => {
  let authStateCalls = 0;
  await page.route("**/api/v1/parent/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) {
      authStateCalls += 1;
      return route.fulfill({ json: { authenticated: authStateCalls === 1, setupRequired: false } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/parent/decks");
  await expect(page.getByTestId("tab-decks")).toBeVisible();

  await context.setOffline(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(500);
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await expect(page.getByTestId("auth-secret")).toHaveCount(0);
  expect(authStateCalls).toBe(1);
});

const SAMPLE_DECKS = [
  { deckId: "10000000-0000-4000-8000-000000000001", title: "Dni tygodnia", state: "review", kind: "vocabulary", editableVersionId: null, publishedVersionId: null, itemCount: 7,
    assignedChildren: [{ childId: "20000000-0000-4000-8000-000000000001", displayName: "Ola", testDate: "2026-11-05" }] },
  { deckId: "10000000-0000-4000-8000-000000000002", title: `Bardzo długi tytuł zestawu ${"bezspacji".repeat(8)}`, state: "published", kind: "vocabulary", editableVersionId: null, publishedVersionId: null, itemCount: 10 },
  { deckId: "10000000-0000-4000-8000-000000000003", title: "Past Simple", state: "published", kind: "lesson", editableVersionId: null, publishedVersionId: null, itemCount: 24 },
  { deckId: "10000000-0000-4000-8000-000000000004", title: "Zwierzęta na farmie", state: "draft", kind: "vocabulary", editableVersionId: null, publishedVersionId: null, itemCount: 0 },
];

async function openDeckList(page: Page): Promise<void> {
  await page.route("**/api/v1/parent/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: SAMPLE_DECKS });
    return route.fulfill({ json: [] });
  });
  await page.goto("/parent/decks");
  await expect(page.getByTestId("deck-row-0")).toBeVisible();
}

test("lista zestawów: na telefonie przycisk „Nowy materiał” nad dolnym paskiem, bez przewijania w poziomie", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDeckList(page);
  await expectNoHorizontalOverflow(page);
  const fab = await page.getByTestId("new-material-open").boundingBox();
  const nav = await page.getByTestId("tab-decks").boundingBox();
  expect(fab!.height).toBeGreaterThanOrEqual(44);
  expect(fab!.y + fab!.height).toBeLessThanOrEqual(nav!.y);
  expect(fab!.x + fab!.width).toBeLessThanOrEqual(390);
  for (let index = 0; index < SAMPLE_DECKS.length; index += 1) {
    const row = await page.getByTestId(`deck-row-${index}`).boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(44);
    expect(row!.x + row!.width).toBeLessThanOrEqual(390);
  }
  await page.getByTestId("new-material-open").click();
  const dialog = await page.getByTestId("new-material-dialog").boundingBox();
  expect(dialog!.width).toBeGreaterThanOrEqual(389);
  await expect(page.getByTestId("new-material-generate")).toBeVisible();
});

test("lista zestawów: na desktopie przycisk w nagłówku sekcji, tryb ciemny obejmuje listę", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openDeckList(page);
  await expectNoHorizontalOverflow(page);
  const button = await page.getByTestId("new-material-open").boundingBox();
  expect(button!.y).toBeLessThan(250);
  const card = page.getByTestId("deck-row-0");
  const background = await card.evaluate((element) => getComputedStyle(element.closest("li")!).backgroundColor);
  const [r, g, b] = background.match(/\d+/g)!.map(Number);
  expect(r! + g! + b!).toBeLessThan(3 * 80);
});

test("nowy materiał: przejście do pustego formularza generowania przenosi fokus do pola w oknie", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDeckList(page);
  await page.getByTestId("new-material-open").click();
  await page.getByTestId("new-material-generate").click();
  await expect(page.getByTestId("generate-submit")).toBeDisabled();
  await expect(page.getByTestId("deck-title")).toBeFocused();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="new-material-dialog"]') !== null)).toBe(true);
  }
});
