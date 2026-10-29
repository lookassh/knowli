import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * Geometria „Połącz w pary” (`lesson_match`) i „Pogrupuj” (`lesson_group`)
 * w interfejsie dziecka (API zaślepione w przeglądarce, design szkoły §10.5).
 * W portrecie, niskim landscape (<480 px), na tablecie i desktopie: miejsca,
 * pula, grupy i „Sprawdź” są osiągalne (w viewporcie po przewinięciu), bez
 * poziomego przepełnienia, z celami ≥48 px i główną akcją ≥54 px; najdłuższe
 * teksty (100 znaków po prawej) zawijają się zamiast ucinać. Symulacja nie
 * zastępuje odbioru na fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000701";
const deckId = "10000000-0000-4000-8000-000000000702";
const sessionId = "10000000-0000-4000-8000-000000000703";
const versionId = "10000000-0000-4000-8000-000000000704";
const matchTaskId = "10000000-0000-4000-8000-000000000711";
const groupTaskId = "10000000-0000-4000-8000-000000000712";
const uid = (n: number) => `10000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const base = (taskId: string, exerciseType: TaskDto["exerciseType"]) => ({
  taskId, sessionId, ordinal: 0, exerciseType, direction: null, state: "issued" as const, remainingAssessed: 2,
});

const LONG_RIGHT = "wyobrażona linia na powierzchni Ziemi łącząca oba bieguny, wyznaczająca długość geograficzną miejsca";

const matchTask: TaskDto = {
  ...base(matchTaskId, "lesson_match"),
  prompt: {
    kind: "lesson_match",
    instructionPl: "Połącz pojęcie z jego opisem.",
    left: [
      { id: uid(20), text: "równik" },
      { id: uid(21), text: "południk zerowy" },
      { id: uid(22), text: "równoleżnik" },
      { id: uid(23), text: "biegun północny" },
      { id: uid(24), text: "zwrotnik Raka" },
    ],
    right: [
      { id: uid(30), text: LONG_RIGHT },
      { id: uid(31), text: "najdłuższy równoleżnik, dzieli Ziemię na półkulę północną i południową" },
      { id: uid(32), text: "przechodzi przez Greenwich" },
      { id: uid(33), text: "linia biegnąca równolegle do równika" },
      { id: uid(34), text: "punkt, w którym oś Ziemi przecina jej powierzchnię na północy" },
      { id: uid(35), text: "równoleżnik 23°26′ N" },
      { id: uid(36), text: "najwyższy szczyt Europy" },
    ],
  },
};

const groupTask: TaskDto = {
  ...base(groupTaskId, "lesson_group"),
  prompt: {
    kind: "lesson_group",
    instructionPl: "Pogrupuj zwierzęta.",
    groups: [{ id: uid(40), text: "ssaki" }, { id: uid(41), text: "ptaki" }, { id: uid(42), text: "gady i płazy razem" }],
    items: [
      { id: uid(50), text: "nietoperz" }, { id: uid(51), text: "wróbel" }, { id: uid(52), text: "jaszczurka zwinka" },
      { id: uid(53), text: "delfin" }, { id: uid(54), text: "sowa" }, { id: uid(55), text: "żaba" },
      { id: uid(56), text: "kret" }, { id: uid(57), text: "bocian biały" },
    ],
  },
};

const attempt = (attemptId: string, taskId: string, feedback: AttemptDto["feedback"]): AttemptDto => ({
  attemptId, taskId, state: "completed", modality: "assignment", feedback, taskState: "answered", stepId: "s1",
  receivedAt: "2026-10-29T10:00:01.000Z", completedAt: "2026-10-29T10:00:01.000Z",
});

function fixture(tasks: TaskDto[], attempts: AttemptDto[] = []): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Siatka geograficzna", itemCount: 6, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Geografia" }],
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
  await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
  const material = (await page.getByTestId("kid-material").boundingBox())!;
  for (const target of targets) {
    const element = target.nth === undefined ? page.getByTestId(target.testId) : page.getByTestId(target.testId).nth(target.nth);
    await element.scrollIntoViewIfNeeded();
    const bounds = (await element.boundingBox())!;
    const name = `${target.testId}${target.nth === undefined ? "" : `[${target.nth}]`} at ${label}`;
    expect(bounds.x, name).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width, name).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.x, `${name} inside material`).toBeGreaterThanOrEqual(material.x - 1);
    expect(bounds.x + bounds.width, `${name} inside material`).toBeLessThanOrEqual(material.x + material.width + 1);
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

/** Przyciski nie ucinają tekstu: długi opis się zawija. */
async function expectButtonsNotClipped(page: Page, testId: string, label: string): Promise<void> {
  expect(await page.getByTestId(testId).evaluateAll((buttons) => buttons.every((button) =>
    button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1)), `${testId} clipped at ${label}`).toBe(true);
}

test("match: five pairs, long descriptions, pool and check fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([matchTask]), "kid-lesson-match");
  await expect(page.getByTestId("kid-instruction")).toContainText("Połącz pojęcie z jego opisem.");
  await expect(page.getByTestId("kid-lesson-match-slot")).toHaveCount(5);
  // Dwa miejsca zajęte przed pomiarem: najdłuższy opis stoi w miejscu, reszta w puli.
  await page.getByTestId("kid-lesson-match-option").filter({ hasText: LONG_RIGHT }).click();
  await page.getByTestId("kid-lesson-match-option").first().click();
  await expect(page.getByTestId("kid-lesson-match-option")).toHaveCount(5);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expectReachable(page, viewport, [
      ...Array.from({ length: 5 }, (_, nth) => ({ testId: "kid-lesson-match-left", nth })),
      ...Array.from({ length: 5 }, (_, nth) => ({ testId: "kid-lesson-match-slot", nth, minHeight: 48 })),
      ...Array.from({ length: 5 }, (_, nth) => ({ testId: "kid-lesson-match-option", nth, minHeight: 48 })),
      { testId: "kid-lesson-check", minHeight: 54 },
    ]);
    await expectButtonsNotClipped(page, "kid-lesson-match-slot", label);
    await expectButtonsNotClipped(page, "kid-lesson-match-option", label);
    // Od 600 px lewy element stoi obok swojego miejsca, w compact nad nim.
    const left = (await page.getByTestId("kid-lesson-match-left").first().boundingBox())!;
    const slot = (await page.getByTestId("kid-lesson-match-slot").first().boundingBox())!;
    if (viewport.width >= 600) expect(slot.x, `slot beside label at ${label}`).toBeGreaterThan(left.x + left.width - 1);
    else expect(slot.y, `slot below label at ${label}`).toBeGreaterThanOrEqual(left.y + left.height - 1);
    await page.screenshot({ path: testInfo.outputPath(`match-${label}.png`) });
  }
});

test("group: three bins, eight items and check fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([groupTask]), "kid-lesson-group");
  await expect(page.getByTestId("kid-lesson-group-target")).toHaveCount(3);
  await page.getByTestId("kid-lesson-group-item").filter({ hasText: "nietoperz" }).click();
  await page.getByTestId("kid-lesson-group-target").nth(2).click();
  await page.getByTestId("kid-lesson-group-item").filter({ hasText: "jaszczurka zwinka" }).click();
  await expect(page.getByTestId("kid-lesson-group-member")).toHaveCount(2);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expectReachable(page, viewport, [
      ...Array.from({ length: 3 }, (_, nth) => ({ testId: "kid-lesson-group-target", nth, minHeight: 48 })),
      ...Array.from({ length: 2 }, (_, nth) => ({ testId: "kid-lesson-group-member", nth, minHeight: 48 })),
      ...Array.from({ length: 6 }, (_, nth) => ({ testId: "kid-lesson-group-item", nth, minHeight: 48 })),
      { testId: "kid-lesson-check", minHeight: 54 },
    ]);
    await expectButtonsNotClipped(page, "kid-lesson-group-item", label);
    await expectButtonsNotClipped(page, "kid-lesson-group-target", label);
    await page.screenshot({ path: testInfo.outputPath(`group-${label}.png`) });
  }
});

test("match: check sends complete left → right assignments and shows the correct pairs after a mistake", async ({ page }) => {
  const posted: unknown[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) posted.push(request.postDataJSON());
  });
  const correctText = "równik → najdłuższy równoleżnik; południk zerowy → przechodzi przez Greenwich";
  await open(page, fixture([matchTask], [attempt(uid(90), matchTaskId, { kind: "incorrect", correctText })]), "kid-lesson-match");
  const check = page.getByTestId("kid-lesson-check");
  for (let i = 0; i < 4; i += 1) {
    await page.getByTestId("kid-lesson-match-option").first().click();
    await expect(check).toBeDisabled();
  }
  await page.getByTestId("kid-lesson-match-option").first().click();
  await expect(check).toBeEnabled();
  await check.click();
  await expect.poll(() => posted.length).toBe(1);
  const body = posted[0] as { modality: string; assignments: { itemId: string; targetId: string }[] };
  expect(body.modality).toBe("assignment");
  expect(body.assignments.map((entry) => entry.itemId)).toEqual([uid(20), uid(21), uid(22), uid(23), uid(24)]);
  expect(new Set(body.assignments.map((entry) => entry.targetId)).size).toBe(5);
  await expect(page.getByText(correctText)).toBeVisible();
  await expect(page.getByTestId("kid-lesson-match-option").first()).toBeDisabled();
});
