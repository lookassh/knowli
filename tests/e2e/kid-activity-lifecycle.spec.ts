import { expect, test, type Page } from "@playwright/test";
import type { RewardActivitySignal } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";

async function openWrittenTask(page: Page, onActivitySignal: NonNullable<KidUiFixture["onActivitySignal"]>) {
  await page.clock.install();
  await installKidUiFixture(page, {
    profiles: [{ childId, displayName: "Ola", avatarKey: "cat", recordingMode: "hold" }],
    decks: [{ deckId, title: "Zwierzęta", itemCount: 1, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training", sessionId, childId, deckId,
      deckVersionId: "10000000-0000-4000-8000-000000000005", policyId: "default", microphoneEnabled: false,
      state: "active", taskBudget: 1, tasksIssued: 1, assessedTasksIssued: 1,
      startedAt: "2026-10-16T10:00:00.000Z", resumed: false },
    // Visibility refresh reads the same issued task, as the real API does.
    tasks: Array.from({ length: 3 }, () => ({ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const,
      direction: "source_to_target" as const, state: "issued" as const,
      prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 })),
    onActivitySignal,
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

test("browser lifecycle pauses reward signals in background and resumes the visible task", async ({ page }) => {
  const signals: RewardActivitySignal[] = [];
  await openWrittenTask(page, (signal) => { signals.push(signal); });
  await expect.poll(() => signals.some((signal) => signal.kind === "takeover")).toBe(true);
  await page.clock.runFor(15_000);
  await expect.poll(() => signals.at(-1)?.kind).toBe("heartbeat");

  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
  });
  await expect.poll(() => signals.at(-1)?.pauseReason).toBe("blur");
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);
  const afterBlur = signals.length;
  await page.clock.runFor(45_000);
  expect(signals).toHaveLength(afterBlur);

  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    window.dispatchEvent(new Event("focus"));
  });
  // Resuming after lifecycle pause claims a fresh server stream; it cannot
  // renew the prior tab's stream after another device may have taken over.
  await expect.poll(() => signals.at(-1)?.kind).toBe("takeover");
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);
  await page.clock.runFor(15_000);
  await expect.poll(() => signals.at(-1)?.kind).toBe("heartbeat");

  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => signals.at(-1)?.pauseReason).toBe("background");
  const afterHide = signals.length;
  // A delayed focus event must not make a hidden document eligible for credit.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(45_000);
  expect(signals).toHaveLength(afterHide);
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);

  const beforeVisibleWithoutFocus = signals.length;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(45_000);
  expect(signals).toHaveLength(beforeVisibleWithoutFocus);
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);
  await expect.poll(() => signals.length).toBeGreaterThan(afterHide);
  await page.clock.runFor(15_000);
  await expect.poll(() => signals.at(-1)?.kind).toBe("heartbeat");
});

test("editing a written answer signals activity beyond a minute and resumes an idle pause", async ({ page }) => {
  const signals: RewardActivitySignal[] = [];
  let replyIdle = false;
  await openWrittenTask(page, (signal) => {
    signals.push(signal);
    if (replyIdle && signal.kind === "heartbeat") return {
      streamId: signal.streamId, sequence: signal.sequence, acceptedAt: new Date().toISOString(),
      paused: true, pauseReason: "idle",
    };
    if (signal.kind === "interaction") replyIdle = false;
  });
  await expect.poll(() => signals.some((signal) => signal.kind === "takeover")).toBe(true);
  const interactions = () => signals.filter((signal) => signal.kind === "interaction");
  const input = page.getByTestId("kid-input");
  await input.fill("c");
  await expect.poll(() => interactions().length).toBe(1);
  await input.fill("ca");
  await input.fill("cat");
  expect(interactions()).toHaveLength(1);

  for (let index = 1; index <= 5; index += 1) {
    await page.clock.runFor(15_000);
    await input.fill(`cat${index}`);
    await expect.poll(() => interactions().length).toBe(index + 1);
  }
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);

  // The server is the authority for idle; this fixture supplies its verdict,
  // without reimplementing credited-time calculations in a browser test.
  replyIdle = true;
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);
  const beforeResume = interactions().length;
  await input.fill("cat");
  await expect.poll(() => interactions().length).toBe(beforeResume + 1);
  await expect(page.getByTestId("kid-activity-paused")).toHaveCount(0);
  expect(await input.inputValue()).toBe("cat");
});
