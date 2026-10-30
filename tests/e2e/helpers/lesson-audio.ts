import { expect, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import type { KidUiFixture } from "./kid-ui-fixture";

/**
 * Wspólne kroki speców odsłuchu lekcji szkolnej (API zaślepione w przeglądarce):
 * „Posłuchaj pytania” (design szkoły §11.4) i „Posłuchaj karty” (§12.4).
 */

export const LESSON_AUDIO_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

export interface LessonAudioIds {
  childId: string;
  deckId: string;
  sessionId: string;
  deckVersionId: string;
}

/**
 * Sesja treningowa lekcji z podanymi zadaniami. `audioReady: false` — fixture
 * odpowiada na `/media` obrazkiem SVG, którego odtwarzacz nie zdekoduje (błąd
 * odtwarzania); inaczej prawidłowym WAV-em.
 */
export function lessonAudioFixture(ids: LessonAudioIds, tasks: TaskDto[], options: { audioReady?: boolean; assessedTasksIssued?: number } = {}): KidUiFixture {
  const { childId, deckId, sessionId, deckVersionId } = ids;
  const deck = {
    deckId, kind: "lesson" as const, title: "Pająki", subjectTitle: "Przyroda", itemCount: 6, testDate: null,
    independentlyRecalledCount: 0, recommended: true, mockTestAvailable: false, activeSession: null,
  };
  const session = {
    sessionId, childId, deckId, deckVersionId, mode: "training" as const, state: "active" as const, policyId: "lesson-default",
    microphoneEnabled: false, taskBudget: 3, tasksIssued: 1, assessedTasksIssued: options.assessedTasksIssued ?? 1,
    startedAt: "2026-10-30T10:00:00.000Z", resumed: false,
  };
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [deck],
    session,
    tasks,
    uiAudio: { ready: options.audioReady ?? true, assets: {} },
  };
}

/** Po `installKidUiFixture` otwiera pierwsze zadanie sesji w portrecie i czeka na `readyTestId`. */
export async function openLessonTask(page: Page, readyTestId: string): Promise<void> {
  await page.setViewportSize(LESSON_AUDIO_VIEWPORTS[0]!);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId(readyTestId)).toBeVisible();
}

/**
 * Przy 320×480 każdy element da się przewinąć do widoku w całości, bez
 * poziomego przepełnienia strony; `minHeights` — minimalny cel dotykowy.
 */
export async function expectReachableOnSmallPhone(page: Page, minHeights: Record<string, number>): Promise<void> {
  for (const [testId, minHeight] of Object.entries(minHeights)) {
    const element = page.getByTestId(testId);
    await element.scrollIntoViewIfNeeded();
    const bounds = (await element.boundingBox())!;
    expect(bounds.y, `${testId} top`).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height, `${testId} bottom`).toBeLessThanOrEqual(481);
    expect(bounds.x + bounds.width, `${testId} right`).toBeLessThanOrEqual(321);
    expect(bounds.height, `${testId} height`).toBeGreaterThanOrEqual(minHeight);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
