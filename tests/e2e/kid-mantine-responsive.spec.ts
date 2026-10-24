import { expect, test } from "@playwright/test";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

function recallLayoutFixture(): KidUiFixture {
  const childId = "10000000-0000-4000-8000-000000000101";
  const deckId = "10000000-0000-4000-8000-000000000102";
  const sessionId = "10000000-0000-4000-8000-000000000103";
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "cat", recordingMode: "hold", canRead: true }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000104",
      policyId: "default", microphoneEnabled: false, canRead: true, state: "active", taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-24T10:00:00.000Z", resumed: false },
    tasks: [{ taskId: "10000000-0000-4000-8000-000000000105", sessionId, ordinal: 0, exerciseType: "recall",
      direction: "source_to_target", state: "issued", prompt: { kind: "recall", prompt: "kot" }, remainingAssessed: 1 }],
  };
}

test("Mantine picture choices keep their geometry until the server verdict", async ({ page }) => {
  const fixture = pictureChoiceLayoutFixture();
  const attempt = fixture.attempts![0]!;
  let releaseAttempt!: () => void;
  const pendingAttempt = new Promise<void>((resolve) => { releaseAttempt = resolve; });
  let postCount = 0;

  await installKidUiFixture(page, fixture);
  await page.route("**/api/v1/kid/tasks/*/attempts", async (route) => {
    postCount += 1;
    await pendingAttempt;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(attempt) });
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");

  await expect(page.locator(".kid-theme")).toBeVisible();
  await expect(page.locator("[data-kid-screen='true']")).toBeVisible();
  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  const geometry = async () => page.evaluate(() => {
    const rect = (selector: string) => {
      const { x, y, width, height } = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      options: [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((item) => {
        const { x, y, width, height } = item.getBoundingClientRect();
        return { x, y, width, height };
      }),
      instruction: rect("[data-testid='kid-instruction']"),
      content: rect(".kid-material-content"),
      primary: rect("[data-testid='kid-primary-slot']"),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  const before = await geometry();
  expect(before.overflow).toBe(false);
  expect(before.options[2]!.x).toBe(before.options[0]!.x);
  expect(before.options[2]!.y).toBeGreaterThan(before.options[0]!.y);

  await options.first().click();
  await expect.poll(() => postCount).toBe(1);
  await expect(options.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("kid-outcome-correct")).toHaveCount(0);
  const pending = await geometry();
  for (const key of ["instruction", "content", "primary"] as const) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(pending[key][dimension] - before[key][dimension]), `${key}.${dimension} moved before feedback`).toBeLessThanOrEqual(1);
    }
  }
  releaseAttempt();
  await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
  const after = await geometry();
  for (const key of ["instruction", "content", "primary"] as const) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after[key][dimension] - before[key][dimension]), `${key}.${dimension} moved after feedback`).toBeLessThanOrEqual(1);
    }
  }
  for (let index = 0; index < before.options.length; index += 1) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after.options[index]![dimension] - before.options[index]![dimension]), `option ${index}.${dimension} moved`).toBeLessThanOrEqual(1);
    }
  }
});

test("Mantine recall keeps the exact draft and focus through viewport changes", async ({ page }) => {
  await installKidUiFixture(page, recallLayoutFixture());
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();

  const input = page.getByTestId("kid-input");
  await input.fill("ca");
  await input.focus();
  await page.setViewportSize({ width: 360, height: 360 });
  await expect(input).toHaveValue("ca");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 360, height: 760 });
  await expect(input).toHaveValue("ca");
  await expect(input).toBeFocused();

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("kid-session-frame")).toHaveAttribute("data-zoomed", "true");
  await expect(input).toHaveValue("ca");
  await page.getByTestId("kid-submit").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-submit")).toBeInViewport();
  await expect(page.getByTestId("kid-skip")).toBeAttached();
});
