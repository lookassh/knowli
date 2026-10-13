import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const attemptId = "10000000-0000-4000-8000-000000000010";

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
