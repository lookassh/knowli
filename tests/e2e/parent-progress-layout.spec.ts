import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Postępy i Karta pracy na Mantine (plan 2026-10-29-parent-ui-mantine, faza 4):
 * telefon bez przewijania strony w poziomie (wybór dziecka przewija się sam),
 * paski umiejętności pod nazwą na telefonie, tryb ciemny i rozwijane
 * szczegóły oceny sesji. API rodzica zaślepione w przeglądarce.
 */

const deckId = "00000000-0000-4000-8000-000000000003";
const children = ["Ala", "Bartłomiej", "Cecylia", "Dominika", "Eustachy"].map((displayName, index) => ({
  id: `00000000-0000-4000-8000-00000000001${index}`, displayName, avatarKey: "fox", recordingMode: "hold", canRead: true,
}));
const skills = { listening: "mastered", reading: "practicing", recall: "needs_confirmation", pronunciation: "not_assessed", spelling: "practicing" };

const progress = {
  childId: children[0]!.id, childName: "Ala", deckId, deckTitle: "Dni tygodnia i bardzo długi tytuł zestawu", testDate: "2026-11-03",
  totalItems: 1, skills: [], confusions: [{ expected: "Monday", answered: "Tuesday", count: 2 }],
  history: [{ receivedAt: "2026-10-28T10:00:00.000Z", source: "poniedziałek", target: "Monday", skill: "recall", outcome: "correct", independent: true, modality: "text" }],
  pronunciation: { assessed: true, latestScores: [{ target: "Wednesday", score: 74, band: "partial", provider: "azure", assessedAt: "2026-10-28T10:00:00.000Z" }] },
  activity: {
    days: 7, activeSeconds: 600, activeDays: 1, sessions: 1, answers: 12, interactions: 30,
    decks: [{ deckId, deckTitle: "Dni tygodnia", sessions: 1 }],
    daily: ["08", "09", "10", "11", "12", "13", "14"].map((day) => ({ date: `2026-10-${day}`, activeSeconds: day === "14" ? 600 : 0, sessions: day === "14" ? 1 : 0 })),
  },
  items: [{ itemId: "00000000-0000-4000-8000-000000000005", position: 0, source: "poniedziałek", target: "Monday", meaningChanged: false, skills }],
};

function response(overrides: Record<string, unknown> = {}) {
  return { modality: "text", answerExample: "monday", feedbackKind: "great", assessment: "assessed", outcome: "correct", responseSeconds: 4, ...overrides };
}

function step(n: number, exerciseType: string, state: string, responses: unknown[]) {
  return { taskId: `00000000-0000-4000-8000-0000000000${30 + n}`, ordinal: n - 2, exerciseType, state, issuedAt: "2026-10-16T10:00:05.000Z", responses };
}

const workCard = {
  childId: children[0]!.id, date: "2026-10-16", creditedSeconds: 180, unevaluatedSessions: 0, reviewService: "review.example · model-a",
  sessions: [{
    sessionId: "00000000-0000-4000-8000-000000000031", mode: "training", state: "completed",
    startedAt: "2026-10-16T10:00:00.000Z", endedAt: "2026-10-16T10:06:00.000Z", deckTitle: "Dni tygodnia", deckVersionNumber: 3, remainingSteps: 0,
    activity: {
      status: "evaluated", durationSeconds: 360, activeSeconds: 300, approvedSeconds: 180, pointsAwarded: 3, reason: "Rzeczywiste próby.", errorCode: null,
      excludedTasks: [{ taskOrdinal: 1, reason: "Wysłano wyłącznie aaa." }], details: null,
    },
    steps: [
      step(2, "exposure", "completed", []),
      step(3, "recall", "answered", [response({ answerExample: "monday", feedbackKind: "great", outcome: "correct" })]),
      step(4, "spelling", "answered", [response({ answerExample: "tuesdey", feedbackKind: "incorrect", outcome: "incorrect", responseSeconds: 9 })]),
      step(5, "recall", "answered", [response({ answerExample: "wednesday", feedbackKind: "capitalization_hint", outcome: "partial" })]),
      step(6, "recall", "answered", [response({ modality: "dont_remember", answerExample: "Nie pamiętam", feedbackKind: null, assessment: "none", outcome: null })]),
      step(7, "listening", "skipped", [response({ modality: "skip", answerExample: null, feedbackKind: null, assessment: "none", outcome: null })]),
      step(8, "spelling", "completed", [
        response({ answerExample: "fridey", feedbackKind: "incorrect", outcome: "incorrect" }),
        response({ answerExample: "friday", feedbackKind: "great", outcome: "correct" }),
      ]),
    ],
  }],
};

async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/v1/parent/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (path.endsWith("/children")) return route.fulfill({ json: children });
    if (path.endsWith("/decks")) return route.fulfill({ json: [{ deckId, title: progress.deckTitle, state: "published", editableVersionId: null, publishedVersionId: deckId }] });
    if (path.endsWith("/progress")) return route.fulfill({ json: progress });
    if (path.endsWith("/mock-tests")) return route.fulfill({ json: [] });
    if (path.endsWith("/work-card")) return route.fulfill({ json: workCard });
    return route.fulfill({ json: [] });
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("Postępy na telefonie: bez przewijania w poziomie, paski pod nazwą umiejętności", async ({ page }) => {
  await mockApi(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/parent/progress");
    await expect(page.getByTestId("progress-heading")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // pięcioro dzieci nie mieści się w rzędzie: przewija się sam wybór, nie strona
    const picker = page.getByTestId("progress-child");
    expect(await picker.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    for (const option of await picker.getByTestId("progress-child-option").all()) {
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    const bar = (await page.getByTestId("progress-skill-listening").boundingBox())!;
    const name = (await page.getByTestId("progress-skills").getByText(messages.progress.skills.listening).boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
    expect(bar.width).toBeGreaterThan(viewport.width * 0.6);
  }
});

test("Postępy w trybie ciemnym: karty i kropki stanów na ciemnym tle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await mockApi(page);
  await page.goto("/parent/progress");
  const card = page.getByTestId("progress-skills");
  await expect(card).toBeVisible();
  const [r, g, b] = (await card.evaluate((element) => getComputedStyle(element).backgroundColor)).match(/\d+/g)!.map(Number);
  expect(r! + g! + b!).toBeLessThan(3 * 80);
  const text = await page.getByTestId("progress-heading").evaluate((element) => getComputedStyle(element).color);
  const [tr, tg, tb] = text.match(/\d+/g)!.map(Number);
  expect(tr! + tg! + tb!).toBeGreaterThan(3 * 180);
});

test("Karta pracy na telefonie: bez przewijania w poziomie, szczegóły oceny rozwijane", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/parent/work-card");
  await expect(page.getByTestId("work-card-credited")).toHaveText("3 min 0 s");
  await expect(page.getByLabel(messages.workCard.dateLabel)).toHaveValue("2026-10-16");
  // pole daty ma własną ramkę Mantine (stara reguła panelu bez zakresu ją zdejmowała)
  const border = await page.getByLabel(messages.workCard.dateLabel).evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.borderTopWidth, color: style.borderTopColor };
  });
  expect(border.width).toBe("1px");
  expect(border.color).not.toBe("rgba(0, 0, 0, 0)");
  await expectNoHorizontalOverflow(page);

  const toggle = page.getByRole("button", { name: messages.workCard.activityExcludedTitle });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(page.getByText("Zadanie 2: Wysłano wyłącznie aaa.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Karta pracy: wynik każdej odpowiedzi oznaczony kolorem, ikoną i tekstem", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/parent/work-card");
  const steps = page.getByTestId("work-card-step");
  await expect(steps).toHaveCount(7);
  // kółko kroku: prezentacja neutralna, potem poprawna, błędna, częściowa, „Nie pamiętam” (trudność), pominięcie
  expect(await steps.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-outcome"))))
    .toEqual(["neutral", "success", "danger", "warning", "warning", "neutral", "warning"]);
  // poprawna dopiero po błędzie: osobny stan kroku, nie „Poprawnie”
  await expect(steps.nth(6)).toContainText(messages.workCard.stepCorrected);

  const responses = page.getByTestId("work-card-response");
  await expect(responses.nth(0)).toContainText(messages.workCard.outcome.correct);
  await expect(responses.nth(0)).toContainText("„monday”");
  await expect(responses.nth(1)).toContainText(messages.workCard.outcome.incorrect);
  await expect(responses.nth(1)).toContainText("„tuesdey”");
  await expect(responses.nth(2)).toContainText(messages.workCard.outcome.partial);
  await expect(responses.nth(3)).toContainText(messages.workCard.dontRemember);
  await expect(responses.nth(4)).toContainText(messages.workCard.skipped);

  // kolor nie jest jedynym nośnikiem: każda odznaka ma ikonę i tekst, a tony różnią się tłem
  const badgeBackground = (index: number) => responses.nth(index).locator(".pp-work-mark").evaluate((element) => getComputedStyle(element).backgroundColor);
  const [correct, incorrect, partial] = [await badgeBackground(0), await badgeBackground(1), await badgeBackground(2)];
  expect(new Set([correct, incorrect, partial]).size).toBe(3);
  for (let index = 0; index < 5; index++) await expect(responses.nth(index).locator(".pp-work-mark svg")).toHaveCount(1);

  const summary = page.getByTestId("work-card-outcomes");
  await expect(summary.getByTestId("work-card-outcomes-correct")).toHaveText(messages.workCard.outcomeCount.correct.replace("{n}", "1"));
  await expect(summary.getByTestId("work-card-outcomes-incorrect")).toHaveText(messages.workCard.outcomeCount.incorrect.replace("{n}", "1"));
  await expect(summary.getByTestId("work-card-outcomes-corrected")).toHaveText(messages.workCard.outcomeCount.corrected.replace("{n}", "1"));
  await expect(summary.getByTestId("work-card-outcomes-partial")).toHaveText(messages.workCard.outcomeCount.partial.replace("{n}", "1"));

  // telefon: kółko kroku obok treści, treść mieści się w karcie, bez przewijania w poziomie
  for (const row of await steps.all()) {
    const circle = (await row.locator(".pp-prog-outcome").boundingBox())!;
    const body = (await row.locator(".pp-work-step-body").boundingBox())!;
    expect(circle.x + circle.width).toBeLessThanOrEqual(body.x);
    expect(body.x + body.width).toBeLessThanOrEqual(360);
  }
  await expectNoHorizontalOverflow(page);
});

