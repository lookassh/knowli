import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { expectFrameFillsViewport } from "./helpers/kid-frame";

/**
 * Geometria trenera precyzji w interfejsie dziecka (API zaślepione w
 * przeglądarce): wybór pojęć kluczowych (`lesson_keywords`, multi-select
 * na wspólnym `AnswerGrid`), „Skróć odpowiedź” (`lesson_shorten` na zadaniu
 * `lesson_open_answer`) i feedback `lesson_precision_hint`. W portrecie,
 * niskim landscape (<480 px), na tablecie i desktopie treść mieści się
 * w ramce lub jest osiągalna przez scroll, bez poziomego przepełnienia,
 * z celami ≥48 px i główną akcją ≥54 px. Symulacja nie zastępuje odbioru
 * na fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000601";
const deckId = "10000000-0000-4000-8000-000000000602";
const sessionId = "10000000-0000-4000-8000-000000000603";
const versionId = "10000000-0000-4000-8000-000000000604";
const keywordsTaskId = "10000000-0000-4000-8000-000000000611";
const openTaskId = "10000000-0000-4000-8000-000000000612";
const shortenTaskId = "10000000-0000-4000-8000-000000000613";
const option = (n: number) => `10000000-0000-4000-8000-00000000062${n}`;

const QUESTION = "Na czym polega fotosynteza i dlaczego jest ważna dla organizmów żyjących na Ziemi?";
const ORIGINAL = "Kiedyś na wycieczce w lesie pani mówiła nam dużo o drzewach i wtedy zapamiętałem, że roślina w świetle robi z wody i dwutlenku węgla cukier i tlen, którym oddychamy.";
const SEGMENTS = [
  { text: "Kiedyś na wycieczce w lesie pani mówiła nam dużo o drzewach i wtedy zapamiętałem, że ", state: "pill" as const },
  { text: "roślina w świetle robi z wody i dwutlenku węgla cukier i tlen, którym oddychamy.", state: "plain" as const },
];
const SHORT = "Roślina w świetle robi z wody i dwutlenku węgla cukier i tlen, którym oddychamy.";
const PRECISION_HINT = "Wiesz to! Teraz spróbuj powiedzieć to krócej, bez dodatkowych historii.";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const base = (taskId: string, exerciseType: TaskDto["exerciseType"]) => ({
  taskId, sessionId, ordinal: 0, exerciseType, direction: null, state: "issued" as const, remainingAssessed: 2,
});

const keywordsTask: TaskDto = {
  ...base(keywordsTaskId, "lesson_keywords"),
  prompt: {
    kind: "lesson_keywords",
    instructionPl: "Wybierz 2–3 najważniejsze pojęcia do tej odpowiedzi.",
    prompt: QUESTION,
    options: [
      { id: option(1), text: "światło słoneczne" },
      { id: option(2), text: "dwutlenek węgla" },
      { id: option(3), text: "korzenie" },
      { id: option(4), text: "tlen" },
      { id: option(5), text: "kolor płatków kwiatów" },
      { id: option(6), text: "glukoza" },
    ],
    minSelected: 2,
    maxSelected: 3,
  },
};

const openTask: TaskDto = {
  ...base(openTaskId, "lesson_open_answer"),
  prompt: { kind: "lesson_open_answer", instructionPl: "Odpowiedz pełnym zdaniem.", prompt: QUESTION, promptLocale: "pl-PL" },
};

const shortenTask: TaskDto = {
  ...base(shortenTaskId, "lesson_open_answer"),
  prompt: {
    kind: "lesson_shorten",
    instructionPl: "Skróć odpowiedź. Usuń zaznaczone fragmenty, zostaw to, co najważniejsze.",
    prompt: QUESTION,
    originalAnswer: ORIGINAL,
    answerSegments: SEGMENTS,
  },
};

const attempt = (attemptId: string, taskId: string, modality: AttemptDto["modality"], feedback: AttemptDto["feedback"]): AttemptDto => ({
  attemptId, taskId, state: "completed", modality, feedback, taskState: "answered", stepId: "s1",
  receivedAt: "2026-10-29T10:00:01.000Z", completedAt: "2026-10-29T10:00:01.000Z",
});

function fixture(tasks: TaskDto[], attempts: AttemptDto[] = []): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Fotosynteza", itemCount: 6, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Przyroda" }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: versionId,
      policyId: "lesson-default", microphoneEnabled: false, state: "active", taskBudget: 3, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-29T10:00:00.000Z", resumed: false },
    tasks,
    attempts,
  };
}

async function open(page: Page, kidFixture: KidUiFixture, ready: string): Promise<void> {
  await installKidUiFixture(page, kidFixture);
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId(ready)).toBeVisible();
}

interface Target { testId: string; nth?: number; minHeight?: number }

/** Każdy element po przewinięciu do widoku mieści się w viewporcie i w kontenerze materiału. */
async function expectReachable(page: Page, viewport: { width: number; height: number }, targets: readonly Target[]): Promise<void> {
  const label = `${viewport.width}x${viewport.height}`;
  await expectFrameFillsViewport(page, viewport);
  const frame = (await page.getByTestId("kid-session-frame").boundingBox())!;
  const material = (await page.getByTestId("kid-material").boundingBox())!;
  expect(material.x, `material left at ${label}`).toBeGreaterThanOrEqual(frame.x - 1);
  expect(material.x + material.width, `material right at ${label}`).toBeLessThanOrEqual(frame.x + frame.width + 1);

  for (const target of targets) {
    const element = target.nth === undefined ? page.getByTestId(target.testId) : page.getByTestId(target.testId).nth(target.nth);
    await element.scrollIntoViewIfNeeded();
    const bounds = (await element.boundingBox())!;
    const name = `${target.testId}${target.nth === undefined ? "" : `[${target.nth}]`} at ${label}`;
    expect(bounds.x, name).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width, name).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y, name).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height, name).toBeLessThanOrEqual(viewport.height + 1);
    if (target.minHeight !== undefined) {
      expect(bounds.height, name).toBeGreaterThanOrEqual(target.minHeight);
      expect(bounds.width, name).toBeGreaterThanOrEqual(48);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
  expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `material overflow at ${label}`).toBe(false);
}

/** Tekst nie jest przycięty: cała treść mieści się w swoim elemencie. */
async function expectNotClipped(page: Page, testId: string): Promise<void> {
  expect(await page.getByTestId(testId).evaluate((element) =>
    element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1), `${testId} clipped`).toBe(true);
}

test("keywords: question, counter, six concept tiles and the check action fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([keywordsTask]), "kid-lesson-keywords");
  await expect(page.getByTestId("kid-instruction")).toContainText("Wybierz 2–3 najważniejsze pojęcia");
  await expect(page.getByTestId("kid-lesson-source")).toHaveText(QUESTION);
  await expect(page.getByTestId("kid-option")).toHaveCount(6);
  // Dwa wybory przed pomiarem: stan zaznaczenia (znacznik ✓) też musi się zmieścić.
  await page.getByTestId("kid-option").nth(0).click();
  await page.getByTestId("kid-option").nth(1).click();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-source" },
      { testId: "kid-lesson-keywords-count" },
      ...Array.from({ length: 6 }, (_, nth) => ({ testId: "kid-option", nth, minHeight: 48 })),
      { testId: "kid-lesson-check", minHeight: 54 },
    ]);
    await expectNotClipped(page, "kid-lesson-source");
    // Kafelki pozostają w obrębie listy (żaden nie wystaje poza kolumnę materiału).
    const list = (await page.getByTestId("kid-lesson-keywords-options").boundingBox())!;
    for (let nth = 0; nth < 6; nth += 1) {
      const tile = (await page.getByTestId("kid-option").nth(nth).boundingBox())!;
      expect(tile.x, `tile ${nth} inside list at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(list.x - 1);
      expect(tile.x + tile.width).toBeLessThanOrEqual(list.x + list.width + 1);
    }
    // Kafelek ma overflow: hidden — długie pojęcie musi się zawinąć, a nie uciąć.
    expect(await page.getByTestId("kid-option").evaluateAll((tiles) => tiles.every((tile) =>
      tile.scrollWidth <= tile.clientWidth + 1 && tile.scrollHeight <= tile.clientHeight + 1)), `tiles clipped at ${viewport.width}x${viewport.height}`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`keywords-${viewport.width}x${viewport.height}.png`) });
  }
});

test("keywords: selection is bounded by min/max and sent as an unordered selection", async ({ page }) => {
  const posted: unknown[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) posted.push({ path, ...request.postDataJSON() });
  });
  await open(page, fixture([keywordsTask], [attempt("10000000-0000-4000-8000-000000000631", keywordsTaskId, "selection", { kind: "great" })]), "kid-lesson-keywords");
  const tiles = page.getByTestId("kid-option");
  const check = page.getByTestId("kid-lesson-check");
  const count = page.getByTestId("kid-lesson-keywords-count");

  await expect(count).toHaveText("Wybrane: 0 z 3");
  await expect(check).toBeDisabled();
  await tiles.nth(3).click();
  await expect(tiles.nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(check).toBeDisabled();
  await tiles.nth(0).click();
  await expect(check).toBeEnabled();
  await tiles.nth(1).click();
  await expect(count).toHaveText("Wybrane: 3 z 3");
  await expect(tiles.nth(2)).toBeDisabled();
  await expect(tiles.nth(5)).toBeDisabled();
  // Odznaczenie zwalnia miejsce.
  await tiles.nth(1).click();
  await expect(tiles.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(tiles.nth(2)).toBeEnabled();
  await tiles.nth(5).click();

  await check.click();
  await expect(page.getByTestId("kid-feedback")).toBeVisible();
  expect(posted).toHaveLength(1);
  const body = posted[0] as { modality: string; itemIds: string[]; path: string };
  expect(body.modality).toBe("selection");
  expect(body.path).toContain(`/tasks/${keywordsTaskId}/attempts`);
  expect([...body.itemIds].sort()).toEqual([option(1), option(4), option(6)].sort());
});

test("shorten: question, marked original, prefilled field and actions fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([shortenTask]), "kid-lesson-shorten");
  await expect(page.getByTestId("kid-instruction")).toContainText("Skróć odpowiedź");
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue(ORIGINAL);
  await expect(page.getByTestId("kid-spelling-pill")).toHaveText(SEGMENTS[0]!.text.trim());
  await expect(page.getByTestId("kid-lesson-shorten-original")).toContainText("Twoja odpowiedź");
  await expect(page.getByTestId("kid-not-remember")).toHaveCount(0);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-source" },
      { testId: "kid-lesson-shorten-original" },
      { testId: "kid-lesson-input", minHeight: 48 },
      { testId: "kid-lesson-check", minHeight: 54 },
      { testId: "kid-skip", minHeight: 48 },
    ]);
    await expectNotClipped(page, "kid-lesson-source");
    await expectNotClipped(page, "kid-lesson-shorten-original");
    await page.screenshot({ path: testInfo.outputPath(`shorten-${viewport.width}x${viewport.height}.png`) });
  }

  // Edycja w niskim landscape (klawiatura emulowana wysokością): akcja dalej osiągalna.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId("kid-lesson-input").fill(SHORT);
  await expect(page.getByTestId("kid-lesson-check")).toBeEnabled();
  await expectReachable(page, { width: 844, height: 390 }, [{ testId: "kid-lesson-check", minHeight: 54 }]);
});

// Werdykt v3 (design szkoły §9.2): zbędne i nie na temat w jednym tekście.
const CATEGORIZED_ORIGINAL = "Roślina w świetle robi z wody i dwutlenku węgla cukier. Liście są zielone przez chlorofil. Wczoraj z kolegami graliśmy w piłkę na boisku za szkołą.";
const categorizedShortenTask: TaskDto = {
  ...base(shortenTaskId, "lesson_open_answer"),
  prompt: {
    kind: "lesson_shorten",
    instructionPl: "Skróć odpowiedź. Usuń zaznaczone fragmenty, zostaw to, co najważniejsze.",
    prompt: QUESTION,
    originalAnswer: CATEGORIZED_ORIGINAL,
    answerSegments: [
      { text: "Roślina w świetle robi z wody i dwutlenku węgla cukier. ", state: "plain" },
      { text: "Liście są zielone przez chlorofil.", state: "pill" },
      { text: " ", state: "plain" },
      { text: "Wczoraj z kolegami graliśmy w piłkę na boisku za szkołą.", state: "offtopic" },
    ],
  },
};

test("shorten: redundant and off-topic marks with a legend fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([categorizedShortenTask]), "kid-lesson-shorten");
  await expect(page.getByTestId("kid-spelling-pill")).toContainText("Liście są zielone przez chlorofil.");
  await expect(page.getByTestId("kid-spelling-offtopic")).toContainText("Wczoraj z kolegami graliśmy w piłkę");
  const legend = page.getByTestId("kid-segment-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("zbędne");
  await expect(legend).toContainText("nie na temat");
  // kategoria nie zależy od koloru: inny styl obwódki i etykieta dla czytników ekranu
  const borders = await Promise.all(["kid-spelling-pill", "kid-spelling-offtopic"].map((id) =>
    page.getByTestId(id).evaluate((element) => getComputedStyle(element).borderTopStyle)));
  expect(borders[0]).not.toBe(borders[1]);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-shorten-original" },
      { testId: "kid-segment-legend" },
      { testId: "kid-lesson-input", minHeight: 48 },
      { testId: "kid-lesson-check", minHeight: 54 },
      { testId: "kid-skip", minHeight: 48 },
    ]);
    await expectNotClipped(page, "kid-lesson-shorten-original");
    await expectNotClipped(page, "kid-segment-legend");
    await page.screenshot({ path: testInfo.outputPath(`shorten-categories-${viewport.width}x${viewport.height}.png`) });
  }
});

test("open answer: precision hint praises the answer, shows the shortening tip, then the shorten step is submitted", async ({ page }, testInfo) => {
  const posted: unknown[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) posted.push({ path, ...request.postDataJSON() });
  });
  await open(page, fixture([openTask, shortenTask], [
    attempt("10000000-0000-4000-8000-000000000632", openTaskId, "text", { kind: "lesson_precision_hint", hintPl: PRECISION_HINT }),
    attempt("10000000-0000-4000-8000-000000000633", shortenTaskId, "text", { kind: "great" }),
  ]), "kid-lesson-input");

  await page.getByTestId("kid-lesson-input").fill(ORIGINAL);
  await page.getByTestId("kid-lesson-check").click();
  const feedback = page.getByTestId("kid-feedback");
  await expect(feedback).toHaveClass(/kid-feedback--correct/);
  await expect(page.locator("#kid-feedback-title")).toHaveText("Świetnie!");
  await expect(page.getByTestId("kid-lesson-feedback-hint")).toHaveText(PRECISION_HINT);
  await expect(page.getByTestId("kid-lesson-correct")).toHaveCount(0);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-feedback-hint" },
      { testId: "kid-next", minHeight: 54 },
    ]);
    await expectNotClipped(page, "kid-lesson-feedback-hint");
    await page.screenshot({ path: testInfo.outputPath(`precision-hint-${viewport.width}x${viewport.height}.png`) });
  }

  await page.setViewportSize(VIEWPORTS[0]!);
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-lesson-shorten")).toBeVisible();
  await expect(page.getByTestId("kid-lesson-input")).toHaveValue(ORIGINAL);
  await page.getByTestId("kid-lesson-input").fill(SHORT);
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.locator("#kid-feedback-title")).toHaveText("Świetnie!");
  expect(posted).toEqual([
    expect.objectContaining({ path: expect.stringContaining(`/tasks/${openTaskId}/attempts`), modality: "text", text: ORIGINAL }),
    expect.objectContaining({ path: expect.stringContaining(`/tasks/${shortenTaskId}/attempts`), modality: "text", text: SHORT }),
  ]);
});
