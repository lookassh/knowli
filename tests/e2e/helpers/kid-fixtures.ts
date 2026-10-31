import type { FeedbackDto, KidDeckDto } from "@learning/contracts";
import type { Page } from "@playwright/test";
import { installKidUiFixture } from "./kid-ui-fixture";

/** Shared builders of mocked Kid UI sessions: one profile, one deck, a written recall task. */

export const childId = "10000000-0000-4000-8000-000000000001";
export const deckId = "10000000-0000-4000-8000-000000000002";
export const sessionId = "10000000-0000-4000-8000-000000000003";
export const taskId = "10000000-0000-4000-8000-000000000004";
export const attemptId = "10000000-0000-4000-8000-000000000010";

export function baseFixture() {
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" as const }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training" as const, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
      policyId: "default", microphoneEnabled: false, state: "active" as const, taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
  };
}

/** A written recall task answered by one completed attempt; `feedback` is what the dock shows. */
export function completedRecallFixture({ feedback = { kind: "great" } }: { feedback?: FeedbackDto } = {}) {
  return {
    ...baseFixture(),
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "text" as const,
      feedback, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

export function makeDeck(index: number, options: Partial<KidDeckDto> = {}): KidDeckDto {
  return {
    deckId: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    title: `Angielski zestaw ${index + 1}`,
    itemCount: 12,
    independentlyRecalledCount: 3,
    testDate: "2026-10-23",
    recommended: index % 2 === 0,
    mockTestAvailable: true,
    activeSession: null,
    ...options,
  };
}

/** Opens the deck screen of a single profile with the given decks (no task is issued). */
export async function openDeckScreen(page: Page, decks: KidDeckDto[]) {
  page.setDefaultTimeout(5_000);
  await installKidUiFixture(page, {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" }],
    decks,
    session: { mode: "training", sessionId, childId, deckId: decks[0]?.deckId ?? makeDeck(0).deckId,
      deckVersionId: "10000000-0000-4000-8000-000000000004", policyId: "default", microphoneEnabled: false,
      state: "active", taskBudget: 1, tasksIssued: 0, assessedTasksIssued: 0,
      startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
    tasks: [],
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
}
