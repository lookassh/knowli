import { expect, test, type Page } from "@playwright/test";
import { assertKidLayout, installKidUiFixture, silentWavBuffer, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

const viewports = [
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 727, height: 953 },
];

function relativeLuminance(color: string): number {
  const values = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  if (!values || values.length !== 3) throw new Error(`Unexpected CSS color: ${color}`);
  const [red, green, blue] = values.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(foreground: string, background: string): number {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (luminances[0]! + 0.05) / (luminances[1]! + 0.05);
}

async function openPictureChoices(page: Page, fixture: KidUiFixture, viewport = viewports[0]!) {
  await page.setViewportSize(viewport);
  await installKidUiFixture(page, fixture);
  await page.route("**/api/v1/media/10000000-0000-4000-8000-000000000012", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: silentWavBuffer() }));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");
}

test("cztery ilustracje tworzą czytelną zwartą siatkę także między progami responsywności", async ({ page }, testInfo) => {
  const fixture = pictureChoiceLayoutFixture();
  const task = fixture.tasks[1]!;
  if (task.prompt.kind !== "picture_listening") throw new Error("picture listening fixture missing");
  task.prompt.options = Array.from({ length: 4 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(80 + index).padStart(12, "0")}`,
    labelPl: `Obrazek ${index + 1}`,
    visual: { kind: "image", imageAssetId: "10000000-0000-4000-8000-000000000015" },
  }));
  await openPictureChoices(page, fixture, { width: 360, height: 560 });

  for (const [width, height] of [[360, 560], [390, 740], [489, 500], [498, 610],
    [599, 650], [600, 650], [699, 780], [700, 780], [840, 480], [768, 1024], [1392, 984]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${height}px`);
    await expect.poll(() => page.getByTestId("kid-option").evaluateAll((elements) => {
      const boxes = elements.map((element) => element.getBoundingClientRect());
      return Math.min(...boxes.map((box) => box.width));
    }), { message: `illustrations must stay readable at ${width}x${height}` }).toBeGreaterThanOrEqual(112);
    const geometry = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((element) => element.getBoundingClientRect());
      const material = document.querySelector<HTMLElement>(".kid-material")!.getBoundingClientRect();
      const grid = document.querySelector<HTMLElement>(".kid-picture-options")!.getBoundingClientRect();
      return {
        square: boxes.every((box) => Math.abs(box.width - box.height) <= 1),
        horizontalGap: boxes[1]!.left - boxes[0]!.right,
        centerOffset: Math.abs((grid.left + grid.right) / 2 - (material.left + material.right) / 2),
        materialCenterOffset: Math.abs((material.left + material.right) / 2 - innerWidth / 2),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.square, JSON.stringify({ width, height, geometry })).toBe(true);
    expect(geometry.horizontalGap).toBeGreaterThanOrEqual(8);
    expect(geometry.horizontalGap).toBeLessThanOrEqual(16);
    expect(geometry.centerOffset).toBeLessThanOrEqual(1);
    expect(geometry.materialCenterOffset).toBeLessThanOrEqual(1);
    expect(geometry.horizontalOverflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`compact-image-grid-${width}x${height}.png`) });
  }
});

for (const count of [2, 3, 4]) {
  test(`${count} obrazki zachowują czytelność i dostępność z feedbackiem oraz tekstem 200%`, async ({ page }) => {
    const fixture = pictureChoiceLayoutFixture();
    const task = fixture.tasks[1]!;
    if (task.prompt.kind !== "picture_listening") throw new Error("picture listening fixture missing");
    task.prompt.options = Array.from({ length: count }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(80 + index).padStart(12, "0")}`,
      labelPl: `Obrazek ${index + 1}`,
      visual: { kind: "image", imageAssetId: "10000000-0000-4000-8000-000000000015" },
    }));
    await openPictureChoices(page, fixture, { width: 360, height: 560 });
    await page.getByTestId("kid-option").first().click();
    const next = page.getByTestId("kid-next");
    await expect(next).toBeVisible();
    for (const [width, height] of [[360, 560], [489, 500], [600, 650], [844, 390], [1392, 984]] as const) {
      await page.setViewportSize({ width, height });
      await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${height}px`);
      // A resize can switch to page scrolling and schedule the footer reveal.
      // Wait for that frame before checking manual access to earlier options.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      for (const option of await page.getByTestId("kid-option").all()) {
        await option.evaluate((element) => element.scrollIntoView({ block: "center" }));
        await expect(option, `option at ${width}x${height}`).toBeInViewport({ ratio: 0.98 });
        const bounds = await option.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(112);
        expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThanOrEqual(1);
      }
      await next.scrollIntoViewIfNeeded();
      await expect(next).toBeInViewport({ ratio: 0.98 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
  });
}

test("trzy odpowiedzi obrazkowe mieszczą się bez przewijania", async ({ page }, testInfo) => {
  await openPictureChoices(page, pictureChoiceLayoutFixture());

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toHaveAccessibleName("żółty");
  await expect(options.nth(1)).toHaveAccessibleName("jeden");
  await expect(options.nth(2)).toHaveAccessibleName("kot");
  const labels = page.locator(".kid-picture-choice-label");
  await expect(labels).toHaveCount(3);
  expect(await labels.evaluateAll((elements) => elements.every((element) => {
    const style = getComputedStyle(element);
    return style.position === "absolute" && style.clip === "rect(0px, 0px, 0px, 0px)";
  }))).toBe(true);

  for (const [index, viewport] of viewports.entries()) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await assertKidLayout(page);

      const geometry = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".kid-material-content")!;
        const contentBounds = content.getBoundingClientRect();
        const viewportBounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        const options = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")];
        const play = document.querySelector<HTMLElement>("[data-testid='kid-play']")!.getBoundingClientRect();
        const root = document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!;
        const scrolling = document.scrollingElement!;
        return {
          contentScrollHeight: content.scrollHeight,
          contentClientHeight: content.clientHeight,
          contentScrollWidth: content.scrollWidth,
          contentClientWidth: content.clientWidth,
          rootScrollHeight: root.scrollHeight,
          rootClientHeight: root.clientHeight,
          documentScrollHeight: scrolling.scrollHeight,
          documentClientHeight: scrolling.clientHeight,
          play: { width: play.width, height: play.height, top: play.top, bottom: play.bottom },
          options: options.map((option) => {
            const bounds = option.getBoundingClientRect();
            const visual = option.querySelector<HTMLElement>(".kid-picture-choice-visual")!.getBoundingClientRect();
            return {
              top: bounds.top,
              bottom: bounds.bottom,
              left: bounds.left,
              right: bounds.right,
              height: bounds.height,
              fullyInsideContent: bounds.top >= contentBounds.top && bounds.bottom <= contentBounds.bottom,
              fullyInsideViewport: bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom &&
                bounds.left >= viewportBounds.left && bounds.right <= viewportBounds.right,
              visualInsideOption: visual.top >= bounds.top && visual.bottom <= bounds.bottom &&
                visual.left >= bounds.left && visual.right <= bounds.right,
              visual: { top: visual.top, left: visual.left },
            };
          }),
        };
      });

      expect(geometry.options, JSON.stringify(geometry)).toHaveLength(3);
      expect(geometry.options.every((option) => option.fullyInsideContent), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.fullyInsideViewport), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.height >= 48), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.visualInsideOption), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options[2]!.visual.left, JSON.stringify(geometry)).toBe(geometry.options[0]!.visual.left);
      expect(geometry.options[2]!.top - geometry.options[0]!.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(16);
      expect(geometry.play.width, JSON.stringify(geometry)).toBeGreaterThanOrEqual(48);
      expect(geometry.play.height, JSON.stringify(geometry)).toBeGreaterThanOrEqual(48);
      expect(geometry.play.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
      expect(geometry.play.bottom, JSON.stringify(geometry)).toBeLessThanOrEqual(viewport.height);
      expect(geometry.contentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientHeight + 1);
      expect(geometry.contentScrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientWidth + 1);
      expect(geometry.rootScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.rootClientHeight + 1);
      expect(geometry.documentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
      if (index === 0 || index === viewports.length - 1) {
        await page.screenshot({ path: testInfo.outputPath(`picture-options-${viewport.width}x${viewport.height}.png`) });
      }
    });
  }
});

test("wynik zajmuje rzeczywistą stopkę pod zwartą siatką na telefonie i desktopie", async ({ page }, testInfo) => {
  await openPictureChoices(page, pictureChoiceLayoutFixture(), { width: 390, height: 844 });
  await expect(page.getByTestId("kid-exercise-actions")).toBeEmpty();
  await page.getByTestId("kid-option").first().click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 768 }, { width: 489, height: 500 }]) {
    await page.setViewportSize(viewport);
    const next = page.getByTestId("kid-next");
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    const geometry = await page.evaluate(() => {
      const material = document.querySelector<HTMLElement>(".kid-material")!.getBoundingClientRect();
      const dock = document.querySelector<HTMLElement>("[data-testid='kid-feedback-dock']")!.getBoundingClientRect();
      const options = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((e) => e.getBoundingClientRect());
      return { materialBottom: material.bottom, dockTop: dock.top, dockBottom: dock.bottom,
        materialCenter: (material.left + material.right) / 2,
        widths: options.map((r) => r.width), square: options.every((r) => Math.abs(r.width - r.height) <= 1),
        gap: options[1]!.left - options[0]!.right };
    });
    expect(geometry.materialBottom).toBeLessThanOrEqual(geometry.dockTop + 1);
    expect(geometry.dockBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(geometry.materialCenter).toBeCloseTo(viewport.width / 2, 0);
    expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(112);
    expect(geometry.square).toBe(true);
    expect(geometry.gap).toBeLessThanOrEqual(16);
    const last = page.getByTestId("kid-option").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 0.98 });
    await page.screenshot({ path: testInfo.outputPath(`picture-feedback-${viewport.width}x${viewport.height}.png`) });
  }
});

test("landscape zachowuje dostęp do siatki i stopki bez pustej bocznej kolumny", async ({ page }) => {
  const fixture = pictureChoiceLayoutFixture();
  const original = fixture.attempts![0]!;
  fixture.attempts = [{ ...original, feedback: { kind: "incorrect", correctText: "żółty" }, taskState: "issued" }];
  await openPictureChoices(page, fixture, { width: 844, height: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const checkOptions = async () => {
    for (const option of await page.getByTestId("kid-option").all()) {
      // Chromium's CDP scroll helper considers the inner box of a disabled
      // button; center the whole border box, including the 4px outcome border.
      await option.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await expect(option).toBeInViewport({ ratio: 0.98 });
    }
    expect(await page.locator(".kid-material").evaluate((e) => {
      const r = e.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2);
    })).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  };
  await checkOptions();
  await page.getByTestId("kid-option").nth(1).click();
  await page.getByTestId("kid-next").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-next")).toBeInViewport();
  await expect(page.getByTestId("kid-feedback-dock")).toBeInViewport({ ratio: 1 });
  await checkOptions();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-exercise-actions")).toBeEmpty();
  await checkOptions();
});

test("cyfra działa z klawiatury w ciemnym motywie, pokazuje błąd i pozwala spróbować ponownie", async ({ page }, testInfo) => {
  const fixture = pictureChoiceLayoutFixture();
  const task = fixture.tasks[1];
  const originalAttempt = fixture.attempts?.[0];
  if (!task || task.prompt.kind !== "picture_listening" || !originalAttempt) {
    throw new Error("picture listening fixture missing");
  }
  fixture.attempts = [
    { ...originalAttempt, feedback: { kind: "incorrect", correctText: "żółty" }, taskState: "issued" },
    { ...originalAttempt, attemptId: "10000000-0000-4000-8000-000000000017", feedback: { kind: "great" }, taskState: "completed" },
  ];

  let releaseFirstAnswer!: () => void;
  let signalFirstAnswer!: () => void;
  const firstAnswerGate = new Promise<void>((resolve) => { releaseFirstAnswer = resolve; });
  const firstAnswerStarted = new Promise<void>((resolve) => { signalFirstAnswer = resolve; });
  const submitted: unknown[] = [];
  let responseIndex = 0;
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openPictureChoices(page, fixture);
  await page.route(`**/api/v1/kid/tasks/${task.taskId}/attempts`, async (route) => {
    submitted.push(route.request().postDataJSON());
    const response = fixture.attempts?.[responseIndex];
    responseIndex += 1;
    if (!response) throw new Error("choice answer fixture exhausted");
    if (responseIndex === 1) {
      signalFirstAnswer();
      await firstAnswerGate;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });

  const options = page.getByTestId("kid-option");
  const material = page.locator(".kid-material");
  await options.nth(1).focus();
  await expect(options.nth(1)).toBeFocused();
  const scrollBeforeAnswer = await material.evaluate((element) => element.scrollTop);
  const initialPositions = await options.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  await page.keyboard.press("Enter");
  await firstAnswerStarted;
  expect(submitted[0]).toMatchObject({ modality: "choice", optionId: "10000000-0000-4000-8000-000000000009" });
  await expect.poll(() => options.evaluateAll((elements) => elements.map((element) => (element as HTMLButtonElement).disabled)))
    .toEqual([true, true, true]);
  expect(await material.evaluate((element) => element.scrollTop)).toBe(scrollBeforeAnswer);

  releaseFirstAnswer();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  await expect(options.nth(1)).toHaveClass(/kid-option--wrong/);
  await expect(options.nth(0)).toHaveClass(/kid-option--correct/);
  await expect(options.nth(1)).toHaveAccessibleName("Twój błędny wybór: jeden");
  await expect(options.nth(0)).toHaveAccessibleName("Poprawna odpowiedź: żółty");
  await expect(options.nth(1).getByTestId("kid-outcome-wrong")).toBeVisible();
  await expect(options.nth(0).getByTestId("kid-outcome-correct")).toBeVisible();
  const markerStyles = await options.nth(1).getByTestId("kid-outcome-wrong").evaluate((marker) => ({
    width: marker.getBoundingClientRect().width,
    height: marker.getBoundingClientRect().height,
    background: getComputedStyle(marker).backgroundColor,
    foreground: getComputedStyle(marker).color,
    radius: getComputedStyle(marker).borderRadius,
  }));
  expect(markerStyles.width).toBe(40);
  expect(markerStyles.height).toBe(40);
  expect(markerStyles.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(markerStyles.radius).not.toBe("50%");
  expect(contrastRatio(markerStyles.foreground, markerStyles.background)).toBeGreaterThanOrEqual(3);
  const digitColors = await options.nth(1).evaluate((button) => ({
    foreground: getComputedStyle(button).color,
    background: getComputedStyle(button).backgroundColor,
    digit: getComputedStyle(button.querySelector(".kid-visual-number--digit text")!).fill,
  }));
  expect(digitColors.digit).toBe(digitColors.foreground);
  expect(contrastRatio(digitColors.digit, digitColors.background), JSON.stringify(digitColors)).toBeGreaterThanOrEqual(4.5);
  await expect(options).toHaveCount(3);
  const markersStayInsideTiles = await options.evaluateAll((elements) => elements.flatMap((element) => {
    const marker = element.querySelector<HTMLElement>(".kid-picture-outcome");
    if (marker === null) return [];
    const option = element.getBoundingClientRect();
    const bounds = marker.getBoundingClientRect();
    return [bounds.left >= option.left && bounds.right <= option.right
      && bounds.top >= option.top && bounds.bottom <= option.bottom];
  }));
  expect(markersStayInsideTiles).toEqual([true, true]);
  await page.screenshot({ path: testInfo.outputPath("picture-choice-feedback-retry.png") });

  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
  await expect.poll(() => options.evaluateAll((elements) => elements.map((element) => (element as HTMLButtonElement).disabled)))
    .toEqual([false, false, false]);
  const afterRetry = await options.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  expect(Math.max(...afterRetry.map((position, index) => Math.abs(position - initialPositions[index]!)))).toBeLessThanOrEqual(6);

  await options.nth(0).click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  await expect(options.nth(0)).toHaveClass(/kid-option--correct/);
  expect(submitted[1]).toMatchObject({ modality: "choice", optionId: "10000000-0000-4000-8000-000000000008" });
  await page.screenshot({ path: testInfo.outputPath("picture-choice-feedback-success.png") });
});

test("cztery opcje mieszczą się na typowym telefonie, a w niskim widoku pozostają osiągalne przez scroll", async ({ page }, testInfo) => {
  const fixture = pictureChoiceLayoutFixture();
  const exposure = fixture.tasks[0];
  const listening = fixture.tasks[1];
  if (!exposure || !listening || listening.prompt.kind !== "picture_listening") {
    throw new Error("picture listening fixture missing");
  }
  const fourth = { ...listening.prompt.options[2]!, id: "10000000-0000-4000-8000-000000000018", labelPl: "pies", visual: { kind: "image" as const, imageAssetId: "10000000-0000-4000-8000-000000000019" } };
  fixture.tasks = [
    exposure,
    { ...listening, prompt: { ...listening.prompt, options: [...listening.prompt.options, fourth] } },
    fixture.tasks[2]!,
  ];
  await openPictureChoices(page, fixture, { width: 390, height: 844 });

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(4);
  const positions = await options.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const visual = element.querySelector<HTMLElement>(".kid-picture-choice-visual")!.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      insideViewport: bounds.top >= 0 && bounds.bottom <= window.innerHeight && bounds.left >= 0 && bounds.right <= window.innerWidth,
      visualInsideOption: visual.top >= bounds.top && visual.bottom <= bounds.bottom && visual.left >= bounds.left && visual.right <= bounds.right,
      visualWidth: visual.width,
      visualHeight: visual.height,
    };
  }));
  expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
  expect(positions[2]!.x).toBe(positions[0]!.x);
  expect(positions[3]!.x).toBe(positions[1]!.x);
  expect(positions[2]!.y).toBeGreaterThan(positions[0]!.y);
  expect(positions[2]!.y - (positions[0]!.y + positions[0]!.height)).toBeLessThanOrEqual(16);
  expect(positions.every((position) => position.insideViewport)).toBe(true);
  expect(positions.every((position) => position.visualInsideOption)).toBe(true);
  expect(positions.every((position) => position.visualHeight >= 100 && position.visualWidth >= 100)).toBe(true);
  expect(positions.every((position) => position.height >= 120)).toBe(true);
  await expect(page.getByTestId("kid-end")).toBeInViewport();
  const contentGeometry = await page.locator(".kid-material-content").evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(contentGeometry.scrollHeight).toBeLessThanOrEqual(contentGeometry.clientHeight + 1);
  const documentGeometry = await page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    clientHeight: document.scrollingElement!.clientHeight,
  }));
  expect(documentGeometry.scrollHeight).toBeLessThanOrEqual(documentGeometry.clientHeight + 1);
  await page.screenshot({ path: testInfo.outputPath("picture-options-four-390x844.png") });

  await page.setViewportSize({ width: 412, height: 600 });
  const content600 = await page.locator(".kid-material-content").evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(content600.scrollHeight).toBeLessThanOrEqual(content600.clientHeight + 1);
  await expect(options.last()!).toBeInViewport();
  await expect(page.getByTestId("kid-end")).toBeInViewport();

  await page.setViewportSize({ width: 360, height: 560 });
  await options.last()!.scrollIntoViewIfNeeded();
  await expect(options.last()!).toBeInViewport();
  await page.getByTestId("kid-end").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-end")).toBeInViewport();
});

test("powiększenie pozwala dosięgnąć ostatniej odpowiedzi i przycisku końca", async ({ page }) => {
  await openPictureChoices(page, pictureChoiceLayoutFixture(), { width: 390, height: 700 });
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperty(viewport, "scale", { configurable: true, value: 2 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("kid-session-frame")).toHaveAttribute("data-zoomed", "true");

  const lastOption = page.getByTestId("kid-option").last();
  await lastOption.scrollIntoViewIfNeeded();
  await expect(lastOption).toBeInViewport();
  const endButton = page.getByTestId("kid-end");
  await endButton.scrollIntoViewIfNeeded();
  await expect(endButton).toBeInViewport();
});

test("układ poziomy zachowuje dostęp do wszystkich odpowiedzi i końca sesji", async ({ page }) => {
  await openPictureChoices(page, pictureChoiceLayoutFixture(), { width: 640, height: 360 });
  const root = await page.getByTestId("kid-session-frame").boundingBox();
  expect(root).not.toBeNull();
  expect(root!.x + root!.width).toBeLessThanOrEqual(641);

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  await options.last().scrollIntoViewIfNeeded();
  await expect(options.last()).toBeInViewport();
  const end = page.getByTestId("kid-end");
  await end.scrollIntoViewIfNeeded();
  await expect(end).toBeInViewport();
});

test("trzy odpowiedzi i cyfra pozostają czytelne w ciemnym motywie", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openPictureChoices(page, pictureChoiceLayoutFixture());
  await assertKidLayout(page);

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  await expect(page.locator(".kid-visual-number--digit text")).toHaveText("1");
  for (const option of await options.all()) await expect(option).toBeInViewport();
  const background = await page.locator(".kid-ui").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).toBe("rgb(24, 33, 52)");
  const content = await page.locator(".kid-material-content").evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight + 1);
  await page.screenshot({ path: testInfo.outputPath("picture-options-dark-360x640.png") });
});
