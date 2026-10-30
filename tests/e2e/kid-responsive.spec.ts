import { expect, test, type Page } from "@playwright/test";
import { endSessionFromHeader } from "./helpers/kid-session";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { expectBandSpansRoot, expectInsideRoot, measure, resizeAndSettle, type Rect } from "./helpers/kid-layout";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

const SESSION_HEADER_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 320, height: 640 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

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

/** ✕, pebble row and microphone status share one row; vertical centres line up. */
async function expectSessionHeaderRow(page: Page, expectedPebbles: number, pillShown: boolean) {
  for (const viewport of SESSION_HEADER_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      root: ".kid-learning",
      header: ".kid-header",
      end: "[data-testid='kid-end']",
      pebbles: "[data-testid='kid-progress-pebbles']",
      mic: "[data-testid='kid-microphone-status']",
    });
    const centreY = (rect: { top: number; height: number }) => rect.top + rect.height / 2;
    expect(Math.abs(centreY(layout.end) - centreY(layout.pebbles)), `close vs pebbles centre: ${name}`).toBeLessThanOrEqual(4);
    expect(Math.abs(centreY(layout.mic) - centreY(layout.pebbles)), `microphone vs pebbles centre: ${name}`).toBeLessThanOrEqual(4);
    for (const [label, rect] of Object.entries({ end: layout.end, pebbles: layout.pebbles, mic: layout.mic })) {
      expectInsideRoot(rect, layout.root, `${label}: ${name}`);
      expect(rect.left, `${label} left in viewport: ${name}`).toBeGreaterThanOrEqual(0);
      expect(rect.right, `${label} right in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    }
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.end.width, `close width: ${name}`).toBeGreaterThanOrEqual(48);
    expect(layout.end.height, `close height: ${name}`).toBeGreaterThanOrEqual(48);
    const pebbles = await page.getByTestId("kid-progress-pebble").evaluateAll((elements) => elements.map((element) => {
      const { left, right, width } = element.getBoundingClientRect();
      return { left, right, width };
    }));
    expect(pebbles, `pebble count: ${name}`).toHaveLength(expectedPebbles);
    for (const [index, pebble] of pebbles.entries()) {
      expect(pebble.width, `pebble ${index} width: ${name}`).toBeGreaterThanOrEqual(5);
      // The current pebble is scaled 1.25x, so it may poke out of the row by up to 2px.
      expect(pebble.left, `pebble ${index} inside row: ${name}`).toBeGreaterThanOrEqual(layout.pebbles.left - 2);
      expect(pebble.right, `pebble ${index} inside row: ${name}`).toBeLessThanOrEqual(layout.pebbles.right + 2);
    }
    if (pillShown) {
      const pill = await measure(page, { pill: "[data-testid='kid-remaining']" });
      expectInsideRoot(pill.pill, layout.root, `pill: ${name}`);
      expect(pill.pill.right, `pill right in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
      expect(pill.pill.bottom, `pill inside header: ${name}`).toBeLessThanOrEqual(layout.header.bottom + 1);
      if (viewport.height < 480) {
        // Very short: the pill sits beside the pebbles, not under them.
        expect(Math.abs(centreY(pill.pill) - centreY(layout.pebbles)), `pill beside pebbles: ${name}`).toBeLessThanOrEqual(4);
        expect(pill.pill.left, `pill after pebbles: ${name}`).toBeGreaterThanOrEqual(layout.pebbles.left);
      } else {
        expect(pill.pill.top, `pill under pebbles: ${name}`).toBeGreaterThanOrEqual(layout.pebbles.bottom - 1);
      }
    }
  }
}

function openHeaderFixture(remainingAssessed: number): KidUiFixture {
  const fixture = recallLayoutFixture();
  fixture.tasks = [{ ...fixture.tasks[0]!, remainingAssessed }];
  return fixture;
}

test("session header keeps close, pebbles and microphone in one row", async ({ page }) => {
  await installKidUiFixture(page, openHeaderFixture(20));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await expect(page.getByTestId("kid-remaining")).toHaveCount(0);
  await expectSessionHeaderRow(page, 20, false);
});

test("session header keeps the same height with and without the Jeszcze pill", async ({ page, context }) => {
  const heights = async (target: Page, remainingAssessed: number) => {
    await installKidUiFixture(target, openHeaderFixture(remainingAssessed));
    await target.goto("/");
    await target.getByTestId("kid-profile").click();
    await target.getByTestId("kid-deck").click();
    await expect(target.getByTestId("kid-input")).toBeVisible();
    await expect(target.getByTestId("kid-remaining")).toHaveCount(remainingAssessed <= 3 ? 1 : 0);
    const result: number[] = [];
    for (const viewport of [{ width: 360, height: 800 }, { width: 360, height: 500 }]) {
      await resizeAndSettle(target, viewport);
      result.push((await measure(target, { header: ".kid-header" })).header.height);
    }
    return result;
  };
  const without = await heights(page, 20);
  const withPill = await heights(await context.newPage(), 3);
  for (const [index, name] of ["360x800", "360x500"].entries()) {
    expect(Math.abs(withPill[index]! - without[index]!), `header height with vs without pill: ${name}`).toBeLessThanOrEqual(1);
  }
});

test("session header keeps the Jeszcze pill beside or under the pebbles", async ({ page }) => {
  await installKidUiFixture(page, openHeaderFixture(3));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-remaining")).toBeVisible();
  await expectSessionHeaderRow(page, 3, true);
});

test("exposure keeps the complete word card above its action without scrolling on phones", async ({ page }, testInfo) => {
  const fixture = recallLayoutFixture();
  const assetId = "10000000-0000-4000-8000-000000000106";
  fixture.uiAudio = { ready: true, assets: {} };
  fixture.tasks = [{ ...fixture.tasks[0]!, exerciseType: "exposure", direction: null, prompt: {
    kind: "exposure", target: "computer room", source: "pracownia komputerowa",
    example: "The computer room has many computers to use.",
    audioAssetId: assetId, exampleAudioAssetId: assetId, imageAssetId: assetId, visualType: "image",
  } }];
  await installKidUiFixture(page, fixture);
  await page.route(`**/api/v1/media/${assetId}`, async (route) => {
    if (route.request().resourceType() !== "image") return route.fallback();
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#96a8ef"/></svg>' });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 384, height: 640 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-target")).toHaveText("computer room");
  await expect(page.getByTestId("kid-task-audio-error")).toHaveCount(0);

  for (const viewport of [{ width: 384, height: 640 }, { width: 360, height: 640 }, { width: 360, height: 540 },
    { width: 390, height: 660 }, { width: 768, height: 1024 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
    const header = await page.locator(".kid-header").boundingBox();
    const instruction = await page.getByTestId("kid-instruction").boundingBox();
    expect(instruction!.y - (header!.y + header!.height), "instruction should stay close to the top bar")
      .toBeLessThanOrEqual(viewport.height <= 700 ? 44 : 60);
    await expect.poll(() => page.evaluate(() => {
      const selectors = [".kid-learning", ".kid-exercise-frame", ".kid-material", ".kid-material-content", ".kid-exposure-content"];
      return selectors.filter((selector) => {
        const element = document.querySelector<HTMLElement>(selector)!;
        return element.scrollHeight > element.clientHeight + 1;
      });
    }), { timeout: 1500, message: `card requires scrolling at ${viewport.width}x${viewport.height}` }).toEqual([]);
    const material = await page.getByTestId("kid-material").boundingBox();
    const action = await page.getByTestId("kid-done").boundingBox();
    expect(material!.y + material!.height).toBeLessThanOrEqual(action!.y + 1);
    expect(action!.y + action!.height).toBeLessThanOrEqual(viewport.height);
    expect(action!.height).toBeGreaterThanOrEqual(54);
    for (const testId of ["kid-illustration", "kid-target", "kid-source", "kid-example", "kid-play", "kid-play-example"]) {
      const bounds = await page.getByTestId(testId).boundingBox();
      expect(bounds!.y, testId).toBeGreaterThanOrEqual(material!.y - 1);
      expect(bounds!.y + bounds!.height, testId).toBeLessThanOrEqual(material!.y + material!.height + 1);
      expect(bounds!.x, testId).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width, testId).toBeLessThanOrEqual(viewport.width);
      if (testId.startsWith("kid-play")) expect(bounds!.height).toBeGreaterThanOrEqual(48);
    }
    // The target word is the stimulus: at least display-sm and larger than its translation.
    const [targetSize, sourceSize] = await Promise.all(["kid-target", "kid-source"].map((testId) =>
      page.getByTestId(testId).evaluate((element) => parseFloat(getComputedStyle(element).fontSize))));
    expect(targetSize, `target word size at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(28);
    expect(targetSize).toBeGreaterThan(sourceSize!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`exposure-${viewport.width}x${viewport.height}.png`) });
  }

  // Accessibility and unusually short windows retain the complete card through scrolling.
  for (const viewport of [{ width: 640, height: 360 }, { width: 760, height: 450 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    for (const testId of ["kid-illustration", "kid-target", "kid-source", "kid-example", "kid-play-example", "kid-done"]) {
      const element = page.getByTestId(testId);
      await element.scrollIntoViewIfNeeded();
      // Native scrolling rounds fractional CSS pixels; allow at most one pixel.
      await expect(element).toBeInViewport({ ratio: 0.98 });
      const bounds = await element.boundingBox();
      expect(bounds!.y, `${testId} at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height, testId).toBeLessThanOrEqual(viewport.height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});

test("picture choices keep their geometry until the server verdict", async ({ page }) => {
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

  await expect(page.getByTestId("kid-instruction").getByTestId("kid-play")).toHaveCount(1);
  await expect(page.getByTestId("kid-material").getByTestId("kid-play")).toHaveCount(0);
  for (const option of await page.getByTestId("kid-option").all()) {
    await expect(option).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  }

  await expect(page.locator(".kid-theme")).toBeVisible();
  await expect(page.getByTestId("kid-session-frame")).toBeVisible();
  await expect(page.getByTestId("kid-exercise")).toBeVisible();
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
      footer: rect("[data-testid='kid-exercise-actions']"),
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
  for (const key of ["instruction", "content", "footer"] as const) {
    for (const dimension of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(pending[key][dimension] - before[key][dimension]), `${key}.${dimension} moved before feedback`).toBeLessThanOrEqual(1);
    }
  }
  expect(pending.options).toEqual(before.options);
  releaseAttempt();
  await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
  const after = await geometry();
  expect(after.instruction).toEqual(before.instruction);
  expect(after.overflow).toBe(false);
  expect(after.footer.height).toBeGreaterThan(before.footer.height);
  expect(after.content.y + after.content.height).toBeLessThanOrEqual(after.footer.y + 1);
  for (const option of await options.all()) {
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeInViewport({ ratio: 0.98 });
  }
  await expect(page.getByTestId("kid-next")).toBeInViewport();
});

test("recall keeps the exact draft and focus through viewport changes", async ({ page }) => {
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
  await expect(page.getByTestId("kid-skip")).toHaveCount(0);
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
  await endSessionFromHeader(page);
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
      "[data-testid='kid-end']",
    ]);
    for (const testId of ["kid-input", "kid-submit", "kid-not-remember", "kid-end"]) {
      const control = page.getByTestId(testId);
      await control.scrollIntoViewIfNeeded();
      await expect(control, `${testId}: ${viewport.name}`).toBeInViewport();
    }
    const submitBox = await page.getByTestId("kid-submit").boundingBox();
    const rememberBox = await page.getByTestId("kid-not-remember").boundingBox();
    expect(submitBox).not.toBeNull();
    expect(rememberBox).not.toBeNull();
    expect(Math.abs(submitBox!.y - rememberBox!.y)).toBeLessThanOrEqual(2);
    expect(submitBox!.width).toBeGreaterThan(rememberBox!.width);
    expect(submitBox!.height).toBeGreaterThanOrEqual(54);
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
    if (viewport.height < 480) {
      for (const option of await page.getByTestId("kid-option").all()) {
        await option.scrollIntoViewIfNeeded();
        await expect(option).toBeInViewport({ ratio: 0.98 });
      }
      continue;
    }
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

test("profile tiles fit portrait, landscape, tablet and desktop", async ({ page }, testInfo) => {
  const fixture = recallLayoutFixture();
  fixture.profiles = [
    { childId: "10000000-0000-4000-8000-000000000201", displayName: "Ola", avatarKey: "cat", recordingMode: "hold", canRead: true, rewardPoints: 12 },
    { childId: "10000000-0000-4000-8000-000000000202", displayName: "Maksymilian-Aleksander Bardzo-Długie-Imię", avatarKey: "owl", recordingMode: "hold", canRead: false, rewardPoints: 3 },
    { childId: "10000000-0000-4000-8000-000000000203", displayName: "Jaś", avatarKey: "fox", recordingMode: "hold", canRead: true, rewardPoints: 0 },
  ];
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await expect(page.getByTestId("kid-profile")).toHaveCount(3);

  const cases = [
    { width: 360, height: 800, columns: 2 },
    { width: 844, height: 390, columns: null },
    { width: 820, height: 1180, columns: 3 },
    { width: 1440, height: 900, columns: 3 },
  ];
  for (const viewport of cases) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, { width: viewport.width, height: viewport.height });
    const frame = await measure(page, { root: "[data-kid-screen]", band: "[data-kid-header='band']" });
    const tiles = await page.getByTestId("kid-profile").evaluateAll((elements) => elements.map((tile) => {
      const { left, top, right, bottom, width, height } = tile.getBoundingClientRect();
      return { left, top, right, bottom, width, height, overflowX: tile.scrollWidth > tile.clientWidth + 1 };
    }));
    const layout = { ...frame, tiles };
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectBandSpansRoot(layout, name);
    // Wysokość nie jest ograniczona: niski viewport przewija listę, ale poziomo nic nie ucieka.
    for (const [index, tile] of layout.tiles.entries()) {
      expect(tile.height, `tile ${index} height: ${name}`).toBeGreaterThanOrEqual(48);
      expect(tile.left, `tile ${index} left: ${name}`).toBeGreaterThanOrEqual(0);
      expect(tile.right, `tile ${index} right: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
      expect(tile.left, `tile ${index} inside root: ${name}`).toBeGreaterThanOrEqual(layout.root.left - 1);
      expect(tile.right, `tile ${index} inside root: ${name}`).toBeLessThanOrEqual(layout.root.right + 1);
      expect(tile.overflowX, `tile ${index} content overflow: ${name}`).toBe(false);
      if (viewport.height >= 480) {
        expect(tile.top, `tile ${index} top: ${name}`).toBeGreaterThanOrEqual(0);
        expect(tile.bottom, `tile ${index} bottom: ${name}`).toBeLessThanOrEqual(viewport.height);
      }
    }
    if (viewport.columns) {
      const firstRow = layout.tiles.filter((tile) => Math.abs(tile.top - layout.tiles[0]!.top) <= 1).length;
      expect(firstRow, `tiles in the first row: ${name}`).toBe(Math.min(viewport.columns, layout.tiles.length));
    }
    for (const tile of await page.getByTestId("kid-profile").all()) {
      await tile.scrollIntoViewIfNeeded();
      await expect(tile, `tile reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (viewport.width === 360) {
      await page.screenshot({ path: testInfo.outputPath("profile-360x800.png") });
    }
  }
});

function readingChoiceFixture(labels: readonly string[], wrongChoice = false): KidUiFixture {
  const fixture = recallLayoutFixture();
  const task = fixture.tasks[0]!;
  fixture.tasks = [{
    ...task,
    exerciseType: "reading",
    direction: "target_to_source",
    prompt: {
      kind: "reading",
      text: "leg",
      options: labels.map((text, index) => ({ id: `10000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`, text })),
    },
  }];
  if (wrongChoice) {
    // Choosing the first option is wrong; the server reveals the second as the correct one.
    fixture.attempts = [{ attemptId: "10000000-0000-4000-8000-000000000210", taskId: task.taskId, state: "completed",
      modality: "choice", feedback: { kind: "incorrect", correctText: labels[1]! }, taskState: "issued", stepId: null,
      receivedAt: "2026-10-24T10:00:00.000Z", completedAt: "2026-10-24T10:00:01.000Z" }];
  }
  return fixture;
}

async function openReadingChoices(page: Page, labels: readonly string[], wrongChoice = false) {
  await installKidUiFixture(page, readingChoiceFixture(labels, wrongChoice));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-option")).toHaveCount(labels.length);
}

/** Option cards: rectangles, whether the label is clipped and whether it stays on a single line. */
async function measureOptions(page: Page) {
  return page.getByTestId("kid-option").evaluateAll((elements) => elements.map((element) => {
    const { left, right, top, width, height } = element.getBoundingClientRect();
    const label = element.querySelector("span") as HTMLElement;
    const labelRect = label.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
    return { left, right, top, width, height, labelClipped: label.scrollWidth > label.clientWidth + 1,
      labelHeight: labelRect.height, labelCentre: labelRect.top + labelRect.height / 2, lineHeight };
  }));
}

test("short reading options form a 2x2 grid on phones", async ({ page }) => {
  await openReadingChoices(page, ["noga", "ręka", "głowa", "pomarańcza"]);
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const root = (await measure(page, { root: ".kid-learning" })).root;
    const options = await measureOptions(page);
    expect(new Set(options.map((option) => Math.round(option.left))).size, `two columns: ${name}`).toBe(2);
    expect(new Set(options.map((option) => Math.round(option.top))).size, `two rows: ${name}`).toBe(2);
    for (const [index, option] of options.entries()) {
      expectInsideRoot(option as never, root, `option ${index}: ${name}`);
      expect(option.height, `option ${index} height: ${name}`).toBeGreaterThanOrEqual(56);
      expect(option.labelClipped, `option ${index} label clipped: ${name}`).toBe(false);
      expect(option.labelHeight, `option ${index} label on a single line: ${name}`).toBeLessThanOrEqual(option.lineHeight * 1.5);
      // Symmetric badge band: the label sits in the vertical centre of the card.
      expect(Math.abs(option.labelCentre - (option.top + option.height / 2)), `option ${index} label centred: ${name}`).toBeLessThanOrEqual(2);
    }
    expect((await measure(page, { root: ".kid-learning" })).scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(viewport.width);
  }
});

test("short reading options keep the outcome badge clear of the label without changing card height", async ({ page }) => {
  await openReadingChoices(page, ["pomarańcza", "przyjaciel", "głowa", "oko"], true);
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const options = page.getByTestId("kid-option");
    const heights = async () => (await measureOptions(page)).map((option) => option.height);
    const before = await heights();
    await options.first().click();
    await expect(page.getByTestId("kid-outcome-wrong")).toBeVisible();
    await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
    // Let the badge pop animation settle (reduced motion in the fixture makes it instant).
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const outcomes = await options.evaluateAll((elements) => elements.map((element) => {
      const label = element.querySelector("span") as HTMLElement;
      const badge = element.querySelector("[data-outcome]:not(button)") as HTMLElement | null;
      const l = label.getBoundingClientRect();
      const b = badge?.getBoundingClientRect();
      return { outcome: element.getAttribute("data-outcome"),
        overlap: b ? !(b.right <= l.left || b.left >= l.right || b.bottom <= l.top || b.top >= l.bottom) : null };
    }));
    const withOutcome = outcomes.filter((entry) => entry.outcome === "wrong" || entry.outcome === "correct");
    expect(withOutcome, `cards with an outcome: ${name}`).toHaveLength(2);
    for (const entry of withOutcome) {
      expect(entry.overlap, `${entry.outcome} badge overlaps label: ${name}`).toBe(false);
    }
    const after = await heights();
    for (const [index, height] of after.entries()) {
      expect(Math.abs(height - before[index]!), `option ${index} height change after outcome: ${name}`).toBeLessThanOrEqual(1);
    }
    await page.reload();
    await page.getByTestId("kid-profile").click();
    await page.getByTestId("kid-deck").click();
    await expect(options).toHaveCount(4);
  }
});

test("a wide short label takes a full row instead of being clipped", async ({ page }) => {
  // Ten wide glyphs pass the length check but do not fit half of a phone row.
  await openReadingChoices(page, ["WWWWWWWWWW", "noga", "ręka", "oko"]);
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const root = (await measure(page, { root: ".kid-learning" })).root;
    const options = await measureOptions(page);
    for (const [index, option] of options.entries()) {
      expectInsideRoot(option as never, root, `option ${index}: ${name}`);
      expect(option.labelClipped, `option ${index} label clipped: ${name}`).toBe(false);
      expect(option.labelHeight, `option ${index} label on a single line: ${name}`).toBeLessThanOrEqual(option.lineHeight * 1.5);
    }
    const others = options.slice(1);
    // A short option left alone on the last row may stretch too; the paired ones stay half-width.
    expect(options[0]!.width, `wide option spans the row: ${name}`).toBeGreaterThan(Math.min(...others.map((option) => option.width)) * 1.5);
    expect(new Set(others.map((option) => Math.round(option.left))).size, `short options still pair up: ${name}`).toBe(2);
    expect((await measure(page, { root: ".kid-learning" })).scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(viewport.width);
  }
});

test("long reading options stay in one column", async ({ page }) => {
  await openReadingChoices(page, ["noga", "ręka", "głowa", "poniedziałek"]);
  for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const options = await measureOptions(page);
    expect(new Set(options.map((option) => Math.round(option.left))).size, `one column: ${name}`).toBe(1);
  }
});

test("short reading options keep one column on tablets and desktops", async ({ page }) => {
  await openReadingChoices(page, ["noga", "ręka", "głowa", "oko"]);
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const options = await measureOptions(page);
    expect(new Set(options.map((option) => Math.round(option.left))).size, `one column: ${name}`).toBe(1);
    for (const [index, option] of options.entries()) {
      expect(option.height, `option ${index} height: ${name}`).toBeGreaterThanOrEqual(56);
    }
  }
});

/** Two recall tasks: the client first sees 20 assessed tasks left, then 3, so the
 * header shows 20 pebbles together with the "Jeszcze 3" pill. */
function longSessionEndFixture(): KidUiFixture {
  const fixture = recallLayoutFixture();
  const first = fixture.tasks[0]!;
  fixture.tasks = [
    { ...first, remainingAssessed: 20 },
    { ...first, taskId: "10000000-0000-4000-8000-000000000106", ordinal: 1, remainingAssessed: 3 },
  ];
  fixture.attempts = [{ attemptId: "10000000-0000-4000-8000-000000000110", taskId: first.taskId, state: "completed",
    modality: "text", feedback: { kind: "great" }, taskState: "completed", stepId: null,
    receivedAt: "2026-10-24T10:00:00.000Z", completedAt: "2026-10-24T10:00:01.000Z" }];
  return fixture;
}

test("portrait keyboard height keeps 20 pebbles and the Jeszcze pill inside the header centre column", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installKidUiFixture(page, longSessionEndFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await page.getByTestId("kid-input").fill("cat");
  await page.getByTestId("kid-submit").click();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-remaining")).toBeVisible();
  await expect(page.getByTestId("kid-progress-pebble")).toHaveCount(20);
  // 360x420 / 320x420: a phone in portrait with the on-screen keyboard open.
  for (const viewport of [{ width: 360, height: 420 }, { width: 320, height: 420 }]) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    await expect(page.locator(".kid-page")).toHaveAttribute("data-viewport-very-short", "true");
    const layout = await measure(page, {
      root: ".kid-learning",
      header: ".kid-header",
      column: ".kid-session-progress",
      end: "[data-testid='kid-end']",
      mic: "[data-testid='kid-microphone-status']",
      pebbles: "[data-testid='kid-progress-pebbles']",
      pill: "[data-testid='kid-remaining']",
    });
    const centreY = (rect: { top: number; height: number }) => rect.top + rect.height / 2;
    // The progress block (pebbles over the pill) is centred on the header row.
    const blockCentre = (Math.min(layout.pebbles.top, layout.pill.top) + Math.max(layout.pebbles.bottom, layout.pill.bottom)) / 2;
    expect(Math.abs(blockCentre - centreY(layout.end)), `progress block centred on the row: ${name}`).toBeLessThanOrEqual(4);
    expect(layout.pill.top, `pill under the pebbles: ${name}`).toBeGreaterThanOrEqual(layout.pebbles.bottom - 1);
    for (const [label, rect] of Object.entries({ pebbles: layout.pebbles, pill: layout.pill })) {
      expect(rect.left, `${label} inside centre column: ${name}`).toBeGreaterThanOrEqual(layout.column.left - 1);
      expect(rect.right, `${label} inside centre column: ${name}`).toBeLessThanOrEqual(layout.column.right + 1);
      expect(rect.left, `${label} clear of close: ${name}`).toBeGreaterThanOrEqual(layout.end.right);
      expect(rect.right, `${label} clear of microphone: ${name}`).toBeLessThanOrEqual(layout.mic.left);
      expect(rect.top, `${label} inside header: ${name}`).toBeGreaterThanOrEqual(layout.header.top - 1);
      expect(rect.bottom, `${label} inside header: ${name}`).toBeLessThanOrEqual(layout.header.bottom + 1);
      expectInsideRoot(rect, layout.root, `${label}: ${name}`);
      expect(rect.left, `${label} left in viewport: ${name}`).toBeGreaterThanOrEqual(0);
      expect(rect.right, `${label} right in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    }
    const pebbles = await page.getByTestId("kid-progress-pebble").evaluateAll((elements) => elements.map((element) => {
      const { left, right, width } = element.getBoundingClientRect();
      return { left, right, width };
    }));
    for (const [index, pebble] of pebbles.entries()) {
      expect(pebble.width, `pebble ${index} width: ${name}`).toBeGreaterThanOrEqual(5);
      expect(pebble.left, `pebble ${index} inside row: ${name}`).toBeGreaterThanOrEqual(layout.pebbles.left - 2);
      expect(pebble.right, `pebble ${index} inside row: ${name}`).toBeLessThanOrEqual(layout.pebbles.right + 2);
    }
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
  }
});

test("stimulus words stay larger than the answers on phones", async ({ page }) => {
  await openReadingChoices(page, ["noga", "ręka", "głowa", "oko"]);
  await resizeAndSettle(page, { width: 360, height: 800 });
  const reading = await page.evaluate(() => ({
    word: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid='kid-word']")!).fontSize),
    option: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid='kid-option'] span")!).fontSize),
  }));
  expect(reading.word, "reading word font size at 360x800").toBeGreaterThanOrEqual(28);
  expect(reading.word, "reading word larger than the option label").toBeGreaterThan(reading.option);

  const recall = await page.context().newPage();
  await installKidUiFixture(recall, recallLayoutFixture());
  await recall.goto("/");
  await recall.getByTestId("kid-profile").click();
  await recall.getByTestId("kid-deck").click();
  await resizeAndSettle(recall, { width: 360, height: 800 });
  const written = await recall.evaluate(() => ({
    source: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid='kid-source']")!).fontSize),
    input: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid='kid-input']")!).fontSize),
  }));
  expect(written.source, "recall source font size at 360x800").toBeGreaterThanOrEqual(28);
  expect(written.source, "recall source larger than the typed answer").toBeGreaterThan(written.input);
});

test("picture listening keeps the instruction guidance distinct and clear of the instruction text", async ({ page }) => {
  await installKidUiFixture(page, pictureChoiceLayoutFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");
  const guidance = page.getByTestId("kid-instruction").getByTestId("kid-guidance-play");
  await expect(guidance).toHaveCount(1);
  await expect(guidance).toHaveAttribute("aria-label", "Posłuchaj polecenia");
  await expect(guidance).toHaveAttribute("data-variant", "outlined");
  await expect(page.getByTestId("kid-instruction").getByTestId("kid-play")).toHaveAttribute("aria-label", "Posłuchaj");
  // The real instruction, then a long one (stress text) that has to wrap.
  const long = "Posłuchaj uważnie nagrania i wybierz obrazek, który do niego pasuje";
  for (const text of [null, long]) {
    if (text !== null) {
      await page.evaluate((value) => {
        document.querySelector("[data-testid='kid-instruction'] > span")!.textContent = value;
      }, text);
    }
    for (const viewport of [{ width: 360, height: 800 }, { width: 320, height: 640 }]) {
      const name = `${viewport.width}x${viewport.height}${text === null ? "" : " long"}`;
      await resizeAndSettle(page, viewport);
      const layout = await measure(page, {
        row: "[data-testid='kid-instruction']",
        text: "[data-testid='kid-instruction'] > span",
        guidance: "[data-testid='kid-instruction'] [data-testid='kid-guidance-play']",
        play: "[data-testid='kid-instruction'] [data-testid='kid-play']",
      });
      const intersects = (a: Rect, b: Rect) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      for (const [label, rect] of Object.entries({ guidance: layout.guidance, play: layout.play })) {
        expect(rect.width, `${label} width: ${name}`).toBeGreaterThanOrEqual(48);
        expect(rect.height, `${label} height: ${name}`).toBeGreaterThanOrEqual(48);
        expect(rect.left, `${label} inside instruction: ${name}`).toBeGreaterThanOrEqual(layout.row.left - 1);
        expect(rect.right, `${label} inside instruction: ${name}`).toBeLessThanOrEqual(layout.row.right + 1);
        expect(rect.top, `${label} inside instruction: ${name}`).toBeGreaterThanOrEqual(layout.row.top - 1);
        expect(rect.bottom, `${label} inside instruction: ${name}`).toBeLessThanOrEqual(layout.row.bottom + 1);
        expect(intersects(rect, layout.text), `${label} intersects the instruction text: ${name}`).toBe(false);
      }
      expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    }
  }
});
