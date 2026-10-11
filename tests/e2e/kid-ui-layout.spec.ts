import { expect, test } from "@playwright/test";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";

function recallFixture() {
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" as const }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training" as const, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
      policyId: "default", microphoneEnabled: false, state: "active" as const, taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
  };
}

async function openRecall(page: Parameters<typeof installKidUiFixture>[0]) {
  await installKidUiFixture(page, recallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

test("session frame remains inside visible viewport after resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openRecall(page);
  await assertKidLayout(page);

  await page.setViewportSize({ width: 390, height: 520 });
  await expect(page.getByTestId("kid-input")).toHaveValue("");
  await assertKidLayout(page, { allowDetailsScroll: true });
});

test("pinch zoom fallback preserves input and reachable actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openRecall(page);
  const input = page.getByTestId("kid-input");
  await input.fill("kot");
  await expect(input).toBeFocused();

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("kid-session-frame")).toHaveAttribute("data-zoomed", "true");
  await expect(input).toHaveValue("kot");
  expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);
  await page.getByTestId("kid-submit").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-submit")).toBeVisible();
});
