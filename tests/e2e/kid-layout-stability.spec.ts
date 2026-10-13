import { expect, test } from "@playwright/test";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

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
  const feedbackFits = await page.getByTestId("kid-exercise-result").evaluate((element) =>
    element.scrollHeight <= element.clientHeight,
  );
  expect(feedbackFits, "one-line feedback should not be internally clipped").toBe(true);
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

test("long choice labels keep their geometry when feedback markers appear", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const fixture = completedReadingFixture();
  const task = fixture.tasks[0]!;
  if (task.prompt.kind !== "reading") throw new Error("reading fixture expected");
  task.prompt.options = [
    { id: optionIds[0]!, text: "mała zielona żaba na kamieniu" },
    { id: optionIds[1]!, text: "zielona papuga siedzi na gałęzi" },
    { id: optionIds[2]!, text: "niebieski motyl" },
  ];
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-exercise")).toBeVisible();

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  const before = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  await options.first().click();
  await expect(options.first()).toHaveClass(/kid-option--correct/);
  const after = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));

  after.forEach((box, index) => {
    expect(Math.abs(box.x - before[index]!.x), `option ${index} moved horizontally`).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - before[index]!.y), `option ${index} moved vertically`).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - before[index]!.height), `option ${index} changed height`).toBeLessThanOrEqual(2);
  });
});

for (const kind of ["recall", "speech"] as const) {
test(`${kind} microphone phases keep exercise controls in place`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    let microphoneCalls = 0;
    const track = { kind: "audio", stop: () => undefined, addEventListener: () => undefined };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    const browserWindow = window as typeof window & { resolveMicrophonePreparation?: () => void };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => {
        microphoneCalls += 1;
        if (microphoneCalls === 1) {
          await new Promise<void>((resolve) => { browserWindow.resolveMicrophonePreparation = resolve; });
        }
        return stream;
      } },
    });
    class FakeMediaRecorder {
      static isTypeSupported(): boolean { return true; }
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start(): void { this.state = "recording"; }
      stop(): void { this.state = "inactive"; this.onstop?.(); }
    }
    (window as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder = FakeMediaRecorder;
  });
  const base = recallFixture();
  const fixture: KidUiFixture = {
    ...base,
    profiles: [{ ...base.profiles[0]!, recordingMode: "toggle" }],
    session: { ...base.session, microphoneEnabled: true },
    tasks: [{
      ...base.tasks[0]!,
      ...(kind === "speech" ? {
        exerciseType: "speech" as const,
        prompt: { kind: "speech" as const, text: "cat", audioAssetId: null, imageAssetId: null, visualType: "none" as const },
      } : {}),
    }],
  };
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-exercise")).toBeVisible();

  const measure = async () => page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    return {
      frame: rect("[data-testid='kid-exercise']"),
      instruction: rect("[data-testid='kid-instruction']"),
      material: rect("[data-testid='kid-material']"),
      primary: rect("[data-testid='kid-primary-slot']"),
      record: rect("[data-testid='kid-record']"),
      input: document.querySelector("[data-testid='kid-input']")
        ? rect("[data-testid='kid-input']")
        : null,
    };
  });
  const before = await measure();
  const record = page.getByTestId("kid-record");
  await record.click();
  await expect(record).toHaveAttribute("data-phase", "preparing");
  const preparing = await measure();
  await page.evaluate(() => {
    const browserWindow = window as typeof window & { resolveMicrophonePreparation?: () => void };
    browserWindow.resolveMicrophonePreparation?.();
  });
  await expect(record).toHaveAttribute("data-ready", "true");
  await record.click();
  await expect(record).toHaveAttribute("data-phase", "recording");
  const recording = await measure();

  for (const phase of [preparing, recording]) {
    for (const key of ["frame", "instruction", "material", "primary", "record"] as const) {
      expect(Math.abs(phase[key].x - before[key].x), `${key} moved horizontally`).toBeLessThanOrEqual(2);
      expect(Math.abs(phase[key].y - before[key].y), `${key} moved vertically while microphone was ${key === "record" ? "used" : "active"}`).toBeLessThanOrEqual(2);
      expect(Math.abs(phase[key].height - before[key].height), `${key} changed height`).toBeLessThanOrEqual(2);
    }
    if (before.input !== null && phase.input !== null) {
      expect(Math.abs(phase.input.x - before.input.x), "written input moved horizontally").toBeLessThanOrEqual(2);
      expect(Math.abs(phase.input.y - before.input.y), "written input moved vertically while recording").toBeLessThanOrEqual(2);
      expect(Math.abs(phase.input.height - before.input.height), "written input changed height").toBeLessThanOrEqual(2);
    }
  }
  await page.keyboard.press("Escape");
});
}
