import { expect, test } from "@playwright/test";

const firstChild = "00000000-0000-4000-8000-000000000001";
const secondChild = "00000000-0000-4000-8000-000000000002";

test("karta pracy odświeża raport po zmianie dziecka i daty", async ({ page }) => {
  const requested: Array<{ childId: string | null; date: string | null }> = [];
  let releaseFirstReport!: () => void;
  const firstReportGate = new Promise<void>((resolve) => { releaseFirstReport = resolve; });
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith("/login")) body = { authenticated: true, setupRequired: false };
    else if (url.pathname.endsWith("/children")) body = [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
      { id: secondChild, displayName: "Bartek", avatarKey: "bear", canRead: true },
    ];
    else if (url.pathname.endsWith("/decks")) body = [];
    else if (url.pathname.endsWith("/work-card")) {
      const childId = url.searchParams.get("childId");
      const date = url.searchParams.get("date");
      requested.push({ childId, date });
      await firstReportGate;
      body = {
        childId, date, creditedSeconds: childId === firstChild ? 90 : 180, sessions: [],
        dailyRound: { state: null, sessionId: null, deckTitle: null, steps: null, answered: null },
      };
    } else throw new Error(`Nieoczekiwane API: ${url.pathname}`);
    await route.fulfill({ json: body });
  });

  const childrenLoaded = page.waitForResponse((response) => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByRole("button", { name: "Ala" })).toBeVisible();
  await expect(page.locator(".pp-work-card .pp-loading")).toHaveText("Wczytuję kartę pracy…");
  releaseFirstReport();
  await expect(page.getByText("1 min 30 s")).toBeVisible();
  await expect(page.getByText("Brak zapisanej pracy tego dnia.")).toBeVisible();
  await expect(page.getByText("Nie uruchomiono / brak zapisu")).toBeVisible();

  await page.getByRole("button", { name: "Bartek" }).click();
  await expect(page.getByText("3 min 0 s")).toBeVisible();

  const date = "2026-10-15";
  await page.getByLabel("Dzień").fill(date);
  await expect.poll(() => requested.at(-1)).toEqual({ childId: secondChild, date });
  await expect(page.getByText("3 min 0 s")).toBeVisible();
  expect(requested.some((value) => value.childId === firstChild)).toBe(true);
});

test("karta pracy pokazuje błąd ładowania raportu", async ({ page }) => {
  await page.route("**/api/v1/parent/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (path.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
    ] });
    if (path.endsWith("/decks")) return route.fulfill({ json: [] });
    if (path.endsWith("/work-card")) return route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ message: "Błąd raportu" }),
    });
    throw new Error(`Nieoczekiwane API: ${path}`);
  });

  const childrenLoaded = page.waitForResponse((response) => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.locator(".pp-work-card .pp-error")).toHaveText("Błąd raportu");
});
