import { expect as baseExpect, test } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { assertKidLayout, installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

const expect = baseExpect.configure({ timeout: 1_500 });

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const assetId = "10000000-0000-4000-8000-000000000006";
const optionIds = ["10000000-0000-4000-8000-000000000007", "10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];

function recallFixture(recordingMode: "hold" | "toggle" = "hold") {
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode }],
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

function taskFor(kind: TaskDto["prompt"]["kind"]): TaskDto {
  const common = { taskId, sessionId, ordinal: 0, state: "issued" as const, remainingAssessed: 1 };
  if (kind === "exposure") return { ...common, exerciseType: "exposure" as const, direction: null, prompt: {
    kind: "exposure" as const, source: "kot", target: "cat", example: "The cat is sleeping.", audioAssetId: assetId,
    exampleAudioAssetId: assetId, imageAssetId: assetId, visualType: "image" as const,
  } };
  if (kind === "listening") return { ...common, exerciseType: "listening" as const, direction: "target_to_source" as const, prompt: {
    kind: "listening" as const, audioAssetId: assetId,
    options: ["marzec", "kwiecień", "październik"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "reading") return { ...common, exerciseType: kind, direction: "target_to_source", prompt: {
    kind, text: "cat", options: ["kot", "pies", "ptak"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "reverse_recognition") return { ...common, exerciseType: kind, direction: "target_to_source", prompt: {
    kind, prompt: "kot", options: ["cat", "dog", "bird"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "spelling") return { ...common, exerciseType: "spelling" as const, direction: "source_to_target" as const, prompt: { kind, prompt: "kot" } };
  if (kind === "letter_completion") return { ...common, exerciseType: "letter_completion" as const, direction: "source_to_target" as const, prompt: { kind, prompt: "kot", fragment: "c_t" } };
  if (kind === "speech") return { ...common, exerciseType: "speech" as const, direction: "source_to_target" as const, prompt: { kind, text: "cat", audioAssetId: assetId, imageAssetId: null, visualType: "none" as const } };
  return { ...common, exerciseType: "recall" as const, direction: "source_to_target" as const, prompt: { kind: "recall" as const, prompt: "kot" } };
}

async function openTask(page: Parameters<typeof installKidUiFixture>[0], task: ReturnType<typeof taskFor>) {
  await installKidUiFixture(page, { ...recallFixture(), tasks: [task] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`microphone help is compact and does not request access in ${colorScheme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => { throw new DOMException("Permission denied", "NotAllowedError"); } },
      });
    });
    const fixture = recallFixture();
    fixture.session.microphoneEnabled = true;
    await installKidUiFixture(page, fixture);
    await page.goto("/");
    await page.getByTestId("kid-profile").click();
    await page.getByTestId("kid-deck").click();
    const status = page.getByTestId("kid-microphone-status");
    await expect(status).toHaveAccessibleName("Mikrofon wymaga włączenia");
    await page.getByTestId("kid-input").fill("cat");
    await status.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("kid-microphone-hint")).toBeVisible();
    await expect(status).toHaveAccessibleName("Mikrofon wymaga włączenia");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("kid-microphone-hint")).toBeHidden();
    await page.getByTestId("kid-record").click();
    await expect(status).toHaveAccessibleName("Mikrofon niedostępny");
    await expect(page.getByTestId("kid-mic-denied")).toBeHidden();
    await expect(page.getByTestId("kid-record")).toHaveCount(0);
    await expect(page.getByTestId("kid-input")).toHaveValue("cat");
    await assertKidLayout(page);
    await page.screenshot({ path: testInfo.outputPath(`microphone-${colorScheme}.png`) });
    await status.click();
    await expect(page.getByTestId("kid-mic-denied")).toHaveText("Mikrofon niedostępny. Możesz ćwiczyć bez nagrywania.");
    await expect(page.getByTestId("kid-mic-denied")).toBeInViewport();
    await expect(status.locator("svg")).toBeVisible();
    const bounds = await status.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  });

  test(`retry feedback uses readable blue support in ${colorScheme} theme`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.emulateMedia({ colorScheme });
    const task = taskFor("reading");
    const attempt = {
      attemptId: "10000000-0000-4000-8000-000000000010", taskId, state: "completed" as const,
      modality: "choice" as const, feedback: { kind: "incorrect" as const, correctText: "kot" },
      taskState: "issued" as const, stepId: "retry-feedback",
      receivedAt: "2026-10-11T10:00:01.000Z", completedAt: "2026-10-11T10:00:01.000Z",
    };
    await installKidUiFixture(page, { ...recallFixture(), tasks: [task], attempts: [attempt] });
    await page.goto("/");
    await page.getByTestId("kid-profile").click();
    await page.getByTestId("kid-deck").click();
    await page.getByTestId("kid-option").nth(1).click();
    const feedback = page.getByTestId("kid-feedback");
    await expect(feedback.getByTestId("kid-feedback-correct-answer")).toHaveText("kot");
    await expect(page.getByTestId("kid-next")).toBeInViewport();
    const colors = await feedback.evaluate((element) => {
      const style = getComputedStyle(element);
      const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const background = channels(style.backgroundColor);
      const luminance = (rgb: number[]) => rgb.map((c) => c / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
      const fg = luminance(channels(style.color));
      const bg = luminance(background);
      return { blue: background[2]!, red: background[0]!, contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
    });
    expect(colors.blue).toBeGreaterThan(colors.red);
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    await expect(page.getByTestId("kid-option").nth(0)).toHaveClass(/kid-option--correct/);
    await expect(page.getByTestId("kid-option").nth(1)).toHaveClass(/kid-option--wrong/);
    await page.screenshot({ path: testInfo.outputPath(`feedback-${colorScheme}.png`) });
  });
}

test("turning recording off on the deck screen gives a neutral session status", async ({ page }) => {
  await installKidUiFixture(page, recallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mic-settings").click();
  await page.getByTestId("kid-mic-toggle").uncheck();
  await page.getByTestId("kid-mic-settings").click();
  await page.getByTestId("kid-deck").click();
  const status = page.getByTestId("kid-microphone-status");
  await expect(status).toHaveAccessibleName("Nagrywanie wyłączone");
  await expect(status.locator("..")).toHaveAttribute("data-microphone-state", "off");
  await expect(page.getByTestId("kid-record")).toHaveCount(0);
  await expect(page.getByTestId("kid-input")).toBeVisible();
});

test("session frame remains inside visible viewport after resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openRecall(page);
  await assertKidLayout(page);

  await page.setViewportSize({ width: 390, height: 520 });
  await expect(page.getByTestId("kid-input")).toHaveValue("");
  await assertKidLayout(page, { allowDetailsScroll: true });
});

test("session frame honors visual viewport height and offset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openRecall(page);
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 350 },
      offsetTop: { configurable: true, value: 24 },
      scale: { configurable: true, value: 1 },
    });
    viewport.dispatchEvent(new Event("resize"));
  });
  const bounds = await page.getByTestId("kid-session-frame").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(24);
  expect(bounds!.height).toBeLessThanOrEqual(350);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(374);
});

test("short visual viewport keeps the written input and actions reachable on a tall layout viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecall(page);
  await page.getByTestId("kid-input").fill("kot");
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport is required for this browser test");
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 350 },
      offsetTop: { configurable: true, value: 24 },
      scale: { configurable: true, value: 1 },
    });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("kid-session-frame")).toHaveAttribute("data-viewport-very-short", "true");
  const material = page.getByTestId("kid-material");
  const input = page.getByTestId("kid-input");
  await input.scrollIntoViewIfNeeded();
  const [materialBounds, inputBounds] = await Promise.all([material.boundingBox(), input.boundingBox()]);
  expect(materialBounds).not.toBeNull();
  expect(inputBounds).not.toBeNull();
  expect(inputBounds!.y).toBeGreaterThanOrEqual(materialBounds!.y - 1);
  expect(inputBounds!.y + inputBounds!.height).toBeLessThanOrEqual(materialBounds!.y + materialBounds!.height + 1);

  const action = page.getByTestId("kid-submit");
  await action.scrollIntoViewIfNeeded();
  const actionBounds = await action.boundingBox();
  expect(actionBounds).not.toBeNull();
  expect(actionBounds!.y).toBeGreaterThanOrEqual(24);
  // visualViewport offsets can produce a subpixel fractional remainder.
  expect(actionBounds!.y + actionBounds!.height).toBeLessThanOrEqual(375);
  await expect(input).toHaveValue("kot");
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

for (const [kind, instruction] of [
  ["exposure", "Poznaj nowe słowo"],
  ["listening", "Posłuchaj i wybierz"],
  ["reading", "Wybierz znaczenie słowa"],
  ["reverse_recognition", "Wybierz angielskie słowo"],
  ["recall", "Jak jest po angielsku?"],
  ["spelling", "Napisz po angielsku"],
  ["letter_completion", "Uzupełnij litery"],
  ["speech", "Powiedz na głos"],
] as const) {
  test(`instruction is separated from material for every prompt: ${kind}`, async ({ page }) => {
    await openTask(page, taskFor(kind));
    const label = page.getByTestId("kid-instruction");
    await expect(label).toHaveText(instruction);
    const styles = await label.evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      borderStyle: getComputedStyle(element).borderStyle,
    }));
    expect(styles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(styles.borderStyle).toBe("none");
    const instructionBox = await label.boundingBox();
    const materialBox = await page.getByTestId("kid-material").boundingBox();
    expect(instructionBox).not.toBeNull();
    expect(materialBox).not.toBeNull();
    expect(materialBox!.y).toBeGreaterThan(instructionBox!.y + instructionBox!.height);
  });
}

test("listening shows a named icon button without answer disclosure", async ({ page }) => {
  await openTask(page, taskFor("listening"));
  const speaker = page.getByTestId("kid-play");
  await expect(speaker).toHaveAccessibleName("Posłuchaj");
  await expect(page.getByTestId("kid-option")).toHaveCount(3);
  await expect(page.getByText("October")).toHaveCount(0);
  await expect(page.getByTestId("kid-word")).toHaveCount(0);
  await expect(speaker.locator("svg")).toBeVisible();
});

test("exposure keeps image and both audio actions visible", async ({ page }) => {
  await openTask(page, taskFor("exposure"));
  await expect(page.getByTestId("kid-illustration")).toBeVisible();
  await expect(page.getByTestId("kid-play")).toBeVisible();
  await expect(page.getByTestId("kid-play-example")).toBeVisible();
  await expect(page.getByTestId("kid-done")).toBeVisible();
});

test("exposure works without an image", async ({ page }) => {
  const task = taskFor("exposure");
  if (task.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
  task.prompt.imageAssetId = null;
  task.prompt.visualType = "none";
  await openTask(page, task);
  await expect(page.getByTestId("kid-illustration")).toHaveCount(0);
  await expect(page.getByTestId("kid-target")).toHaveText("cat");
  await expect(page.getByTestId("kid-done")).toBeVisible();
});

test("an image request failure does not block exposure", async ({ page }) => {
  const brokenTask = taskFor("exposure");
  if (brokenTask.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
  await installKidUiFixture(page, { ...recallFixture(), tasks: [brokenTask] });
  await page.route("**/api/v1/media/**", (route) => route.fulfill({ status: 404, body: "missing test image" }));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-target")).toHaveText("cat");
  await expect(page.getByTestId("kid-done")).toBeVisible();
});

for (const [visualType, visualData, label] of [
  ["color", { color: "#ff0000" }, "Red"],
  ["number", { count: 3 }, "Three"],
  ["sequence", { position: 2, total: 7, sequenceStart: "Monday" }, "Tuesday"],
] as const) {
  test(`exposure keeps the deterministic ${visualType} visual`, async ({ page }) => {
    const task = taskFor("exposure");
    if (task.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
    task.prompt.target = label;
    task.prompt.imageAssetId = null;
    task.prompt.visualType = visualType;
    task.prompt.visualData = visualData;
    await openTask(page, task);
    await expect(page.locator(`svg.kid-visual[aria-label="${label}"]`)).toBeVisible();
    const visualBounds = await page.locator(`svg.kid-visual[aria-label="${label}"]`).boundingBox();
    expect(visualBounds).not.toBeNull();
    expect(visualBounds!.width).toBeGreaterThan(48);
  });
}

test("long exposure word and example remain complete with the main action reachable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const task = taskFor("exposure");
  if (task.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
  const longWord = "a".repeat(120);
  const longExample = "A long example sentence for careful reading. ".repeat(7).slice(0, 300);
  task.prompt.target = longWord;
  task.prompt.source = "długi przykład";
  task.prompt.example = longExample;
  task.prompt.visualType = "none";
  task.prompt.imageAssetId = null;
  await openTask(page, task);
  await expect(page.getByTestId("kid-target")).toHaveText(longWord);
  await expect(page.getByTestId("kid-example")).toHaveText(longExample);
  await expect(page.getByTestId("kid-done")).toBeInViewport();
});

test("long exposure remains readable from the start of its scrollable material", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const task = taskFor("exposure");
  if (task.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
  task.prompt.target = "a".repeat(120);
  task.prompt.source = "długi przykład";
  task.prompt.example = "A long example sentence for careful reading. ".repeat(7).slice(0, 300);
  task.prompt.visualType = "none";
  task.prompt.imageAssetId = null;
  await openTask(page, task);

  const material = page.getByTestId("kid-material");
  const materialContent = page.locator(".kid-material-content");
  await materialContent.evaluate((element) => { element.scrollTop = 0; });
  const [materialBox, targetBox] = await Promise.all([
    material.boundingBox(),
    page.getByTestId("kid-target").boundingBox(),
  ]);
  expect(materialBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(targetBox!.y).toBeGreaterThanOrEqual(materialBox!.y);
  await materialContent.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const sourceBox = await page.getByTestId("kid-source").boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(sourceBox!.y + sourceBox!.height).toBeLessThanOrEqual(materialBox!.y + materialBox!.height);
});

test("reading prompt retains space beside a short option list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 350 });
  const task = taskFor("reading");
  if (task.prompt.kind !== "reading") throw new Error("invalid reading fixture");
  await openTask(page, task);

  const material = page.getByTestId("kid-material");
  const [materialBox, promptBox] = await Promise.all([
    material.boundingBox(),
    page.getByTestId("kid-word").boundingBox(),
  ]);
  expect(materialBox).not.toBeNull();
  expect(promptBox).not.toBeNull();
  expect(materialBox!.height).toBeGreaterThan(40);
  expect(promptBox!.height).toBeGreaterThan(0);
});

test("large listening action keeps its speaker icon at presentation size", async ({ page }) => {
  const task = taskFor("listening");
  await openTask(page, task);
  const icon = page.locator(".kid-play-big svg");
  await expect(icon).toBeVisible();
  const bounds = await icon.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
});

test("dark theme keeps text controls and notices readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const fixture: KidUiFixture = recallFixture();
  fixture.decks[0]!.mockTestAvailable = true;
  fixture.session = { ...fixture.session, mode: "mock_test" };
  fixture.tasks = [taskFor("spelling")];
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await page.getByTestId("kid-mock-confirm").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();

  const ratios = await page.evaluate(() => {
    const readRgb = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${value}`);
      return channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
    };
    const contrast = (foreground: string, background: string) => {
      const luminance = (color: string) => {
        const [red, green, blue] = readRgb(color);
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const first = luminance(foreground);
      const second = luminance(background);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };
    const styles = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const computed = getComputedStyle(element);
      return { color: computed.color, background: computed.backgroundColor };
    };
    const app = getComputedStyle(document.querySelector<HTMLElement>(".kid-ui")!).backgroundColor;
    const input = styles('[data-testid="kid-input"]');
    const end = styles('[data-testid="kid-end"]');
    const source = styles('[data-testid="kid-source"]');
    const notice = styles(".kid-notice");
    return {
      input: contrast(input.color, input.background),
      end: contrast(end.color, end.background),
      source: contrast(source.color, source.background === "rgba(0, 0, 0, 0)" ? app : source.background),
      notice: contrast(notice.color, notice.background),
    };
  });

  for (const [control, ratio] of Object.entries(ratios)) {
    expect.soft(ratio, `${control} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test("dark theme keeps exposure details and remaining count readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const task = taskFor("exposure");
  if (task.prompt.kind !== "exposure") throw new Error("invalid exposure fixture");
  task.prompt.example = "The cat sleeps on the sofa.";
  await openTask(page, task);
  await expect(page.getByTestId("kid-remaining")).toBeVisible();

  const ratios = await page.evaluate(() => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    const contrast = (foreground: string, background: string) => {
      const lum = (color: string) => {
        const [red, green, blue] = rgb(color);
        return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
      };
      const [first, second] = [lum(foreground), lum(background)];
      return (Math.max(first!, second!) + 0.05) / (Math.min(first!, second!) + 0.05);
    };
    const background = getComputedStyle(document.querySelector<HTMLElement>(".kid-ui")!).backgroundColor;
    return ["kid-source", "kid-example", "kid-remaining"].map((className) => {
      const element = document.querySelector<HTMLElement>(`.${className}`)!;
      return contrast(getComputedStyle(element).color, background);
    });
  });
  for (const [index, ratio] of ratios.entries()) {
    expect.soft(ratio, ["source", "example", "remaining"][index]).toBeGreaterThanOrEqual(4.5);
  }
});

test("long options remain readable and selectable", async ({ page }) => {
  const task = taskFor("reading");
  if (task.prompt.kind !== "reading") throw new Error("invalid reading fixture");
  task.prompt.options[2]!.text = "bardzo długi wariant odpowiedzi z wyjaśnieniem dla dziecka";
  const attempt = {
    attemptId: "10000000-0000-4000-8000-000000000010", taskId, state: "completed" as const,
    modality: "choice" as const, feedback: { kind: "great" as const, correctText: "kot" },
    taskState: "completed" as const, stepId: null, receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z",
  };
  await installKidUiFixture(page, { ...recallFixture(), tasks: [task], attempts: [attempt] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const longOption = page.getByTestId("kid-option").filter({ hasText: task.prompt.options[2]!.text });
  await expect(longOption).toContainText(task.prompt.options[2]!.text);
  await longOption.click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
});

test("written input preserves its value and focus when the viewport shrinks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openTask(page, taskFor("spelling"));
  const input = page.getByTestId("kid-input");
  await input.fill("Monday");
  await input.focus();
  await page.setViewportSize({ width: 390, height: 520 });
  await expect(input).toHaveValue("Monday");
  expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);
});

test("letter input preserves its value and focus when the viewport shrinks", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openTask(page, taskFor("letter_completion"));
  const gap = page.getByTestId("kid-letter-input");
  await gap.fill("a");
  await gap.focus();
  await page.setViewportSize({ width: 390, height: 470 });
  await expect(gap).toHaveValue("a");
  expect(await gap.evaluate((element) => element === document.activeElement)).toBe(true);
});

test("written actions remain reachable at a 350px viewport height", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 350 });
  await openTask(page, taskFor("recall"));
  for (const action of ["kid-submit", "kid-record", "kid-not-remember", "kid-skip"]) {
    if (action === "kid-record") continue; // This fixture disables the microphone.
    const button = page.getByTestId(action);
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId("kid-input")).toBeVisible();
});

for (const recordingMode of ["hold", "toggle"] as const) {
  test(`speech recording honors the ${recordingMode} profile without a child mode picker`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: () => new Promise<MediaStream>(() => undefined) },
      });
      // WR-02: uprawnienie mikrofonu "granted", aby auto-próba mogła sama
      // rozpocząć przygotowanie (wiszący getUserMedia utrzymuje fazę preparing)
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "granted" }) },
      });
    });
    const fixture = recallFixture(recordingMode);
    fixture.session.microphoneEnabled = true;
    await installKidUiFixture(page, { ...fixture, tasks: [taskFor("speech")] });
    await page.goto("/");
    await page.getByTestId("kid-profile").click();
    await page.getByTestId("kid-deck").click();
    await expect(page.getByTestId("kid-record")).toBeVisible();
    await expect(page.getByTestId("kid-record-mode")).toHaveCount(0);
    await expect(page.getByText("Wolisz nacisnąć raz? Zmień tryb")).toHaveCount(0);
    const recordButton = page.getByTestId("kid-record");
    // Auto-próba mowy (quick 261021-lsw): przygotowanie mikrofonu startuje
    // samo po wyświetleniu zadania — data-phase=preparing pojawia się bez
    // kliku i wisi na nie rozwiązującym się getUserMedia
    await expect(recordButton).toHaveAttribute("data-phase", "preparing");
    if (recordingMode === "hold") {
      await expect(recordButton).toContainText("Przytrzymaj");
    } else {
      await expect(recordButton).toContainText("Nagraj");
    }
  });
}

test("a long written answer remains fully available after viewport shrink", async ({ page }) => {
  const task = taskFor("spelling");
  if (task.prompt.kind !== "spelling") throw new Error("invalid spelling fixture");
  task.prompt.prompt = "bardzo długi opis polecenia, który powinien pozostać czytelny przy zmianie wysokości";
  await page.setViewportSize({ width: 360, height: 520 });
  await openTask(page, task);
  const input = page.getByTestId("kid-input");
  const answer = "long-answer-with-every-letter-preserved";
  await input.fill(answer);
  await page.setViewportSize({ width: 360, height: 350 });
  await expect(input).toHaveValue(answer);
  await expect(page.getByTestId("kid-source")).toHaveText(task.prompt.prompt);
  await page.getByTestId("kid-submit").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-submit")).toBeEnabled();
});

for (const kind of ["recall", "spelling", "letter_completion", "speech"] as const) {
  test(`${kind} uses the shared material surface without a nested task card`, async ({ page }) => {
    await openTask(page, taskFor(kind));
    await expect(page.getByTestId("kid-material").locator(".kid-card")).toHaveCount(0);
    if (kind === "recall" || kind === "spelling" || kind === "letter_completion") {
      await expect(page.getByTestId("kid-submit").locator("xpath=ancestor::*[@data-testid='kid-exercise-actions']")).toHaveCount(1);
    }
  });
}

test("speech play action uses the shared speaker icon instead of an emoji", async ({ page }) => {
  await openTask(page, taskFor("speech"));
  const play = page.getByTestId("kid-play");
  await expect(play).toHaveAccessibleName("Posłuchaj");
  await expect(play.locator("svg")).toBeVisible();
  await expect(play).not.toContainText("🔊");
});

test("record control uses the shared microphone icon instead of an emoji", async ({ page }) => {
  // Auto-próba mowy przygotowuje mikrofon zaraz po wyświetleniu zadania;
  // wiszący getUserMedia utrzymuje fazę preparing, więc przycisk (i ikona)
  // pozostaje w DOM deterministycznie — realne API headless odmawia od razu.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => new Promise<MediaStream>(() => undefined) },
    });
  });
  const fixture = recallFixture();
  fixture.session.microphoneEnabled = true;
  await installKidUiFixture(page, { ...fixture, tasks: [taskFor("speech")] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const record = page.getByTestId("kid-record");
  await expect(record.locator("svg")).toBeVisible();
  await expect(record).not.toContainText("🎤");
});

for (const kind of ["reading", "listening"] as const) {
test(`${kind} choice keeps the highlighted option and readable success action in the frame`, async ({ page }) => {
  const task = taskFor(kind);
  const attempt = {
    attemptId: "10000000-0000-4000-8000-000000000010", taskId, state: "completed" as const,
    modality: "choice" as const, feedback: { kind: "great" as const }, taskState: "completed" as const,
    stepId: null, receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z",
  };
  await installKidUiFixture(page, { ...recallFixture(), tasks: [task], attempts: [attempt] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const correct = page.getByTestId("kid-option").first();
  await correct.click();
  await expect(correct).toHaveClass(/kid-option--correct/);
  await expect(correct).toBeDisabled();
  await expect.poll(() => correct.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"✓ "');
  await expect(page.getByTestId("kid-feedback-dock")).toContainText("Świetnie");
  await expect(page.getByTestId("kid-next")).toBeInViewport();
});
}

test("written feedback moves focus out of the answer field without opening a modal", async ({ page }) => {
  const task = taskFor("spelling");
  const attempt = {
    attemptId: "10000000-0000-4000-8000-000000000010", taskId, state: "completed" as const,
    modality: "text" as const, feedback: { kind: "incorrect" as const, correctText: "cat" },
    taskState: "issued" as const, stepId: "feedback-step", receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z",
  };
  await installKidUiFixture(page, { ...recallFixture(), tasks: [task], attempts: [attempt] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const input = page.getByTestId("kid-input");
  await input.fill("wrong");
  await input.focus();
  await page.getByTestId("kid-submit").click();
  const feedback = page.getByTestId("kid-feedback");
  await expect(feedback.getByTestId("kid-feedback-correct-answer")).toHaveText("cat");
  await expect(feedback).not.toHaveJSProperty("open", true);
  await expect(page.getByTestId("kid-next")).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("kid-feedback-title");
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});
