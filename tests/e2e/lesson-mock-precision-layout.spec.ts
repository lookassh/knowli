import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, KidDeckDto, KidProfileDto, LessonMockTestSummaryDto, SessionDto, SessionSummaryDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * Geometria omówienia kartkówki szkolnej z wymiarem precyzji (design §8.2–8.3,
 * API zaślepione w przeglądarce): wskazówka przy odpowiedzi otwartej i lista
 * „Warto powtórzyć”. W portrecie, niskim landscape, na tablecie i desktopie
 * treść mieści się w szerokości ekranu bez przepełnienia, tekst nie jest
 * ucinany, a przycisk „Poćwicz” jest osiągalny przez scroll i ma ≥54 px.
 * Symulacja nie zastępuje odbioru na fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000701";
const deckId = "10000000-0000-4000-8000-000000000702";
const sessionId = "10000000-0000-4000-8000-000000000703";
const versionId = "10000000-0000-4000-8000-000000000704";
const taskId = "10000000-0000-4000-8000-000000000711";
const attemptId = "10000000-0000-4000-8000-000000000721";

const QUESTION = "Na czym polega fotosynteza i dlaczego jest ważna dla organizmów żyjących na Ziemi?";
const ANSWER = "Kiedyś na wycieczce w lesie pani mówiła nam dużo o drzewach i wtedy zapamiętałem, że roślina w świetle robi z wody i dwutlenku węgla cukier i tlen, którym oddychamy.";
const HINT = "Dobrze! Następnym razem spróbuj krócej.";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const profile: KidProfileDto = { childId, displayName: "Ola", avatarKey: "fox", recordingMode: "hold" };
const deck: KidDeckDto = {
  deckId, title: "Przyroda: Rośliny", itemCount: 0, independentlyRecalledCount: 0, testDate: null,
  recommended: true, mockTestAvailable: true, activeSession: null, kind: "lesson", subjectTitle: "Przyroda",
};
const session: SessionDto = {
  mode: "mock_test", sessionId, childId, deckId, deckVersionId: versionId, policyId: "lesson-default",
  microphoneEnabled: false, state: "active", taskBudget: 1, tasksIssued: 0, assessedTasksIssued: 0,
  startedAt: "2026-10-29T10:00:00.000Z", resumed: false,
};
const openTask: TaskDto = {
  taskId, sessionId, ordinal: 0, exerciseType: "lesson_open_answer", direction: null, state: "issued", remainingAssessed: 1,
  prompt: { kind: "lesson_open_answer", instructionPl: "Odpowiedz własnymi słowami.", prompt: QUESTION, promptLocale: "pl-PL" },
};
const attempt: AttemptDto = {
  attemptId, taskId, state: "completed", modality: "text", feedback: null, taskState: "answered", stepId: null,
  receivedAt: "2026-10-29T10:00:30.000Z", completedAt: "2026-10-29T10:00:30.000Z",
};
const lessonSummary: LessonMockTestSummaryDto = {
  sessionId, deckId, state: "completed", complete: true, taskBudget: 1, answeredCount: 1,
  solutions: [{
    taskId, objectiveId: "school.d.fotosynteza", titlePl: "Fotosynteza", exerciseType: "lesson_open_answer",
    prompt: QUESTION, childAnswer: ANSWER, correctAnswer: "Roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry i tlen.",
    outcome: "correct", hintPl: HINT,
  }],
  reviewObjectives: [
    { objectiveId: "school.d.oddychanie", titlePl: "Oddychanie roślin i rola tlenu w życiu organizmów" },
    { objectiveId: "school.d.korzenie", titlePl: "Korzenie" },
  ],
};
const summary: SessionSummaryDto = {
  sessionId, state: "ended", tasksIssued: 1, assessedTasksIssued: 1,
  independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [], endedAt: "2026-10-29T10:01:00.000Z",
};

async function reachSummary(page: Page): Promise<void> {
  await installKidUiFixture(page, {
    profiles: [profile], decks: [deck], session, tasks: [openTask, null], attempts: [attempt], lessonMockSummary: lessonSummary, summary,
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await page.getByTestId("kid-mock-confirm").click();
  await page.getByTestId("kid-lesson-input").fill(ANSWER);
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.getByTestId("kid-lesson-mock-summary")).toBeVisible();
}

async function expectInsideWidth(page: Page, testId: string, width: number, label: string): Promise<void> {
  const box = (await page.getByTestId(testId).first().boundingBox())!;
  expect(box.x, `${testId} left at ${label}`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${testId} right at ${label}`).toBeLessThanOrEqual(width + 1);
  expect(await page.getByTestId(testId).first().evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${testId} clipped at ${label}`).toBe(true);
}

for (const viewport of VIEWPORTS) {
  test(`school mock review shows the precision hint and objectives to review at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await reachSummary(page);
    const label = `${viewport.width}x${viewport.height}`;

    await expect(page.getByTestId("kid-lesson-mock-hint")).toHaveText(HINT);
    await expect(page.getByRole("region", { name: "Warto powtórzyć" })).toContainText("Oddychanie roślin");
    // Wskazówka leży w wierszu swojego rozwiązania.
    const row = (await page.getByTestId("kid-lesson-mock-solution").boundingBox())!;
    const hint = (await page.getByTestId("kid-lesson-mock-hint").boundingBox())!;
    expect(hint.y, `hint inside row at ${label}`).toBeGreaterThanOrEqual(row.y - 1);
    expect(hint.x, `hint inside row at ${label}`).toBeGreaterThanOrEqual(row.x - 1);
    expect(hint.x + hint.width, `hint inside row at ${label}`).toBeLessThanOrEqual(row.x + row.width + 1);
    expect(hint.y + hint.height, `hint inside row at ${label}`).toBeLessThanOrEqual(row.y + row.height + 1);

    for (const testId of ["kid-lesson-mock-solution", "kid-lesson-mock-hint", "kid-lesson-mock-review"]) {
      await expectInsideWidth(page, testId, viewport.width, label);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);

    // „Warto powtórzyć” osiągalne przez scroll i w całości na ekranie.
    const reviewSection = page.getByTestId("kid-lesson-mock-review");
    await reviewSection.scrollIntoViewIfNeeded();
    await expect(reviewSection).toBeInViewport();

    // Akcja dodatkowa (zmiana profilu) z celem ≥48 px.
    const profiles = page.getByRole("button", { name: "Kto się dziś uczy?" });
    await profiles.scrollIntoViewIfNeeded();
    const secondary = (await profiles.boundingBox())!;
    expect(secondary.height, `profiles height at ${label}`).toBeGreaterThanOrEqual(48);
    expect(secondary.width, `profiles width at ${label}`).toBeGreaterThanOrEqual(48);

    // Główna akcja osiągalna (scroll) i duża.
    const practice = page.getByTestId("kid-lesson-mock-practice");
    await practice.scrollIntoViewIfNeeded();
    const action = (await practice.boundingBox())!;
    expect(action.height, `practice height at ${label}`).toBeGreaterThanOrEqual(54);
    expect(action.y, `practice visible at ${label}`).toBeGreaterThanOrEqual(-1);
    expect(action.y + action.height, `practice visible at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
  });
}
