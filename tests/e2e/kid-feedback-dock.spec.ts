import { expect, test } from "@playwright/test";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const attemptId = "10000000-0000-4000-8000-000000000010";
const optionIds = ["10000000-0000-4000-8000-000000000007", "10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];

function baseFixture() {
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" as const }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training" as const, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
      policyId: "default", microphoneEnabled: false, state: "active" as const, taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
  };
}

function completedRecallFixture() {
  return {
    ...baseFixture(),
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "text" as const,
      feedback: { kind: "great" as const }, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

function completedReadingFixture() {
  return {
    ...baseFixture(),
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "reading" as const, direction: "target_to_source" as const,
      state: "issued" as const, prompt: { kind: "reading" as const, text: "cat",
        options: ["kot", "pies", "ptak"].map((text, index) => ({ id: optionIds[index]!, text })) }, remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "choice" as const,
      feedback: { kind: "great" as const }, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

async function openTask(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-exercise")).toBeVisible();
}

test("written feedback appears in a dock without replacing the stimulus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installKidUiFixture(page, completedRecallFixture());
  await openTask(page);

  const materialBefore = await page.getByTestId("kid-material").boundingBox();
  await page.getByTestId("kid-input").fill("cat");
  await page.getByTestId("kid-submit").click();

  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("kid-feedback")).toBeVisible();
  await expect(dock.getByTestId("kid-next")).toBeVisible();
  // Bodziec zadania pozostaje w widoku po ocenie.
  await expect(page.getByTestId("kid-source")).toHaveText("kot");
  const materialAfter = await page.getByTestId("kid-material").boundingBox();
  expect(Math.abs(materialAfter!.y - materialBefore!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(materialAfter!.x - materialBefore!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(materialAfter!.height - materialBefore!.height)).toBeLessThanOrEqual(2);
  // Dokładnie jedna główna akcja w docku i dock w całości w viewporcie.
  await expect(dock.getByTestId("kid-next")).toHaveCount(1);
  await expect.poll(async () => {
    const box = await dock.boundingBox();
    return box ? Math.round(box.y + box.height) : Number.POSITIVE_INFINITY;
  }, { message: "dock settles within the viewport after its transition" }).toBeLessThanOrEqual(845);
  await expect(page.getByTestId("kid-next")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("choice feedback dock does not overlap the options", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await installKidUiFixture(page, completedReadingFixture());
  await openTask(page);

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  const before = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  await options.first().click();

  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie");
  await expect.poll(async () => {
    const box = await dock.boundingBox();
    return box ? Math.abs(box.y + box.height - 640) : Number.POSITIVE_INFINITY;
  }, { message: "dock settles at the viewport bottom" }).toBeLessThanOrEqual(24);
  const after = await options.evaluateAll((elements) => elements.map((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  after.forEach((box, index) => {
    expect(Math.abs(box.y - before[index]!.y), `option ${index} moved`).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x - before[index]!.x), `option ${index} moved`).toBeLessThanOrEqual(2);
  });
  const dockBox = await dock.boundingBox();
  const lastOption = after.at(-1)!;
  expect(dockBox!.y).toBeGreaterThanOrEqual(lastOption.y + lastOption.height - 1);
  await expect(dock.getByTestId("kid-next")).toBeInViewport();
});

test("incorrect written feedback retries with an empty, focused input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = completedRecallFixture();
  fixture.attempts = [{ ...fixture.attempts[0]!, feedback: { kind: "incorrect" as const, correctText: "cat" }, taskState: "issued" as const }] as unknown as typeof fixture.attempts;
  await installKidUiFixture(page, fixture);
  await openTask(page);

  await page.getByTestId("kid-input").fill("dog");
  await page.getByTestId("kid-submit").click();
  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute("data-tone", "incorrect");
  await dock.getByTestId("kid-next").click();
  await expect(dock).toHaveCount(0);
  await expect(page.getByTestId("kid-input")).toHaveValue("");
  await expect(page.getByTestId("kid-input")).toBeFocused();
  await expect(page.getByTestId("kid-submit")).toBeDisabled();
});

test("choice feedback dock fits tablet and desktop viewports", async ({ page }) => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    await installKidUiFixture(page, completedReadingFixture());
    await openTask(page);
    await page.getByTestId("kid-option").first().click();
    const dock = page.getByTestId("kid-feedback-dock");
    await expect(dock).toBeVisible();
    await expect(dock.getByTestId("kid-next")).toBeInViewport();
    await expect.poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.round(box.y + box.height) : 99999;
    }, { message: "dock settles within the viewport" }).toBeLessThanOrEqual(viewport.height + 1);
    const geometry = await page.evaluate(() => {
      const dockBox = document.querySelector<HTMLElement>("[data-testid='kid-feedback-dock']")!.getBoundingClientRect();
      const options = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((el) => el.getBoundingClientRect());
      return { dockTop: dockBox.top, dockBottom: dockBox.bottom, lastOptionBottom: Math.max(...options.map((b) => b.bottom)), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    expect(geometry.dockTop, JSON.stringify({ viewport, geometry })).toBeGreaterThanOrEqual(geometry.lastOptionBottom - 1);
    expect(geometry.dockBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(geometry.overflow).toBe(false);
  }
});

test("dock stays reachable after the viewport shrinks and long feedback fits a small screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = completedRecallFixture();
  fixture.attempts = [{ ...fixture.attempts[0]!, feedback: { kind: "incorrect" as const, correctText: "antidisestablishmentarianism" }, taskState: "issued" as const }] as unknown as typeof fixture.attempts;
  await installKidUiFixture(page, fixture);
  await openTask(page);
  await page.getByTestId("kid-input").fill("dog");
  await page.getByTestId("kid-submit").click();
  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("kid-next")).toBeInViewport();

  // Klawiatura ekranowa / rotacja: materiał zmienia rozmiar i korekta
  // musi policzyć się jeszcze raz dla tego samego docka.
  const scrollBeforeShrink = await page.evaluate(() => document.querySelector<HTMLElement>("[data-testid='kid-material']")!.scrollTop);
  await page.setViewportSize({ width: 390, height: 480 });
  await expect.poll(async () => {
    const dockBox = await dock.boundingBox();
    const inputBox = await page.getByTestId("kid-input").boundingBox();
    if (!dockBox || !inputBox) return 9999;
    return Math.round(Math.max(dockBox.y + dockBox.height - 480, inputBox.y + inputBox.height - dockBox.y));
  }, { message: "dock and input settle above each other after the shrink" }).toBeLessThanOrEqual(1);
  await expect(dock.getByTestId("kid-next")).toBeInViewport();
  await expect(dock.getByTestId("kid-next")).toBeEnabled();
  // Dowód ponownej korekty: materiał faktycznie przewinął się po zmianie rozmiaru.
  const scrollAfterShrink = await page.evaluate(() => document.querySelector<HTMLElement>("[data-testid='kid-material']")!.scrollTop);
  expect(scrollAfterShrink, "material scrolls when the viewport shrinks under the dock").toBeGreaterThan(scrollBeforeShrink);
  const padAfterShrink = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>(".kid-material-content")!).paddingBottom));
  expect(padAfterShrink, "dock reserve (padding) is applied after the shrink").toBeGreaterThanOrEqual(24);

  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(async () => {
    const dockBox = await dock.boundingBox();
    return dockBox ? Math.round(dockBox.y + dockBox.height) : 99999;
  }, { message: "long feedback dock settles within 360x640" }).toBeLessThanOrEqual(641);
  await expect(dock.getByTestId("kid-next")).toBeInViewport();
});

test("feedback dock stays reachable on a short landscape screen with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 640, height: 360 });
  await installKidUiFixture(page, completedRecallFixture());
  await openTask(page);

  await page.getByTestId("kid-input").fill("cat");
  await page.getByTestId("kid-submit").click();

  const dock = page.getByTestId("kid-feedback-dock");
  await expect(dock).toBeVisible();
  await expect(dock.getByTestId("kid-next")).toBeInViewport();
  await expect(dock.getByTestId("kid-next")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const animation = await dock.evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(animation.name === "none" || animation.duration === "0s", JSON.stringify(animation)).toBe(true);
});
