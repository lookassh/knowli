import { expect, test, type Page } from "@playwright/test";
import type { SessionActivityReport } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";

const summary = {
  sessionId, state: "completed" as const, tasksIssued: 1, assessedTasksIssued: 1,
  endedAt: "2026-10-16T10:01:00.000Z", independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
  activity: { status: "evaluated" as const, pointsAwarded: 2, errorCode: null },
};

async function openWrittenTask(page: Page, onEndSession: (report: SessionActivityReport) => void) {
  await page.clock.install();
  await installKidUiFixture(page, {
    profiles: [{ childId, displayName: "Ola", avatarKey: "cat", recordingMode: "hold" }],
    decks: [{ deckId, title: "Zwierzęta", itemCount: 1, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training", sessionId, childId, deckId,
      deckVersionId: "10000000-0000-4000-8000-000000000005", policyId: "default", microphoneEnabled: false,
      state: "active", taskBudget: 1, tasksIssued: 1, assessedTasksIssued: 1,
      startedAt: "2026-10-16T10:00:00.000Z", resumed: false },
    tasks: [
      { taskId, sessionId, ordinal: 0, exerciseType: "recall" as const,
        direction: "source_to_target" as const, state: "issued" as const,
        prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 },
      null,
    ],
    attempts: [{
      attemptId: "10000000-0000-4000-8000-000000000006", taskId, state: "completed" as const,
      modality: "text" as const, feedback: { kind: "great" as const }, taskState: "completed" as const,
      stepId: `${taskId}:s1`, receivedAt: "2026-10-16T10:00:30.000Z", completedAt: "2026-10-16T10:00:30.000Z",
    }],
    summary,
    onEndSession,
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

test("editing and ending the session freezes one local report with points for the child", async ({ page }) => {
  const reports: SessionActivityReport[] = [];
  await openWrittenTask(page, (report) => { reports.push(report); });
  const input = page.getByTestId("kid-input");
  await input.fill("c");
  await input.fill("ca");
  await input.fill("cat");
  await page.getByTestId("kid-submit").click();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-summary-reward")).toContainText("Zdobyto 2 pkt");

  expect(reports).toHaveLength(1);
  const report = reports[0]!;
  expect(report.version).toBe(1);
  expect(report.tasks).toHaveLength(1);
  expect(report.tasks[0]!.taskId).toBe(taskId);
  expect(report.tasks[0]!.editCount).toBeGreaterThanOrEqual(3);
  expect(report.tasks[0]!.submittedAttempts).toHaveLength(1);
  // Ruch sieciowy pomiaru nie istnieje: raport poszedł wyłącznie z żądaniem końca.
});

test("background blur becomes an explicit pause in the frozen report", async ({ page }) => {
  const reports: SessionActivityReport[] = [];
  await openWrittenTask(page, (report) => { reports.push(report); });
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
  });
  const input = page.getByTestId("kid-input");
  await input.fill("cat");
  await page.getByTestId("kid-submit").click();
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  const pauses = reports[0]!.tasks[0]!.pauses;
  expect(pauses.some((pause) => pause.kind === "blur" || pause.kind === "technical_wait")).toBe(true);
});
