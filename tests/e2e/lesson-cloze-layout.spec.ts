import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * Geometria „Uzupełnij tekst” (`lesson_cloze`) w interfejsie dziecka (API
 * zaślepione w przeglądarce, design szkoły §13.5). Na wąskim telefonie
 * (320 px), w portrecie, niskim landscape (<480 px), na tablecie i desktopie:
 * tekst z czterema lukami zawija się w kontenerze materiału, miejsca luk, bank
 * słów i „Sprawdź” są osiągalne (w viewporcie po przewinięciu), bez poziomego
 * przepełnienia, z celami ≥48 px i główną akcją ≥54 px; bank stoi tuż pod
 * miejscami luk na każdym ekranie. Symulacja nie zastępuje odbioru na
 * fizycznym urządzeniu.
 */

const childId = "10000000-0000-4000-8000-000000000801";
const deckId = "10000000-0000-4000-8000-000000000802";
const sessionId = "10000000-0000-4000-8000-000000000803";
const versionId = "10000000-0000-4000-8000-000000000804";
const clozeTaskId = "10000000-0000-4000-8000-000000000811";
const uid = (n: number) => `10000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const clozeTask: TaskDto = {
  taskId: clozeTaskId, sessionId, ordinal: 0, exerciseType: "lesson_cloze", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_cloze",
    instructionPl: "Uzupełnij tekst. Wybierz słowo do każdej luki.",
    segments: [
      { text: "Roślina pobiera z powietrza " },
      { gapId: uid(20) },
      { text: ", a korzeniami czerpie z gleby wodę i rozpuszczone w niej sole mineralne. W zielonych liściach, dzięki energii " },
      { gapId: uid(21) },
      { text: ", powstają " },
      { gapId: uid(22) },
      { text: ". Do powietrza roślina oddaje przy tym " },
      { gapId: uid(23) },
      { text: ", którym oddychają zwierzęta i ludzie." },
    ],
    words: [
      { id: uid(30), text: "światła słonecznego" },
      { id: uid(31), text: "tlen" },
      { id: uid(32), text: "dwutlenek węgla" },
      { id: uid(33), text: "azot" },
      { id: uid(34), text: "cukry" },
      { id: uid(35), text: "chlorofil" },
    ],
  },
};

function fixture(attempts: AttemptDto[] = []): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Fotosynteza", itemCount: 6, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Przyroda" }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: versionId,
      policyId: "lesson-default", microphoneEnabled: false, state: "active", taskBudget: 3, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-30T10:00:00.000Z", resumed: false },
    tasks: [clozeTask],
    attempts,
  };
}

async function open(page: Page, kidFixture: KidUiFixture): Promise<void> {
  await installKidUiFixture(page, kidFixture);
  await page.setViewportSize(VIEWPORTS[1]!);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-lesson-cloze")).toBeVisible();
}

interface Target { testId: string; nth?: number; minHeight?: number; tall?: boolean }

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
    // Akapit tekstu może być wyższy niż niski landscape — wtedy przewija się w ramie.
    if (!target.tall) {
      expect(bounds.y, name).toBeGreaterThanOrEqual(-1);
      expect(bounds.y + bounds.height, name).toBeLessThanOrEqual(viewport.height + 1);
    }
    if (target.minHeight !== undefined) {
      expect(bounds.height, name).toBeGreaterThanOrEqual(target.minHeight);
      expect(bounds.width, name).toBeGreaterThanOrEqual(48);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
  expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `material overflow at ${label}`).toBe(false);
}

test("cloze: text with four gaps, slots, word bank and check fit every form factor", async ({ page }, testInfo) => {
  await open(page, fixture());
  await expect(page.getByTestId("kid-instruction")).toContainText("Uzupełnij tekst.");
  await expect(page.getByTestId("kid-lesson-cloze-gap")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-text").locator("button")).toHaveCount(0);
  await expect(page.getByTestId("kid-lesson-cloze-slot")).toHaveCount(4);
  // Dwie luki wypełnione przed pomiarem: najdłuższe słowo stoi w tekście i w miejscu, reszta w banku.
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "dwutlenek węgla" }).click();
  await page.getByTestId("kid-lesson-cloze-option").filter({ hasText: "światła słonecznego" }).click();
  await expect(page.getByTestId("kid-lesson-cloze-option")).toHaveCount(4);
  await expect(page.getByTestId("kid-lesson-cloze-text")).toContainText("światła słonecznego");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expectReachable(page, viewport, [
      { testId: "kid-lesson-cloze-text", tall: true },
      ...Array.from({ length: 4 }, (_, nth) => ({ testId: "kid-lesson-cloze-slot", nth, minHeight: 48 })),
      ...Array.from({ length: 4 }, (_, nth) => ({ testId: "kid-lesson-cloze-option", nth, minHeight: 48 })),
      { testId: "kid-lesson-check", minHeight: 54 },
    ]);
    for (const testId of ["kid-lesson-cloze-slot", "kid-lesson-cloze-option"]) {
      expect(await page.getByTestId(testId).evaluateAll((buttons) => buttons.every((button) =>
        button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1)), `${testId} clipped at ${label}`).toBe(true);
    }
    // Luka w tekście nie wystaje poza akapit (zawija się razem z tekstem).
    const text = (await page.getByTestId("kid-lesson-cloze-text").boundingBox())!;
    for (const gap of await page.getByTestId("kid-lesson-cloze-gap").all()) {
      const bounds = (await gap.boundingBox())!;
      expect(bounds.x, `gap inside text at ${label}`).toBeGreaterThanOrEqual(text.x - 1);
      expect(bounds.x + bounds.width, `gap inside text at ${label}`).toBeLessThanOrEqual(text.x + text.width + 1);
    }
    // Jedna kolumna: tekst, pod nim miejsca luk, tuż pod nimi bank (także w niskim landscape).
    const lastSlot = (await page.getByTestId("kid-lesson-cloze-slot").last().boundingBox())!;
    const pool = (await page.getByTestId("kid-lesson-cloze-pool").boundingBox())!;
    const firstSlot = (await page.getByTestId("kid-lesson-cloze-slot").first().boundingBox())!;
    expect(firstSlot.y, `slots below text at ${label}`).toBeGreaterThanOrEqual(text.y + text.height - 1);
    expect(pool.y, `bank below slots at ${label}`).toBeGreaterThanOrEqual(lastSlot.y + lastSlot.height - 1);
    expect(pool.y - (lastSlot.y + lastSlot.height), `bank right under slots at ${label}`).toBeLessThan(80);
    await page.screenshot({ path: testInfo.outputPath(`cloze-${label}.png`) });
  }
});

test("cloze: check sends gap → word assignments and shows the completed text after a mistake", async ({ page }) => {
  const posted: unknown[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/tasks\/[^/]+\/attempts$/.test(path)) posted.push(request.postDataJSON());
  });
  const correctText = "Roślina pobiera z powietrza dwutlenek węgla, a korzeniami czerpie z gleby wodę.";
  await open(page, fixture([{
    attemptId: uid(90), taskId: clozeTaskId, state: "completed", modality: "assignment", feedback: { kind: "incorrect", correctText },
    taskState: "answered", stepId: "s1", receivedAt: "2026-10-30T10:00:01.000Z", completedAt: "2026-10-30T10:00:01.000Z",
  }]));
  const check = page.getByTestId("kid-lesson-check");
  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId("kid-lesson-cloze-option").first().click();
    await expect(check).toBeDisabled();
  }
  await page.getByTestId("kid-lesson-cloze-option").first().click();
  await expect(check).toBeEnabled();
  await check.click();
  await expect.poll(() => posted.length).toBe(1);
  const body = posted[0] as { modality: string; assignments: { itemId: string; targetId: string }[] };
  expect(body.modality).toBe("assignment");
  expect(body.assignments.map((entry) => entry.itemId)).toEqual([uid(20), uid(21), uid(22), uid(23)]);
  expect(new Set(body.assignments.map((entry) => entry.targetId)).size).toBe(4);
  await expect(page.getByText(correctText)).toBeVisible();
  await expect(page.getByTestId("kid-lesson-cloze-option").first()).toBeDisabled();
});
