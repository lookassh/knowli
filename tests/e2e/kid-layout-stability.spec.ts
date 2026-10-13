import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const attemptId = "10000000-0000-4000-8000-000000000010";
const optionIds = ["10000000-0000-4000-8000-000000000007", "10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];

function recallFixture() {
  const processing = {
    attemptId,
    taskId,
    state: "processing" as const,
    modality: "text" as const,
    feedback: null,
    taskState: "issued" as const,
    stepId: null,
    receivedAt: "2026-10-11T10:00:00.000Z",
    completedAt: null,
  };
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" as const }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training" as const, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
      policyId: "default", microphoneEnabled: false, state: "active" as const, taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
    attempts: [processing, processing, {
      ...processing,
      state: "completed" as const,
      feedback: { kind: "great" as const },
      taskState: "completed" as const,
      stepId: null,
      completedAt: "2026-10-11T10:00:01.000Z",
    }],
  };
}

function completedRecallFixture() {
  const fixture = recallFixture();
  fixture.attempts = [{
    attemptId,
    taskId,
    state: "completed",
    modality: "text",
    feedback: { kind: "great" },
    taskState: "completed",
    stepId: null,
    receivedAt: "2026-10-11T10:00:00.000Z",
    completedAt: "2026-10-11T10:00:01.000Z",
  }];
  return fixture;
}

function completedReadingFixture() {
  const base = recallFixture();
  return {
    ...base,
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "reading" as const, direction: "target_to_source" as const,
      state: "issued" as const, prompt: { kind: "reading" as const, text: "cat",
        options: ["kot", "pies", "ptak"].map((text, index) => ({ id: optionIds[index]!, text })) }, remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "choice" as const,
      feedback: { kind: "great" as const }, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

test("processing status does not move task slots", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, recallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();

  const bounds = async () => {
    const frame = await page.getByTestId("kid-exercise").boundingBox();
    const instruction = await page.getByTestId("kid-instruction").boundingBox();
    const material = await page.getByTestId("kid-material").boundingBox();
    expect(frame).not.toBeNull();
    expect(instruction).not.toBeNull();
    expect(material).not.toBeNull();
    return { frame: frame!, instruction: instruction!, material: material! };
  };
  const before = await bounds();
  await page.getByTestId("kid-input").fill("cat");
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-processing")).toBeVisible();
  const during = await bounds();

  for (const key of ["frame", "instruction", "material"] as const) {
    expect(Math.abs(during[key].y - before[key].y), `${key} moved vertically during processing`).toBeLessThanOrEqual(2);
    expect(Math.abs(during[key].height - before[key].height), `${key} changed height during processing`).toBeLessThanOrEqual(2);
  }
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
});

test("typing preserves the exercise frame", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await installKidUiFixture(page, recallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const frame = page.getByTestId("kid-exercise");
  const before = await frame.boundingBox();
  await page.getByTestId("kid-input").fill("cat");
  const shortAnswer = await frame.boundingBox();
  await page.getByTestId("kid-input").fill("an exceptionally long answer for the same prompt");
  const longAnswer = await frame.boundingBox();
  expect(before).not.toBeNull();
  expect(shortAnswer).not.toBeNull();
  expect(longAnswer).not.toBeNull();
  for (const after of [shortAnswer!, longAnswer!]) {
    expect(Math.abs(after.y - before!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.height - before!.height)).toBeLessThanOrEqual(2);
  }
});

test("written feedback keeps the material and primary action position", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, completedRecallFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();

  const material = page.getByTestId("kid-material");
  const materialBefore = await material.boundingBox();
  const actionBefore = await page.getByTestId("kid-submit").boundingBox();
  await page.getByTestId("kid-input").fill("cat");
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  const materialAfter = await material.boundingBox();
  const actionAfter = await page.getByTestId("kid-next").boundingBox();

  expect(materialBefore).not.toBeNull();
  expect(materialAfter).not.toBeNull();
  expect(actionBefore).not.toBeNull();
  expect(actionAfter).not.toBeNull();
  expect(Math.abs(materialAfter!.y - materialBefore!.y), "material top moved").toBeLessThanOrEqual(2);
  expect(Math.abs(materialAfter!.height - materialBefore!.height),
    `material height changed from ${materialBefore!.height} to ${materialAfter!.height}`).toBeLessThanOrEqual(2);
  expect(Math.abs(actionAfter!.y - actionBefore!.y),
    `primary action moved from ${actionBefore!.y} to ${actionAfter!.y}`).toBeLessThanOrEqual(2);
});

test("choice feedback keeps each option in place", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, completedReadingFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  const before = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  await options.first().click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie");
  const after = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(after).toHaveLength(before.length);
  after.forEach((box, index) => {
    expect(Math.abs(box.y - before[index]!.y), `option ${index} moved vertically`).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x - before[index]!.x), `option ${index} moved horizontally`).toBeLessThanOrEqual(2);
  });
  await expect(page.getByTestId("kid-next")).toBeInViewport();
});
