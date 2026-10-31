import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { expectReachableOnSmallPhone, LESSON_AUDIO_VIEWPORTS, lessonAudioFixture, openLessonTask } from "./helpers/lesson-audio";
import { expectFrameFillsViewport } from "./helpers/kid-frame";

/**
 * „Posłuchaj karty” (design szkoły §12.4, API zaślepione w przeglądarce):
 * głośnik stoi w nagłówku karty nauki za tytułem (nie w wierszu instrukcji),
 * w portrecie, niskim landscape (<480 px), na tablecie i desktopie mieści się
 * w karcie bez poziomego przepełnienia, nie nachodzi na długi, zawinięty tytuł
 * i ma cel ≥48 px; „Dalej” pozostaje osiągalne przy najdłuższej treści, także
 * przy 320×480. Dotknięcie pobiera nagranie bez zgody serwera (`/disclosures`).
 * Symulacja nie zastępuje odbioru na fizycznym urządzeniu (głośność, długość
 * nagrania, zatrzymanie po „Dalej” sprawdza test kontrolera).
 */

const childId = "10000000-0000-4000-8000-000000000901";
const deckId = "10000000-0000-4000-8000-000000000902";
const sessionId = "10000000-0000-4000-8000-000000000903";
const taskId = "10000000-0000-4000-8000-000000000911";
const questionAudioAssetId = "10000000-0000-4000-8000-000000000921";

const VIEWPORTS = LESSON_AUDIO_VIEWPORTS;

/** Treść na granicy schematu karty (1200 znaków), z wypunktowaniem. */
const LONG_BODY = (
  "Pająki nie są owadami, chociaż wiele osób tak myśli. • Pająk ma osiem nóg, a owad sześć. " +
  "• Ciało pająka składa się z dwóch części: głowotułowia i odwłoka. • Pająki nie mają czułków ani skrzydeł. " +
  "Większość pająków tka sieci z cienkich, mocnych nici, które wytwarzają kądziołki na końcu odwłoka. "
).repeat(5).slice(0, 1200).trim();

function cardTask(withAudio: boolean): TaskDto {
  return {
    taskId, sessionId, ordinal: 0, exerciseType: "lesson_card", direction: null, state: "issued", remainingAssessed: 2,
    prompt: {
      kind: "lesson_card",
      card: {
        title: "Czym różnią się pająki od owadów żyjących w ogrodzie za domem?",
        body: LONG_BODY,
        examples: ["Pająk krzyżak tka okrągłą sieć.", "Mucha ma sześć nóg i skrzydła.", "Kosarz ma bardzo długie nogi."],
      },
      ...(withAudio ? { questionAudioAssetId } : {}),
    },
  };
}

function fixture(tasks: TaskDto[], audioReady = true): KidUiFixture {
  return lessonAudioFixture({ childId, deckId, sessionId, deckVersionId: "10000000-0000-4000-8000-000000000904" }, tasks,
    { audioReady, assessedTasksIssued: 0 });
}

async function open(page: Page, kidFixture: KidUiFixture): Promise<void> {
  await installKidUiFixture(page, kidFixture);
  await openLessonTask(page, "kid-lesson-card");
}

test("card audio sits in the card header beside the title and fits every form factor", async ({ page }, testInfo) => {
  await open(page, fixture([cardTask(true)]));
  const header = page.getByTestId("kid-lesson-card-header");
  await expect(header.getByTestId("kid-question-audio")).toHaveAttribute("aria-label", "Posłuchaj karty");
  // Wiersz instrukcji karty nie dostaje drugiego głośnika.
  await expect(page.getByTestId("kid-instruction").getByTestId("kid-question-audio")).toHaveCount(0);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expectFrameFillsViewport(page, viewport);
    const button = page.getByTestId("kid-question-audio");
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    const card = (await page.getByTestId("kid-lesson-card").boundingBox())!;
    const title = (await page.getByTestId("kid-lesson-card-title").boundingBox())!;
    expect(bounds.width, `width at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.height, `height at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.x, `inside card at ${label}`).toBeGreaterThanOrEqual(card.x - 1);
    expect(bounds.x + bounds.width, `inside card at ${label}`).toBeLessThanOrEqual(card.x + card.width + 1);
    expect(bounds.y, `inside card at ${label}`).toBeGreaterThanOrEqual(card.y - 1);
    // Tytuł zawija się obok przycisku i nigdy pod niego nie wchodzi.
    expect(title.x + title.width, `title left of button at ${label}`).toBeLessThanOrEqual(bounds.x + 1);
    expect(bounds.y + bounds.height, `in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
    expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `material overflow at ${label}`).toBe(false);

    const next = page.getByTestId("kid-lesson-next");
    await next.scrollIntoViewIfNeeded();
    const nextBounds = (await next.boundingBox())!;
    expect(nextBounds.height, `next height at ${label}`).toBeGreaterThanOrEqual(54);
    expect(nextBounds.y + nextBounds.height, `next in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
    await page.screenshot({ path: testInfo.outputPath(`card-audio-${label}.png`) });
  }
});

test("card without a recording keeps the plain centred title", async ({ page }) => {
  await open(page, fixture([cardTask(false)]));
  await expect(page.getByTestId("kid-question-audio")).toHaveCount(0);
  await expect(page.getByTestId("kid-lesson-card-header")).toHaveCount(0);
  await expect(page.getByTestId("kid-lesson-card-title")).toBeVisible();
});

test("tapping card audio fetches the prepared recording without a disclosure", async ({ page }) => {
  const mediaRequests: string[] = [];
  const disclosures: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/media/")) mediaRequests.push(path);
    if (request.method() === "POST" && path.endsWith("/disclosures")) disclosures.push(path);
  });
  await open(page, fixture([cardTask(true)]));
  expect(mediaRequests).toEqual([]);
  await page.getByTestId("kid-question-audio").click();
  await expect.poll(() => mediaRequests).toContain(`/api/v1/media/${questionAudioAssetId}`);
  expect(disclosures).toEqual([]);
  await expect(page.getByTestId("kid-question-audio-error")).toHaveCount(0);
});

test("longest card keeps listen and next reachable at 320x480", async ({ page }, testInfo) => {
  await open(page, fixture([cardTask(true)]));
  await page.setViewportSize({ width: 320, height: 480 });
  await expectReachableOnSmallPhone(page, { "kid-question-audio": 48, "kid-lesson-next": 54 });
  await page.screenshot({ path: testInfo.outputPath("card-audio-320x480.png") });
});

test("card playback error names the card and keeps next reachable", async ({ page }) => {
  await open(page, fixture([cardTask(true)], false));
  await page.setViewportSize({ width: 320, height: 480 });
  await page.getByTestId("kid-question-audio").click();
  const notice = page.getByTestId("kid-question-audio-error");
  await expect(notice).toContainText("Nie udało się odtworzyć karty");
  await expect(page.getByTestId("kid-question-audio-retry")).toHaveText("Odtwórz kartę");
  await expectReachableOnSmallPhone(page, { "kid-question-audio-retry": 48, "kid-lesson-next": 54 });
});
