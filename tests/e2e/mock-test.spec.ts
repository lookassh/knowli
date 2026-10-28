import { expect, test } from "@playwright/test";
import { seedMockTest } from "./mock-test-helpers";

test("written mock test keeps its three slots after errors, reload and transport retry", async ({ page }) => {
  const { childId, deckId } = await seedMockTest(3);
  await page.goto(`/kids/${childId}/learn`);
  await page.getByTestId("kid-mock-start").first().click();
  await expect(page.getByTestId("kid-mock-budget")).toContainText("3");
  await page.getByTestId("kid-mock-confirm").click();
  await expect(page.getByTestId("kid-record")).toHaveCount(0);
  await expect(page.getByTestId("kid-not-remember")).toHaveText("Nie pamiętam");
  const first = await page.locator("[data-task-id]").getAttribute("data-task-id");
  const early = await page.request.get(`/api/v1/kid/sessions/${(await (await page.request.post("/api/v1/kid/sessions", { data: { childId, deckId, mode: "mock_test", microphoneEnabled: false, supportsPictureVocabulary: true } })).json()).sessionId}/mock-test-summary`);
  expect(early.status()).toBe(409);
  let interrupted = false;
  await page.route("**/api/v1/kid/tasks/*/attempts", async route => {
    if (!interrupted) { interrupted = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByTestId("kid-input").fill("wrong");
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-offline")).toBeVisible();
  await page.getByTestId("kid-retry").click();
  await expect(page.locator("[data-task-id]")).not.toHaveAttribute("data-task-id", first!);
  await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
  const second = await page.locator("[data-task-id]").getAttribute("data-task-id");
  await page.reload();
  await expect(page.locator("[data-task-id]")).toHaveAttribute("data-task-id", second!);
  await page.getByTestId("kid-not-remember").click();
  await page.getByTestId("kid-not-remember").click();
  await expect(page.getByTestId("kid-mock-summary")).toBeVisible();
  await expect(page.getByTestId("kid-mock-solution")).toHaveCount(3);
  await expect(page.getByTestId("kid-mock-score")).toContainText("0/3 · 0%");
  await expect(page.getByTestId("kid-mock-score")).toContainText("☆☆☆☆☆☆");
  await expect(page.getByTestId("kid-mock-score")).toHaveAttribute("data-tone", "low");
  await expect(page.locator('[data-testid="kid-mock-solution"][data-status="incorrect"]')).toHaveCount(3);
  await expect(page.locator('[data-testid="kid-mock-solution"][data-status="notAssessed"]')).toHaveCount(0);
});

test("fully correct attempt shows green rows, six stars and replays audio from review", async ({ page }) => {
  const words = [
    { source: "pies", target: "dog" },
    { source: "kot", target: "cat" },
    { source: "słońce", target: "sun" },
  ];
  const { childId } = await seedMockTest(3, true, false, words);
  await page.goto(`/kids/${childId}/learn`);
  await page.getByTestId("kid-mock-start").first().click();
  await page.getByTestId("kid-mock-confirm").click();
  const answers: Record<string, string> = Object.fromEntries(words.map(w => [w.source, w.target]));
  let previous: string | null = null;
  for (let i = 0; i < 3; i++) {
    const sourceLocator = page.getByTestId("kid-source");
    await expect(sourceLocator).toBeVisible();
    if (previous !== null) await expect.poll(async () => ((await sourceLocator.textContent()) ?? "").trim()).not.toBe(previous);
    const source = ((await sourceLocator.textContent()) ?? "").trim();
    previous = source;
    await page.getByTestId("kid-input").fill(answers[source]!);
    await page.getByTestId("kid-submit").click();
    await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
    await expect(page.getByTestId("kid-mock-solution")).toHaveCount(0);
  }
  await expect(page.getByTestId("kid-mock-summary")).toBeVisible();
  await expect(page.getByTestId("kid-mock-score")).toContainText("3/3 · 100%");
  await expect(page.getByTestId("kid-mock-score")).toContainText("★★★★★★");
  await expect(page.getByTestId("kid-mock-score")).toHaveAttribute("data-tone", "good");
  await expect(page.locator('[data-testid="kid-mock-solution"][data-status="correct"]')).toHaveCount(3);
  // odsłuch w omówieniu jest wpięty w przepływ (re-read omówienia z zapisem ekspozycji);
  // samego odtworzenia nie da się asertować w e2e — media mają fake'owe bajty
  const replay = page.waitForResponse(/mock-test-summary/);
  await page.locator(".kid-mock-row__audio").first().click();
  await replay;
});

test("configured portion can exceed ten and ends after its thirteenth answer", async ({ page }) => {
  const { childId } = await seedMockTest(13);
  await page.goto(`/kids/${childId}/learn`);
  await page.getByTestId("kid-mock-start").first().click();
  await expect(page.getByTestId("kid-mock-budget")).toContainText("13");
  await page.getByTestId("kid-mock-confirm").click();
  for (let i = 0; i < 13; i++) {
    await expect(page.getByTestId("kid-input")).toBeVisible();
    await page.getByTestId("kid-not-remember").click();
  }
  await expect(page.getByTestId("kid-mock-summary")).toBeVisible();
  await expect(page.getByTestId("kid-mock-solution")).toHaveCount(13);
  await expect(page.getByTestId("kid-mock-score")).toContainText("0/13 · 0%");
});

test("two browsers resume the same test and stale answers refresh without extra slots", async ({ page, context }) => {
  const { childId } = await seedMockTest(3);
  await page.goto(`/kids/${childId}/learn`); await page.getByTestId("kid-mock-start").first().click(); await page.getByTestId("kid-mock-confirm").click();
  const first = await page.locator("[data-task-id]").getAttribute("data-task-id");
  const other = await context.newPage(); await other.goto(`/kids/${childId}/learn`);
  await expect(other.locator("[data-task-id]")).toHaveAttribute("data-task-id", first!);
  await page.getByTestId("kid-not-remember").click();
  await expect(page.locator("[data-task-id]")).not.toHaveAttribute("data-task-id", first!);
  await other.getByTestId("kid-not-remember").click();
  await expect(other.getByTestId("kid-error")).toBeVisible(); await other.getByTestId("kid-retry").click();
  await expect(other.locator("[data-task-id]")).toHaveAttribute("data-task-id", (await page.locator("[data-task-id]").getAttribute("data-task-id"))!);
  await other.getByTestId("kid-end").click(); await expect(other.getByTestId("kid-mock-summary")).toBeVisible();
  await other.close();
});

test("unknown material explains unavailable mock test and allows returning to learning", async ({ page }) => {
  const { childId } = await seedMockTest(3, false);
  await page.goto(`/kids/${childId}/learn`); await page.getByTestId("kid-mock-start").first().click();
  await expect(page.getByTestId("kid-init-error")).toContainText("Kartkówka nie jest jeszcze gotowa");
  await page.getByTestId("kid-back-decks").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-target")).toBeVisible();
});
