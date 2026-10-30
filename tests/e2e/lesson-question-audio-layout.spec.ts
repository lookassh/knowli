import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { expectReachableOnSmallPhone, LESSON_AUDIO_VIEWPORTS, lessonAudioFixture, openLessonTask } from "./helpers/lesson-audio";

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

const VIEWPORTS = LESSON_AUDIO_VIEWPORTS;

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

const groupTask: TaskDto = {
  taskId: "10000000-0000-4000-8000-000000000812", sessionId, ordinal: 0, exerciseType: "lesson_group", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_group",
    instructionPl: "Przeczytaj nazwy grup, a potem przyporządkuj każde zwierzę do właściwej grupy według materiału z lekcji.",
    groups: [
      { id: "10000000-0000-4000-8000-000000000841", text: "ssaki" },
      { id: "10000000-0000-4000-8000-000000000842", text: "ptaki" },
      { id: "10000000-0000-4000-8000-000000000843", text: "gady i płazy razem" },
    ],
    items: ["nietoperz", "wróbel", "jaszczurka zwinka", "delfin", "sowa", "żaba", "kret", "bocian biały"]
      .map((text, i) => ({ id: `10000000-0000-4000-8000-0000000008${50 + i}`, text })),
    questionAudioAssetId,
  },
};

function fixture(tasks: TaskDto[], audioReady = true): KidUiFixture {
  return lessonAudioFixture({ childId, deckId, sessionId, deckVersionId: "10000000-0000-4000-8000-000000000804" }, tasks, { audioReady });
}

async function open(page: Page, kidFixture: KidUiFixture): Promise<void> {
  await installKidUiFixture(page, kidFixture);
  await openLessonTask(page, "kid-question-audio");
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

test("playback error shows its notice in the status bar and keeps check reachable at 320x480", async ({ page }, testInfo) => {
  await open(page, fixture([groupTask], false));
  await page.setViewportSize({ width: 320, height: 480 });
  await page.getByTestId("kid-question-audio").click();
  const notice = page.getByTestId("kid-question-audio-error");
  await expect(notice).toBeVisible();
  // Komunikat poza wierszem instrukcji, rama przewijana jak przy błędzie odsłuchu polecenia.
  expect(await page.getByTestId("kid-instruction").getByTestId("kid-question-audio-error").count()).toBe(0);
  await expect(page.locator("main.kid-learning")).toHaveAttribute("data-action-notice", "true");
  await expectReachableOnSmallPhone(page, { "kid-question-audio-retry": 48, "kid-question-audio": 48, "kid-lesson-check": 54 });
  await page.screenshot({ path: testInfo.outputPath("question-audio-error-320x480.png") });
});
