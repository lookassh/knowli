import { expect, test, type Page } from "@playwright/test";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { measure, resizeAndSettle } from "./helpers/kid-layout";

function recallFixture(): KidUiFixture {
  const childId = "10000000-0000-4000-8000-000000000301";
  const deckId = "10000000-0000-4000-8000-000000000302";
  const sessionId = "10000000-0000-4000-8000-000000000303";
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "cat", recordingMode: "hold", canRead: true }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000304",
      policyId: "default", microphoneEnabled: false, canRead: true, state: "active", taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-24T10:00:00.000Z", resumed: false },
    tasks: [{ taskId: "10000000-0000-4000-8000-000000000305", sessionId, ordinal: 0, exerciseType: "recall",
      direction: "source_to_target", state: "issued", prompt: { kind: "recall", prompt: "kot" }, remainingAssessed: 1 }],
    summary: {
      sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
      endedAt: "2026-10-24T10:01:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
    },
  };
}

async function openSession(page: Page, fixture: KidUiFixture): Promise<{ endRequests: () => number }> {
  let ends = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/sessions/${fixture.session.sessionId}/end`)) ends += 1;
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  return { endRequests: () => ends };
}

test("✕ asks before ending; continuing keeps the task and returns focus to ✕", async ({ page }) => {
  const fixture = recallFixture();
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  const session = await openSession(page, fixture);

  await page.getByTestId("kid-input").fill("ca");
  await page.getByTestId("kid-end").click();
  const sheet = page.getByRole("alertdialog", { name: "Kończymy na dziś?" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Twoje odpowiedzi są już zapisane.");
  await expect(page.getByTestId("kid-end-continue")).toBeFocused();
  await expect(page.getByTestId("kid-end")).toHaveAttribute("aria-expanded", "true");

  // Keys stay in the sheet: nothing is typed into the answer underneath.
  await page.keyboard.press("t");
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("kid-end-confirm-end")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("kid-end-continue")).toBeFocused();
  await expect(page.getByTestId("kid-input")).toHaveValue("ca");

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("kid-end")).toBeFocused();
  await expect(page.getByTestId("kid-input")).toHaveValue("ca");

  await page.getByTestId("kid-end").click();
  await page.getByTestId("kid-end-continue").click();
  await expect(sheet).toHaveCount(0);

  await page.getByTestId("kid-end").click();
  await page.getByTestId("kid-end-confirm-scrim").click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  expect(session.endRequests()).toBe(0);

  await page.getByTestId("kid-end").click();
  await page.getByTestId("kid-end-confirm-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  expect(session.endRequests()).toBe(1);
});

test("a failed end request closes the sheet and shows its retry", async ({ page }) => {
  const fixture = recallFixture();
  fixture.dropFirstEndResponse = true;
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  const session = await openSession(page, fixture);

  await page.getByTestId("kid-end").click();
  await page.getByTestId("kid-end-confirm-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toHaveCount(0);
  const retry = page.getByTestId("kid-retry");
  await expect(retry).toBeVisible();
  await expect(retry).toBeInViewport();
  await retry.click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  expect(session.endRequests()).toBe(2);
});

test("mock test confirmation says unanswered tasks stay unchecked", async ({ page }) => {
  const fixture = recallFixture();
  fixture.decks[0]!.mockTestAvailable = true;
  fixture.session = { ...fixture.session, mode: "mock_test" };
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await page.getByTestId("kid-mock-confirm").click();
  await page.getByTestId("kid-end").click();
  const sheet = page.getByRole("alertdialog", { name: "Kończymy na dziś?" });
  await expect(sheet).toContainText("Niezrobione zadania zostaną niesprawdzone.");
  await expect(sheet).not.toContainText("zapisane");
});

test("confirmation sheet sits on the bottom edge with reachable 48 px actions on every window class", async ({ page }) => {
  const fixture = recallFixture();
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  await openSession(page, fixture);
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 740, height: 360 },
    { width: 568, height: 320 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      scrim: "[data-testid='kid-end-confirm-scrim']",
      sheet: "[data-testid='kid-end-confirm']",
      continueButton: "[data-testid='kid-end-continue']",
      end: "[data-testid='kid-end-confirm-end']",
    });
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.scrim, `scrim covers the viewport: ${name}`).toMatchObject({ left: 0, top: 0, width: viewport.width, height: viewport.height });
    expect(layout.sheet.left, `sheet left: ${name}`).toBeGreaterThanOrEqual(0);
    expect(layout.sheet.right, `sheet right: ${name}`).toBeLessThanOrEqual(viewport.width);
    expect(layout.sheet.width, `sheet width: ${name}`).toBeLessThanOrEqual(560);
    expect(Math.abs((layout.sheet.left + layout.sheet.right) / 2 - viewport.width / 2), `sheet centred: ${name}`).toBeLessThanOrEqual(1);
    for (const [label, rect] of [["continue", layout.continueButton], ["end", layout.end]] as const) {
      expect(rect.height, `${label} height: ${name}`).toBeGreaterThanOrEqual(54);
      expect(rect.width, `${label} width: ${name}`).toBeGreaterThanOrEqual(48);
      expect(rect.left, `${label} inside sheet: ${name}`).toBeGreaterThanOrEqual(layout.sheet.left);
      expect(rect.right, `${label} inside sheet: ${name}`).toBeLessThanOrEqual(layout.sheet.right);
    }
    if (layout.sheet.height <= viewport.height - 16) {
      expect(Math.abs(layout.sheet.bottom - viewport.height), `sheet on the bottom edge: ${name}`).toBeLessThanOrEqual(1);
    }
    // Phones in portrait stack the actions; wider windows put them side by side.
    if (viewport.width < 480) expect(layout.end.top, `stacked actions: ${name}`).toBeGreaterThanOrEqual(layout.continueButton.bottom);
    else expect(Math.abs(layout.end.top - layout.continueButton.top), `actions in one row: ${name}`).toBeLessThanOrEqual(1);
    for (const testId of ["kid-end-continue", "kid-end-confirm-end"]) {
      const action = page.getByTestId(testId);
      await action.scrollIntoViewIfNeeded();
      await expect(action, `${testId} reachable: ${name}`).toBeInViewport();
    }
  }
});

test("confirmation sheet slides in with transform and opacity only", async ({ page }) => {
  const fixture = recallFixture();
  await installKidUiFixture(page, fixture, { reducedMotion: false });
  await page.setViewportSize({ width: 360, height: 640 });
  await openSession(page, fixture);
  await page.getByTestId("kid-end").click();
  const sheet = page.getByTestId("kid-end-confirm");
  const restingHeight = await sheet.evaluate((element) => element.getBoundingClientRect().height);
  await expect.poll(() => sheet.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform };
  })).toEqual({ opacity: "1", transform: "none" });
  // Sub-pixel rounding of the moving translateY aside, the height never animates.
  expect(await sheet.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(restingHeight, 1);
});
