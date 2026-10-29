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
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const layout = await page.evaluate(() => {
      const rect = (element: Element) => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const root = document.querySelector("[data-kid-screen]")!;
      const band = document.querySelector("[data-kid-header='band']")!;
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        root: rect(root),
        band: rect(band),
        tiles: [...document.querySelectorAll("[data-testid='kid-profile']")].map((tile) => ({
          ...rect(tile),
          overflowX: tile.scrollWidth > tile.clientWidth + 1,
        })),
      };
    });
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expect(Math.round(layout.band.left), `band left: ${name}`).toBe(Math.round(layout.root.left));
    expect(Math.round(layout.band.right), `band right: ${name}`).toBe(Math.round(layout.root.right));
    expect(Math.round(layout.band.top), `band top: ${name}`).toBe(0);
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
