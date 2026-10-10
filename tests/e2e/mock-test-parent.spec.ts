import { expect, test } from "@playwright/test";
import { seedMockTest } from "./mock-test-helpers";

test("parent configures count and sees partial pinned coverage", async ({ page }) => {
  const { childId, deckId, title } = await seedMockTest(3);
  await page.request.post("/api/v1/parent/setup", { data: { secret: "1234" } });
  expect((await page.request.post("/api/v1/parent/login", { data: { secret: "1234" } })).status()).toBe(200);
  const child = await (await page.request.post("/api/v1/parent/children", { data: { displayName: "Inny profil", avatarKey: "fox" } })).json();
  await page.request.put(`/api/v1/parent/assignments/${child.id}/${deckId}`, { data: { testDate: "2026-10-17", testGoals: ["listening"], mockTestTaskCount: 13 } });
  const session = await (await page.request.post("/api/v1/kid/sessions", { data: { childId, deckId, mode: "mock_test", microphoneEnabled: false } })).json();
  const task = await (await page.request.post(`/api/v1/kid/sessions/${session.sessionId}/next`)).json();
  await page.request.post(`/api/v1/kid/tasks/${task.taskId}/attempts`, { data: { modality: "text", text: "monday", clientAttemptId: crypto.randomUUID() } });
  await page.request.post(`/api/v1/kid/sessions/${session.sessionId}/end`);
  await page.goto("/parent");
  await page.locator('[data-testid^="deck-row-"]').filter({ hasText: title }).click();
  const row = page.locator('[data-testid^="assign-row-"]').filter({ has: page.locator(`[data-child-id="${childId}"]`) });
  await expect(row.getByTestId("mock-task-count")).toHaveValue("3");
  for (const invalid of ["0", "101", "1.5"]) {
    await row.getByTestId("mock-task-count").fill(invalid);
    await expect(row.locator('[data-testid^="assign-submit-"]')).toBeDisabled();
  }
  await row.getByTestId("mock-task-count").fill("25");
  await row.locator('[data-testid^="assign-submit-"]').click();
  await page.reload(); await page.locator('[data-testid^="deck-row-"]').filter({ hasText: title }).click();
  await expect(row.getByTestId("mock-task-count")).toHaveValue("25");
  const saved = await (await page.request.get(`/api/v1/parent/decks/${deckId}`)).json();
  expect(saved.assignments.find((a: { childId: string }) => a.childId === childId).mockTestTaskCount).toBe(25);
  expect(saved.assignments.find((a: { childId: string }) => a.childId === child.id)).toMatchObject({ mockTestTaskCount: 13, testDate: "2026-10-17", testGoals: ["listening"] });
  await page.getByTestId("tab-progress").click();
  await page.getByTestId("progress-child").selectOption(childId); await page.getByTestId("progress-deck").selectOption(deckId);
  await page.getByTestId("progress-load").click();
  await expect(page.getByTestId("mock-parent-report")).toBeVisible();
  await expect(page.getByTestId("mock-parent-report")).toContainText("3");
  await expect(page.getByTestId("mock-report-recall")).toContainText("1 z 15");
  await expect(page.getByTestId("mock-report-spelling")).toContainText("1 do ćwiczeń");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("mock-parent-report").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".superpowers/sdd/2026-10-10-test-readiness/parent-report-mobile.png" });
  const withoutAuth = await page.context().browser()!.newContext();
  expect((await withoutAuth.request.get(new URL(`/api/v1/parent/mock-tests/${session.sessionId}`, page.url()).href)).status()).toBe(401);
  await withoutAuth.close();
});
