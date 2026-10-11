import type { KidDeckDto } from "@learning/contracts";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

const expect = baseExpect.configure({ timeout: 1_500 });
test.use({ viewport: { width: 390, height: 844 } });

const childId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000003";

function makeDeck(index: number, options: Partial<KidDeckDto> = {}): KidDeckDto {
  return {
    deckId: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    title: `Angielski zestaw ${index + 1}`,
    itemCount: 12,
    independentlyRecalledCount: 3,
    testDate: "2026-10-23",
    recommended: index % 2 === 0,
    mockTestAvailable: true,
    activeSession: null,
    ...options,
  };
}

async function openDeckScreen(page: Page, decks: KidDeckDto[]) {
  page.setDefaultTimeout(5_000);
  await installKidUiFixture(page, {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" }],
    decks,
    session: { mode: "training", sessionId, childId, deckId: decks[0]?.deckId ?? makeDeck(0).deckId,
      deckVersionId: "10000000-0000-4000-8000-000000000004", policyId: "default", microphoneEnabled: false,
      state: "active", taskBudget: 1, tasksIssued: 0, assessedTasksIssued: 0,
      startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
    tasks: [],
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
}

test("deck card actions address the same deck", async ({ page }) => {
  const decks = [makeDeck(0), makeDeck(1)];
  await openDeckScreen(page, decks);
  await page.getByTestId("kid-decks-next").click();
  await page.route("**/api/v1/kid/sessions", async (route) => route.abort());
  const card = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const learningRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await card.getByRole("button", { name: "Ucz się" }).click();
  expect((await learningRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "training" });

  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-decks-next").click();
  const sameCard = page.getByTestId("kid-deck-card").filter({ hasText: decks[1]!.title });
  const mockRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/kid/sessions" && request.method() === "POST");
  await sameCard.getByRole("button", { name: "Próbna kartkówka" }).click();
  expect((await mockRequest).postDataJSON()).toMatchObject({ deckId: decks[1]!.deckId, mode: "mock_test" });
});

test("all assigned decks remain reachable and the page clamps after responsive pagination shrinks", async ({ page }) => {
  const decks = Array.from({ length: 4 }, (_, index) => makeDeck(index));
  const expectedOrder = [decks[0]!, decks[2]!, decks[1]!, decks[3]!];
  await openDeckScreen(page, decks);
  for (let index = 0; index < expectedOrder.length; index += 1) {
    await expect(page.getByTestId("kid-deck-card")).toHaveCount(1);
    await expect(page.getByTestId("kid-deck-card")).toContainText(expectedOrder[index]!.title);
    if (index < expectedOrder.length - 1) await page.getByTestId("kid-decks-next").click();
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId("kid-decks-page")).toHaveText("2 z 2");
  await expect(page.getByTestId("kid-deck-card").filter({ hasText: decks[3]!.title })).toBeVisible();
});

test("short phone viewport paginates two deck cards to avoid document scrolling", async ({ page }) => {
  const decks = [makeDeck(0, { recommended: true }), makeDeck(1, { recommended: true })];
  await page.setViewportSize({ width: 360, height: 640 });
  await openDeckScreen(page, decks);
  await expect(page.getByTestId("kid-deck-card")).toHaveCount(1);
  await expect(page.getByTestId("kid-decks-page")).toHaveText("1 z 2");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(641);
  await expect(page.getByTestId("kid-deck")).toBeInViewport();
  await expect(page.getByTestId("kid-decks-next")).toBeInViewport();
});

test("unavailable mock test is omitted", async ({ page }) => {
  await openDeckScreen(page, [makeDeck(0, { mockTestAvailable: false })]);
  await expect(page.getByTestId("kid-deck-card")).toBeVisible();
  await expect(page.getByTestId("kid-deck-card")).toContainText("Sprawdzian: 23 paź");
  await expect(page.getByTestId("kid-mock-start")).toHaveCount(0);
});

test("long deck titles and actions remain available at 200 percent text size", async ({ page }) => {
  const title = `Słownictwo ${"bardzo-długa-nazwa-".repeat(8)}`;
  await openDeckScreen(page, [makeDeck(0, { title, mockTestAvailable: false })]);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const card = page.getByTestId("kid-deck-card");
  await expect(card.getByTestId("kid-deck-title")).toHaveText(`${title} — 12 słów`);
  const start = card.getByRole("button", { name: "Ucz się" });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeVisible();
});

test("empty decks and a denied microphone still offer recovery", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("umiem.micDenied", "1"));
  await openDeckScreen(page, []);
  await expect(page.getByText("Nie masz jeszcze zestawów do nauki.")).toBeVisible();
  await expect(page.getByTestId("kid-mic-denied-hint")).toBeVisible();
  await page.getByTestId("kid-mic-toggle").check();
  await expect(page.getByTestId("kid-mic-denied-hint")).toHaveCount(0);
  await expect(page.getByTestId("kid-parent-link")).toBeVisible();
});
