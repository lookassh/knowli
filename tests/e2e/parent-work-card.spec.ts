import { expect, test } from "@playwright/test";

const firstChild = "00000000-0000-4000-8000-000000000001";
const secondChild = "00000000-0000-4000-8000-000000000002";

function workCardBody(childId: string, date: string, overrides: Record<string, unknown> = {}) {
  return {
    childId, date, creditedSeconds: 0, unevaluatedSessions: 0, reviewService: null, sessions: [],
    ...overrides,
  };
}

test("karta pracy odświeża raport po zmianie dziecka i daty", async ({ page }) => {
  const requested: Array<{ childId: string | null; date: string | null }> = [];
  let releaseFirstReport!: () => void;
  const firstReportGate = new Promise<void>((resolve) => { releaseFirstReport = resolve; });
  // po wyczyszczeniu daty: odpowiedź „dziś” ma nowsze dane, a pytania z datą wiszą,
  // więc nowsze dane może pokazać tylko przeniesiona odpowiedź bez daty
  let afterClear = false;
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
      if (afterClear && date) await new Promise(() => undefined);
      const seconds = afterClear ? 240 : childId === firstChild ? 90 : 180;
      body = workCardBody(childId!, date ?? "2026-10-16", { creditedSeconds: seconds });
    } else throw new Error(`Nieoczekiwane API: ${url.pathname}`);
    await route.fulfill({ json: body });
  });

  const childrenLoaded = page.waitForResponse((response) => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByRole("button", { name: "Ala" })).toBeVisible();
  await expect(page.getByTestId("work-card-loading")).toHaveText("Wczytuję kartę pracy…");
  // Clicking the selected child must not invalidate the in-flight response.
  await page.getByRole("button", { name: "Ala" }).click();
  releaseFirstReport();
  await expect(page.getByText("1 min 30 s")).toBeVisible();
  await expect(page.getByText("Brak zapisanej pracy tego dnia.")).toBeVisible();

  // pierwsze wczytanie ustala dzień z API; zmiana dziecka pyta o ten sam dzień
  await expect(page.getByLabel("Dzień")).toHaveValue("2026-10-16");
  await page.getByRole("button", { name: "Bartek" }).click();
  await expect(page.getByText("3 min 0 s")).toBeVisible();
  expect(requested.filter((value) => value.childId === secondChild)).toEqual([{ childId: secondChild, date: "2026-10-16" }]);

  const date = "2026-10-15";
  await page.getByLabel("Dzień").fill(date);
  await expect.poll(() => requested.at(-1)).toEqual({ childId: secondChild, date });
  await expect(page.getByText("3 min 0 s")).toBeVisible();
  expect(requested.some((value) => value.childId === firstChild)).toBe(true);

  // wyczyszczenie pola znaczy „dziś”: zawsze nowe pytanie do API, nie stary wpis z pamięci
  const before = requested.length;
  afterClear = true;
  await page.getByLabel("Dzień").fill("");
  await expect.poll(() => requested.slice(before)).toContainEqual({ childId: secondChild, date: null });
  await expect(page.getByLabel("Dzień")).toHaveValue("2026-10-16");
  // świeższa odpowiedź „dziś” zastępuje starszy wpis tego dnia (180 s)
  await expect(page.getByTestId("work-card-credited")).toHaveText("4 min 0 s");
});

test("karta pracy pokazuje wynik oceny sesji, wykluczenia i sesje bez oceny", async ({ page }) => {
  const sessionId = "00000000-0000-4000-8000-000000000031";
  const taskId = "00000000-0000-4000-8000-000000000032";
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
    ] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/work-card")) {
      return route.fulfill({ json: workCardBody(firstChild, "2026-10-16", {
        creditedSeconds: 180,
        unevaluatedSessions: 1,
        sessions: [
          {
            sessionId, mode: "training", state: "completed",
            startedAt: "2026-10-16T10:00:00.000Z", endedAt: "2026-10-16T10:06:00.000Z",
            deckTitle: "Dni tygodnia", deckVersionNumber: 3, remainingSteps: 0,
            activity: {
              status: "evaluated", durationSeconds: 360, activeSeconds: 300, approvedSeconds: 180,
              pointsAwarded: 3, reason: "Większość zadań zawierała rzeczywiste próby.", errorCode: null,
              excludedTasks: [{ taskOrdinal: 1, reason: "Wysłano wyłącznie aaa." }],
              details: { modelReason: "Jedno zadanie nie zawierało pracy.", tasks: [{ taskOrdinal: 0, instruction: "Przypomnij słowo", stimulus: "kot", options: [], acceptedAnswers: ["cat"], submittedAnswers: ["cat"], activeMilliseconds: 12000, editCount: 2, playbackCount: 1, modelNote: null }] },
            },
            steps: [{ taskId, ordinal: 0, exerciseType: "recall", state: "answered", issuedAt: "2026-10-16T10:00:05.000Z", responses: [] }],
          },
        ],
        reviewService: "review.example · model-a",
      }) });
    }
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });

  const childrenLoaded = page.waitForResponse(response => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByTestId("work-card-credited")).toHaveText("3 min 0 s");
  await expect(page.getByText("Sesje bez oceny: 1")).toBeVisible();
  const activity = page.getByTestId("work-card-activity");
  await expect(activity).toHaveAttribute("data-status", "evaluated");
  await expect(activity.getByText("Czas całkowity: 6 min 0 s")).toBeVisible();
  await expect(activity.getByText("Czas aktywny: 5 min 0 s")).toBeVisible();
  await expect(activity.getByText("Zatwierdzony: 3 min 0 s")).toBeVisible();
  await expect(activity.getByText("Punkty: 3")).toBeVisible();
  await expect(activity.getByText("Uzasadnienie oceny: Większość zadań zawierała rzeczywiste próby.")).toBeVisible();
  await expect(activity.getByText("Zadania wykluczone z zaliczenia czasu")).toBeVisible();
  await activity.getByText("Zadania wykluczone z zaliczenia czasu").click();
  await expect(activity.getByText("Zadanie 2: Wysłano wyłącznie aaa.")).toBeVisible();
  await expect(page.getByTestId("work-card-review-service")).toContainText("review.example · model-a");
  await activity.getByText("Szczegóły oceny zadań").click();
  await expect(activity.getByText("Wzorzec: cat")).toBeVisible();
  await expect(activity.getByText("Odpowiedzi: cat")).toBeVisible();
});

test("karta pracy informuje, gdy szczegóły oceny wygasły", async ({ page }) => {
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [{ id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true }] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/work-card")) return route.fulfill({ json: workCardBody(firstChild, "2026-10-16", { sessions: [{
      sessionId: "00000000-0000-4000-8000-000000000051", mode: "training", state: "completed",
      startedAt: "2026-10-16T10:00:00.000Z", endedAt: "2026-10-16T10:06:00.000Z", deckTitle: "Dni", deckVersionNumber: 1, remainingSteps: 0,
      activity: { status: "evaluated", durationSeconds: 360, activeSeconds: 300, approvedSeconds: 180, pointsAwarded: 3, reason: "Zaliczone.", errorCode: null, excludedTasks: null, details: null }, steps: [],
    }] }) });
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });
  await page.goto("/parent");
  await page.getByTestId("tab-work-card").click();
  await expect(page.getByText("Szczegóły oceny są już niedostępne (dostępne 7 dni od sesji).")).toBeVisible();
});

test("sesja bez raportu ma jawny brak oceny, a nie zero zatwierdzonej aktywności", async ({ page }) => {
  const sessionId = "00000000-0000-4000-8000-000000000041";
  await page.route("**/api/v1/parent/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (url.pathname.endsWith("/children")) return route.fulfill({ json: [
      { id: firstChild, displayName: "Ala", avatarKey: "star", canRead: true },
    ] });
    if (url.pathname.endsWith("/decks")) return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/work-card")) {
      return route.fulfill({ json: workCardBody(firstChild, "2026-10-16", {
        unevaluatedSessions: 1,
        sessions: [{
          sessionId, mode: "training", state: "ended",
          startedAt: "2026-10-16T10:00:00.000Z", endedAt: "2026-10-16T10:06:00.000Z",
          deckTitle: "Dni tygodnia", deckVersionNumber: 3, remainingSteps: 0,
          activity: { status: "not_delivered", durationSeconds: 0, activeSeconds: 0, approvedSeconds: 0, pointsAwarded: 0, reason: null, errorCode: null, excludedTasks: null },
          steps: [],
        }],
      }) });
    }
    throw new Error(`Nieoczekiwane API: ${url.pathname}`);
  });

  const childrenLoaded = page.waitForResponse(response => response.url().includes("/api/v1/parent/children"));
  await page.goto("/parent");
  await childrenLoaded;
  await page.getByTestId("tab-work-card").click();
  const activity = page.getByTestId("work-card-activity");
  await expect(activity).toHaveAttribute("data-status", "not_delivered");
  await expect(activity.getByText("Brak raportu aktywności — czas tej sesji nie został oceniony.")).toBeVisible();
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
  // błąd 5xx przychodzi po dwóch ponowieniach zapytania (polityka query-client)
  await expect(page.getByTestId("work-card-error")).toHaveText("Błąd raportu", { timeout: 15_000 });
});
