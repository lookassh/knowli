import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * „Posłuchaj pytania” (design szkoły §11.4, API zaślepione w przeglądarce):
 * głośnik stoi w wierszu instrukcji, w portrecie, niskim landscape (<480 px),
 * na tablecie i desktopie mieści się w materiale bez poziomego przepełnienia
 * i ma cel ≥48 px także przy długim, zawiniętym poleceniu. Dotknięcie pobiera
 * nagranie zadania bez zgody serwera (`/disclosures`). Symulacja nie zastępuje
 * odbioru na fizycznym urządzeniu (głośność, zatrzymanie przed nagrywaniem).
 */

const childId = "10000000-0000-4000-8000-000000000801";
const deckId = "10000000-0000-4000-8000-000000000802";
const sessionId = "10000000-0000-4000-8000-000000000803";
const taskId = "10000000-0000-4000-8000-000000000811";
const questionAudioAssetId = "10000000-0000-4000-8000-000000000821";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const choiceTask: TaskDto = {
  taskId, sessionId, ordinal: 0, exerciseType: "lesson_choice", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_choice",
    instructionPl: "Przeczytaj uważnie pytanie i wybierz jedną odpowiedź, która najlepiej pasuje do materiału z lekcji.",
    stem: "Ile nóg ma pająk krzyżak?",
    options: [
      { id: "10000000-0000-4000-8000-000000000831", text: "osiem" },
      { id: "10000000-0000-4000-8000-000000000832", text: "sześć" },
      { id: "10000000-0000-4000-8000-000000000833", text: "cztery" },
    ],
    questionAudioAssetId,
  },
};

function fixture(tasks: TaskDto[]): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Pająki", itemCount: 6, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Przyroda" }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000804",
      policyId: "lesson-default", microphoneEnabled: false, state: "active", taskBudget: 3, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-30T10:00:00.000Z", resumed: false },
    tasks,
    // Gotowy katalog = fixture odpowiada na /media prawidłowym WAV-em.
    uiAudio: { ready: true, assets: {} },
  };
}

async function open(page: Page, kidFixture: KidUiFixture): Promise<void> {
  await installKidUiFixture(page, kidFixture);
  await page.setViewportSize(VIEWPORTS[0]!);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-question-audio")).toBeVisible();
}

test("question audio sits in the instruction row and fits every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([choiceTask]));
  const instruction = page.getByTestId("kid-instruction");
  await expect(instruction.getByTestId("kid-question-audio")).toHaveAttribute("aria-label", "Posłuchaj pytania");

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
    const button = page.getByTestId("kid-question-audio");
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    const material = (await page.getByTestId("kid-material").boundingBox())!;
    const row = (await instruction.boundingBox())!;
    expect(bounds.width, `width at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.height, `height at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.x, `inside material at ${label}`).toBeGreaterThanOrEqual(material.x - 1);
    expect(bounds.x + bounds.width, `inside material at ${label}`).toBeLessThanOrEqual(material.x + material.width + 1);
    expect(bounds.y, `inside instruction row at ${label}`).toBeGreaterThanOrEqual(row.y - 1);
    expect(bounds.y + bounds.height, `inside instruction row at ${label}`).toBeLessThanOrEqual(row.y + row.height + 1);
    expect(bounds.y + bounds.height, `in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
    expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `material overflow at ${label}`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`question-audio-${label}.png`) });
  }
});

test("tapping question audio fetches the prepared recording without a disclosure", async ({ page }) => {
  const mediaRequests: string[] = [];
  const disclosures: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/media/")) mediaRequests.push(path);
    if (request.method() === "POST" && path.endsWith("/disclosures")) disclosures.push(path);
  });
  await open(page, fixture([choiceTask]));
  expect(mediaRequests).toEqual([]);
  await page.getByTestId("kid-question-audio").click();
  await expect.poll(() => mediaRequests).toContain(`/api/v1/media/${questionAudioAssetId}`);
  expect(disclosures).toEqual([]);
  await expect(page.getByTestId("kid-question-audio-error")).toHaveCount(0);
});
