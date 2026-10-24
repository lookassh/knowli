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

test("deck flow stays within the viewport matrix and keeps all decks reachable", async ({ page }, testInfo) => {
  const fixture = recallLayoutFixture();
  fixture.decks = Array.from({ length: 8 }, (_, index) => ({
    ...fixture.decks[0]!,
    deckId: `10000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
    title: index === 7 ? `Długi tytuł ${"zestawów i słówek ".repeat(6)}` : `Zestaw ${index + 1}`,
    recommended: index < 3,
  }));
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();

  for (const viewport of [
    { width: 360, height: 320 },
    { width: 360, height: 420 },
    { width: 360, height: 640 },
    { width: 360, height: 760 },
    { width: 768, height: 1024 },
    { width: 1440, height: 960 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("kid-deck-screen")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
    const finalDeck = page.getByTestId("kid-deck-card").last();
    await finalDeck.scrollIntoViewIfNeeded();
    await expect(finalDeck).toBeVisible();
    await expect(finalDeck.getByTestId("kid-deck-title")).toContainText("Długi tytuł");
    if (viewport.width === 360 && viewport.height === 640 || viewport.width === 1440) {
      await page.screenshot({ path: testInfo.outputPath(`decks-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => {
    const indicator = document.createElement("span");
    indicator.className = "kid-recording";
    document.body.append(indicator);
    const style = getComputedStyle(indicator);
    const result = { matches: matchMedia("(prefers-reduced-motion: reduce)").matches, animationName: style.animationName };
    indicator.remove();
    return result;
  });
  expect(reducedMotion).toEqual({ matches: true, animationName: "none" });
});

test("summary actions remain reachable without horizontal overflow on short phones and larger screens", async ({ page }, testInfo) => {
  const fixture = recallLayoutFixture();
  fixture.summary = {
    sessionId: fixture.session.sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1,
    endedAt: "2026-10-24T10:01:00.000Z", independentSuccesses: { recall: 1, spelling: 0 }, practiceItems: [],
  };
  await installKidUiFixture(page, fixture);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();

  for (const viewport of [
    { width: 360, height: 320 },
    { width: 360, height: 420 },
    { width: 360, height: 640 },
    { width: 360, height: 760 },
    { width: 768, height: 1024 },
    { width: 1440, height: 960 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`).toBe(false);
    const again = page.getByTestId("kid-again");
    await again.scrollIntoViewIfNeeded();
    await expect(again).toBeInViewport();
    await expect(again).toBeEnabled();
    if (viewport.width === 360 && viewport.height === 640 || viewport.width === 1440) {
      await page.screenshot({ path: testInfo.outputPath(`summary-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
  }
});

const materialViewports = [
  { name: "compact portrait", width: 360, height: 640 },
  { name: "compact landscape", width: 640, height: 360 },
  { name: "compact-height landscape band", width: 760, height: 450 },
  { name: "expanded width compact height", width: 840, height: 480 },
  { name: "expanded landscape", width: 1024, height: 600 },
  { name: "large desktop", width: 1920, height: 1080 },
] as const;

async function expectInteractiveTargets(page: import("@playwright/test").Page, selectors: string[]) {
  const targets = await page.evaluate((wanted) => wanted.flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
      const rect = element.getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    }),
  ), selectors);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, `${target.selector} touch height`).toBeGreaterThanOrEqual(48);
    expect(target.width, `${target.selector} touch width`).toBeGreaterThanOrEqual(48);
  }
}

test("Material window classes keep written answers reachable with 48px targets", async ({ page }) => {
  await installKidUiFixture(page, recallLayoutFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await page.getByTestId("kid-input").fill("cat");

  for (const viewport of materialViewports) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth
      || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow, `horizontal overflow: ${viewport.name}`).toBe(false);
    await expectInteractiveTargets(page, [
      "[data-testid='kid-input']",
      "[data-testid='kid-submit']",
      "[data-testid='kid-not-remember']",
      "[data-testid='kid-skip']",
      "[data-testid='kid-end']",
    ]);
    for (const testId of ["kid-input", "kid-submit", "kid-not-remember", "kid-skip", "kid-end"]) {
      const control = page.getByTestId(testId);
      await control.scrollIntoViewIfNeeded();
      await expect(control, `${testId}: ${viewport.name}`).toBeInViewport();
    }
    await expect(page.getByTestId("kid-input")).toHaveValue("cat");
    const progressClipped = await page.getByTestId("kid-remaining").evaluate((element) =>
      element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    expect(progressClipped, `progress label clipped: ${viewport.name}`).toBe(false);
  }
});

test("Material window classes keep every picture choice reachable", async ({ page }) => {
  await installKidUiFixture(page, pictureChoiceLayoutFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");

  for (const viewport of materialViewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth
      || document.body.scrollWidth > document.body.clientWidth);
    expect(overflow, `horizontal overflow: ${viewport.name}`).toBe(false);
    await expectInteractiveTargets(page, ["[data-testid='kid-option']", "[data-testid='kid-end']", "[data-testid='kid-play']"]);
    await expect.poll(async () => page.evaluate(() => {
      const contentElement = document.querySelector<HTMLElement>(".kid-material-content")!;
      const content = contentElement.getBoundingClientRect();
      const clipped = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight
          || rect.left < content.left - 1 || rect.top < content.top - 1
          || rect.right > content.right + 1 || rect.bottom > content.bottom + 1;
      });
      if (!clipped) return "ok";
      const rect = clipped.getBoundingClientRect();
      return JSON.stringify({ inner: [window.innerWidth, window.innerHeight], content: [content.x, content.y, content.width, content.height], option: [rect.x, rect.y, rect.width, rect.height] });
    }), { message: `picture option clipped: ${viewport.name}` }).toBe("ok");
  }
});
