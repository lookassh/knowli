import { expect as baseExpect, test, type Page } from "@playwright/test";
import type { AttemptDto, KidDeckDto, KidProfileDto, SessionDto, SessionSummaryDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * E2E dziecka dla lekcji (zadanie 14, fixture jak w pozostałych kid E2E):
 * profil → lista zestawów (lekcja z tytułem przedmiotu) → karta → wskazanie →
 * wybór → klocki → luka z błędem w elemencie sprawdzanym (feedback-podpowiedź,
 * potem karta przypomnienia i łatwiejsze ćwiczenie — cykl wsparcia) → luka z
 * literówką poza elementem („Prawie!”) → podsumowanie z ćwiczonymi regułami.
 * Dodatkowo: ścieżka bez mikrofonu i prywatność (odpowiedzi API zadań nie
 * zawierają answer/acceptedAnswers/focus/objectiveId/kategorii).
 */

const expect = baseExpect.configure({ timeout: 2_000 });
test.setTimeout(30_000);

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const versionId = "10000000-0000-4000-8000-000000000005";

const t = (n: number) => `10000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const o = (n: number) => `10000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const a = (n: number) => `10000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

function profile(): KidProfileDto {
  return { childId, displayName: "Ola", avatarKey: "fox", recordingMode: "hold" };
}

function lessonDeck(): KidDeckDto {
  return {
    deckId, title: "Present Simple", itemCount: 3, independentlyRecalledCount: 1, testDate: null,
    recommended: true, mockTestAvailable: false, activeSession: null,
    kind: "lesson", subjectTitle: "Język angielski",
  };
}

function session(): SessionDto {
  return {
    mode: "training", sessionId, childId, deckId, deckVersionId: versionId, policyId: "lesson-default",
    microphoneEnabled: false, state: "active", taskBudget: 6, tasksIssued: 0, assessedTasksIssued: 0,
    startedAt: "2026-10-11T10:00:00.000Z", resumed: false,
  };
}

const base = (taskId: string, exerciseType: TaskDto["exerciseType"]) => ({
  taskId, sessionId, ordinal: 0, exerciseType, direction: null as const, state: "issued" as const, remainingAssessed: 1,
});

const cardTask: TaskDto = {
  ...base(t(1), "lesson_card"),
  prompt: { kind: "lesson_card", card: {
    title: "Czas Present Simple",
    body: "W 3. osobie liczby pojedynczej dodajemy -s.",
    examples: ["He plays football.", "She watches TV."],
  } },
};

const noticeTask: TaskDto = {
  ...base(t(2), "lesson_notice"),
  prompt: { kind: "lesson_notice", instructionPl: "Dotknij czasownika z końcówką -s",
    segments: [[
      { id: o(1), text: "She" }, { id: o(2), text: "plays" }, { id: o(3), text: "football" },
    ]] },
};

const choiceTask: TaskDto = {
  ...base(t(3), "lesson_choice"),
  prompt: { kind: "lesson_choice", instructionPl: "Wybierz właściwą formę", stem: "He ___ football every day.",
    options: [{ id: o(4), text: "play" }, { id: o(5), text: "plays" }] },
};

const orderTask: TaskDto = {
  ...base(t(4), "lesson_order"),
  prompt: { kind: "lesson_order", instructionPl: "Ułóż poprawne zdanie",
    items: [{ id: o(6), text: "She" }, { id: o(7), text: "plays" }, { id: o(8), text: "football" }] },
};

const gapErrorTask: TaskDto = {
  ...base(t(5), "lesson_gap"),
  prompt: { kind: "lesson_gap", instructionPl: "Uzupełnij lukę", stemWithGap: "He ___ football.", hint: "(play)" },
};

const reminderCard: TaskDto = {
  ...base(t(6), "lesson_card"),
  prompt: { kind: "lesson_card", card: {
    title: "Przypomnienie", body: "Po he / she / it dodaj -s do czasownika.", examples: ["He plays."],
  } },
};

const easierChoice: TaskDto = {
  ...base(t(7), "lesson_choice"),
  prompt: { kind: "lesson_choice", instructionPl: "Wybierz formę dla „he”", stem: "He ___ .",
    options: [{ id: o(9), text: "play" }, { id: o(10), text: "plays" }] },
};

const gapTypoTask: TaskDto = {
  ...base(t(8), "lesson_gap"),
  prompt: { kind: "lesson_gap", instructionPl: "Uzupełnij lukę", stemWithGap: "She ___ TV.", hint: "(watch)" },
};

const great = (attemptId: string, taskId: string): AttemptDto => ({
  attemptId, taskId, state: "completed", modality: "choice", feedback: { kind: "great" },
  taskState: "answered", stepId: "s1", receivedAt: "2026-10-11T10:00:01.000Z", completedAt: "2026-10-11T10:00:01.000Z",
});

const attempts: AttemptDto[] = [
  { ...great(a(1), t(2)) },                                   // notice → great
  { ...great(a(2), t(3)) },                                   // choice → great
  { ...great(a(3), t(4)), modality: "sequence" },             // order → great
  {                                                           // gap error → lesson_hint (support cycle)
    attemptId: a(4), taskId: t(5), state: "completed", modality: "text", taskState: "answered", stepId: "s4",
    receivedAt: "2026-10-11T10:00:04.000Z", completedAt: "2026-10-11T10:00:04.000Z",
    feedback: {
      kind: "lesson_hint",
      answerSegments: [{ text: "he ", state: "plain" }, { text: "play", state: "pill" }, { text: " football", state: "plain" }],
      hintPl: "W 3. osobie dodaj -s.", correctText: "he plays football",
    },
  },
  { ...great(a(5), t(7)) },                                   // easier choice → great
  {                                                           // gap typo outside focus → lesson_almost
    attemptId: a(6), taskId: t(8), state: "completed", modality: "text", taskState: "answered", stepId: "s6",
    receivedAt: "2026-10-11T10:00:06.000Z", completedAt: "2026-10-11T10:00:06.000Z",
    feedback: {
      kind: "lesson_almost",
      answerSegments: [{ text: "she ", state: "plain" }, { text: "wathes", state: "pill" }, { text: " tv", state: "plain" }],
      correctText: "she watches TV",
    },
  },
];

const summary: SessionSummaryDto = {
  sessionId, state: "ended", tasksIssued: 8, assessedTasksIssued: 6,
  independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [],
  endedAt: "2026-10-11T10:01:00.000Z",
  objectives: [
    { objectiveId: "obj-s", titlePl: "-s w 3. osobie", practiced: 4, correct: 3 },
    { objectiveId: "obj-order", titlePl: "szyk zdania oznajmującego", practiced: 1, correct: 1 },
  ],
};

async function openLesson(page: Page): Promise<void> {
  await installKidUiFixture(page, {
    profiles: [profile()],
    decks: [lessonDeck()],
    session: session(),
    tasks: [cardTask, noticeTask, choiceTask, orderTask, gapErrorTask, reminderCard, easierChoice, gapTypoTask, null],
    attempts,
    presentation: { taskId: t(1), state: "completed", completedAt: "2026-10-11T10:00:00.500Z" },
    summary,
  });
  await page.goto("/");
}

test("child works a whole lesson: card → notice → choice → blocks → gap support cycle → almost → summary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLesson(page);

  // Lista zestawów: lekcja oznaczona tytułem przedmiotu, bez procentów.
  await page.getByTestId("kid-profile").click();
  const card = page.getByTestId("kid-deck-card");
  await expect(card).toHaveAttribute("data-kind", "lesson");
  await expect(page.getByTestId("kid-deck-title")).toContainText("Lekcja: Język angielski");
  await expect(page.getByTestId("kid-deck-title")).not.toContainText("%");
  await page.getByTestId("kid-deck").click();

  // Karta prezentacji: tytuł, treść, przykłady, „Dalej”.
  await expect(page.getByTestId("kid-lesson-card-title")).toHaveText("Czas Present Simple");
  await expect(page.getByTestId("kid-lesson-card-examples")).toContainText("He plays football.");
  await page.getByTestId("kid-lesson-next").click();

  // Wskazanie: dotknięcie słowa.
  await expect(page.getByTestId("kid-lesson-notice")).toBeVisible();
  await page.getByTestId("kid-lesson-notice-word").filter({ hasText: "plays" }).click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await page.getByTestId("kid-next").click();

  // Wybór.
  await expect(page.getByTestId("kid-lesson-stem")).toHaveText("He ___ football every day.");
  await page.getByTestId("kid-option").filter({ hasText: "plays" }).click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await page.getByTestId("kid-next").click();

  // Klocki: dodaj wszystkie, „Sprawdź” aktywne dopiero po ułożeniu.
  await expect(page.getByTestId("kid-lesson-check")).toBeDisabled();
  for (const word of ["She", "plays", "football"]) {
    await page.getByTestId("kid-lesson-order-block").filter({ hasText: new RegExp(`^${word}$`) }).click();
  }
  await expect(page.getByTestId("kid-lesson-order-placed")).toHaveCount(3);
  await expect(page.getByTestId("kid-lesson-check")).toBeEnabled();
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await page.getByTestId("kid-next").click();

  // Luka z błędem w elemencie sprawdzanym → podpowiedź (cykl wsparcia).
  await expect(page.getByTestId("kid-lesson-gap-hint")).toContainText("(play)");
  await page.getByTestId("kid-lesson-gap-input").fill("play");
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Mała wskazówka");
  await expect(page.getByTestId("kid-lesson-feedback-hint")).toContainText("W 3. osobie dodaj -s.");
  await expect(page.getByTestId("kid-lesson-correct")).toContainText("he plays football");
  await page.getByTestId("kid-next").click();

  // Karta przypomnienia, potem łatwiejsze ćwiczenie.
  await expect(page.getByTestId("kid-lesson-card-title")).toHaveText("Przypomnienie");
  await page.getByTestId("kid-lesson-next").click();
  await expect(page.getByTestId("kid-lesson-stem")).toHaveText("He ___ .");
  await page.getByTestId("kid-option").filter({ hasText: "plays" }).click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await page.getByTestId("kid-next").click();

  // Luka z literówką poza elementem sprawdzanym → „Prawie!”.
  await page.getByTestId("kid-lesson-gap-input").fill("wathes");
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Prawie!");
  await expect(page.getByTestId("kid-lesson-answer-segments")).toContainText("wathes");
  await expect(page.getByTestId("kid-lesson-correct")).toContainText("she watches TV");
  await page.getByTestId("kid-next").click();

  // Podsumowanie: ćwiczone reguły, bez procentów ani statusów technicznych.
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-summary-objective")).toHaveCount(2);
  await expect(page.getByTestId("kid-summary-objectives")).toContainText("Ćwiczyłeś: -s w 3. osobie");
  await expect(page.getByTestId("kid-summary-objectives")).not.toContainText("%");
});

test("lesson needs no microphone and never requests access", async ({ page }) => {
  let micRequested = false;
  await page.addInitScript(() => {
    const navAny = navigator as unknown as { mediaDevices?: { getUserMedia?: unknown } };
    if (navAny.mediaDevices) {
      navAny.mediaDevices.getUserMedia = () => {
        (window as unknown as { __micRequested?: boolean }).__micRequested = true;
        return Promise.reject(new Error("blocked"));
      };
    }
  });
  await openLesson(page);
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-lesson-card-title")).toBeVisible();
  // Karta i wszystkie typy lekcji nie pokazują przycisku nagrywania.
  await expect(page.getByTestId("kid-record")).toHaveCount(0);
  await page.getByTestId("kid-lesson-next").click();
  await page.getByTestId("kid-lesson-notice-word").filter({ hasText: "plays" }).click();
  micRequested = await page.evaluate(() => (window as unknown as { __micRequested?: boolean }).__micRequested === true);
  expect(micRequested).toBe(false);
});

test("task API responses never disclose answer keys, focus, objective or error category", async ({ page }) => {
  const forbidden = ["answer", "acceptedAnswers", "answerKey", "focus", "objectiveId", "errorCategory", "category", "correctOption"];
  const leaks: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!/\/api\/v1\/kid\/sessions\/.+\/next$/.test(url.pathname) && !/\/tasks\/.+\/attempts$/.test(url.pathname)) return;
    void response.text().then((body) => {
      for (const key of forbidden) {
        if (new RegExp(`"${key}"`).test(body)) leaks.push(`${url.pathname}: ${key}`);
      }
    }).catch(() => undefined);
  });

  await openLesson(page);
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-lesson-card-title")).toBeVisible();
  await page.getByTestId("kid-lesson-next").click();
  await page.getByTestId("kid-lesson-notice-word").filter({ hasText: "plays" }).click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  await page.waitForTimeout(200);
  expect(leaks, leaks.join("; ")).toHaveLength(0);
});

test("blocks, gap and feedback hold at 390×844 and 768×1024 without horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await openLesson(page);
    await page.getByTestId("kid-profile").click();
    await page.getByTestId("kid-deck").click();
    await page.getByTestId("kid-lesson-next").click(); // card → notice
    await page.getByTestId("kid-lesson-notice-word").filter({ hasText: "plays" }).click();
    await page.getByTestId("kid-next").click(); // → choice
    await page.getByTestId("kid-option").filter({ hasText: "plays" }).click();
    await page.getByTestId("kid-next").click(); // → order (blocks)

    await expect(page.getByTestId("kid-lesson-order")).toBeVisible();
    await page.screenshot({ path: `.superpowers/sdd/grammar-module/shot-order-${viewport.width}.png` });
    await expect(page.getByTestId("kid-lesson-check")).toBeInViewport();
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noOverflow, `blocks overflow at ${viewport.width}`).toBe(true);

    for (const word of ["She", "plays", "football"]) {
      await page.getByTestId("kid-lesson-order-block").filter({ hasText: new RegExp(`^${word}$`) }).click();
    }
    await page.getByTestId("kid-lesson-check").click();
    await page.getByTestId("kid-next").click(); // → gap error

    await expect(page.getByTestId("kid-lesson-gap")).toBeVisible();
    await page.screenshot({ path: `.superpowers/sdd/grammar-module/shot-gap-${viewport.width}.png` });
    const gapNoOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(gapNoOverflow, `gap overflow at ${viewport.width}`).toBe(true);

    await page.getByTestId("kid-lesson-gap-input").fill("play");
    await page.getByTestId("kid-lesson-check").click();
    await expect(page.getByTestId("kid-feedback")).toBeVisible();
    await page.screenshot({ path: `.superpowers/sdd/grammar-module/shot-feedback-${viewport.width}.png` });
    await expect(page.getByTestId("kid-next")).toBeInViewport();
    const fbNoOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fbNoOverflow, `feedback overflow at ${viewport.width}`).toBe(true);
  }
});
