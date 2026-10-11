import { expect as baseExpect, test } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";

const expect = baseExpect.configure({ timeout: 1_500 });

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const assetId = "10000000-0000-4000-8000-000000000006";
const optionIds = ["10000000-0000-4000-8000-000000000007", "10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];

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
