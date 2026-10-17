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
        childId, date: date ?? "2026-10-16", creditedSeconds: childId === firstChild ? 90 : 180, sessions: [],
        xboxRequests: [],
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
  // Clicking the selected child must not invalidate the in-flight response.
  await page.getByRole("button", { name: "Ala" }).click();
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

test("oczekujące zgłoszenie Xbox pozostaje widoczne poza wybranym dniem i otwiera kartę źródłową", async ({ page }) => {
  const requestId = "00000000-0000-4000-8000-000000000031";
  let status: "pending" | "fulfilled" | "rejected" = "pending";
  const dates: string[] = [];
  const decisions: string[] = [];
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
    ] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith(`/xbox-requests/${requestId}/decision`)) {
      status = (route.request().postDataJSON() as { decision: "fulfilled" | "rejected" }).decision;
      decisions.push(status);
      return route.fulfill({ json: { requestId, status, requestedAt: "2026-10-14T10:00:00.000Z", localDate: "2026-10-14", blockNumber: 1, pointsCost: 30, xboxMinutes: 15 } });
    }
    if (url.pathname.endsWith("/work-card")) {
      const date = url.searchParams.get("date") ?? "2026-10-16";
      dates.push(date);
      return route.fulfill({ json: {
        childId: firstChild, date, creditedSeconds: 0, sessions: [],
        xboxRequests: [{ requestId, status, requestedAt: "2026-10-14T10:00:00.000Z", timezone: "Europe/Warsaw", localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 }],
        dailyRound: { state: "completed", sessionId: "00000000-0000-4000-8000-000000000041", deckTitle: "Słówka", steps: 4, answered: 4 },
      } });
    }
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });

  const childrenLoaded = page.waitForResponse(response => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" })).toBeVisible();
  await page.getByLabel("Dzień").fill("2026-10-16");
  await expect.poll(() => dates.at(-1)).toBe("2026-10-16");
  await expect(page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" })).toBeVisible();
  await page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" }).click();
  await expect(page.getByLabel("Dzień")).toHaveValue("2026-10-14");
  await expect(page.getByText("Runda dnia")).toBeVisible();
  await expect(page.getByRole("region", { name: "Zgłoszenie pakietu Xbox" }).getByText("Pakiet z 2026-10-14 · blok 1")).toBeVisible();
  await expect(page.getByText(/nie oznacza odblokowania konsoli/i)).toBeVisible();
  await page.getByRole("button", { name: "Potwierdzam ręczne dodanie 15 minut" }).click();
  expect(decisions).toEqual(["fulfilled"]);
  await expect(page.getByText("Potwierdzono dodanie czasu")).toBeVisible();
  await expect(page.getByText("Oczekuje na decyzję rodzica")).toHaveCount(0);
});

test("odrzucenie zgłoszenia wysyła właściwą decyzję i pokazuje status odrzucony", async ({ page }) => {
  const requestId = "00000000-0000-4000-8000-000000000051";
  let status: "pending" | "rejected" = "pending";
  let decisionPayload: unknown;
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
    ] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith(`/xbox-requests/${requestId}/decision`)) {
      decisionPayload = route.request().postDataJSON();
      status = (decisionPayload as { decision: "rejected" }).decision;
      return route.fulfill({ json: { requestId, status, requestedAt: "2026-10-14T10:00:00.000Z", timezone: "Europe/Warsaw", localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 } });
    }
    if (url.pathname.endsWith("/work-card")) {
      const date = url.searchParams.get("date") ?? "2026-10-16";
      return route.fulfill({ json: {
        childId: firstChild, date, creditedSeconds: 0, sessions: [],
        xboxRequests: [{ requestId, status, requestedAt: "2026-10-14T10:00:00.000Z", timezone: "Europe/Warsaw", localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 }],
        dailyRound: { state: null, sessionId: null, deckTitle: null, steps: null, answered: null },
      } });
    }
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });

  const childrenLoaded = page.waitForResponse(response => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" })).toBeVisible();
  await page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" }).click();
  await page.getByRole("button", { name: "Nie dodano czasu — odrzuć zgłoszenie" }).click();
  expect(decisionPayload).toEqual({ decision: "rejected" });
  await expect(page.getByText("Odrzucono przed dodaniem czasu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nie dodano czasu — odrzuć zgłoszenie" })).toHaveCount(0);
});

test("błąd odrzuconej decyzji nie przechodzi na kartę po zmianie wyboru", async ({ page }) => {
  const requestId = "00000000-0000-4000-8000-000000000061";
  const secondRequestId = "00000000-0000-4000-8000-000000000062";
  let failDecision!: () => void;
  const decisionGate = new Promise<void>(resolve => { failDecision = resolve; });
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
      { id: secondChild, displayName: "Bartek", avatarKey: "bear", canRead: true },
    ] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith(`/xbox-requests/${requestId}/decision`)) {
      await decisionGate;
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "Błąd decyzji" }) });
    }
    if (url.pathname.endsWith("/work-card")) {
      const childId = url.searchParams.get("childId")!;
      const date = url.searchParams.get("date") ?? "2026-10-16";
      return route.fulfill({ json: {
        childId, date, creditedSeconds: 0, sessions: [],
        xboxRequests: childId === firstChild
          ? [{ requestId, status: "pending", requestedAt: "2026-10-14T10:00:00.000Z", timezone: "Europe/Warsaw", localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 }]
          : [{ requestId: secondRequestId, status: "pending", requestedAt: "2026-10-14T10:00:00.000Z", timezone: "Europe/Warsaw", localDate: "2026-10-14", blockNumber: 1, creditedSeconds: 1800, pointsCost: 30, xboxMinutes: 15 }],
        dailyRound: { state: null, sessionId: null, deckTitle: null, steps: null, answered: null },
      } });
    }
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });

  const childrenLoaded = page.waitForResponse(response => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" })).toBeVisible();
  await page.getByRole("button", { name: "Otwórz kartę pracy z 2026-10-14" }).click();
  await page.getByRole("button", { name: "Nie dodano czasu — odrzuć zgłoszenie" }).click();
  await page.getByRole("button", { name: "Bartek" }).click();
  const otherDecision = page.getByRole("button", { name: "Potwierdzam ręczne dodanie 15 minut" });
  await expect(otherDecision).toBeVisible();
  await expect(otherDecision).toBeDisabled();
  failDecision();
  await expect(otherDecision).toBeEnabled();
  await expect(page.getByText("Błąd decyzji")).toHaveCount(0);
  await expect(page.getByText("Bartek")).toBeVisible();
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
