import { expect, test, type Page } from "@playwright/test";

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

const TABS = ["tab-decks", "tab-children", "tab-progress", "tab-work-card"];

test("telefon: dolny pasek sekcji przy dolnej krawędzi i menu z akcjami", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    await openSignedInPanel(page);
    await expectNoHorizontalOverflow(page);
    for (const id of TABS) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
      expect(box!.y).toBeGreaterThan(viewport.height - 100);
    }
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
