import { expect, test, type Page } from "@playwright/test";
import type { AttemptDto, FeedbackDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { lessonAudioFixture, openLessonTask } from "./helpers/lesson-audio";

/**
 * Odczyt pełnego zdania po odpowiedzi w lekcji (design odczytu zdania §7, API
 * zaślepione w przeglądarce): feedback z `correctAudioAssetId` odtwarza nagranie
 * raz bez akcji dziecka, dok ma „Posłuchaj zdania”, „Dalej” przerywa odczyt,
 * a zablokowane autoodtwarzanie nie pokazuje błędu. `HTMLMediaElement.play`
 * i `pause` są podmienione — test liczy wywołania, nie słyszy dźwięku, więc
 * nie zastępuje odbioru na fizycznym urządzeniu (głośność, polityka autoplay).
 */

const ids = {
  childId: "10000000-0000-4000-8000-000000000901",
  deckId: "10000000-0000-4000-8000-000000000902",
  sessionId: "10000000-0000-4000-8000-000000000903",
  deckVersionId: "10000000-0000-4000-8000-000000000904",
};
const sentenceAssetId = "10000000-0000-4000-8000-000000000921";
const sentencePath = `/api/v1/media/${sentenceAssetId}`;

const gapTask = (n: number, stem: string): TaskDto => ({
  taskId: `10000000-0000-4000-8000-00000000091${n}`, sessionId: ids.sessionId, ordinal: n, exerciseType: "lesson_gap",
  direction: null, state: "issued", remainingAssessed: 2,
  prompt: { kind: "lesson_gap", instructionPl: "Uzupełnij lukę", stemWithGap: stem, hint: "(go)" },
});
const first = gapTask(1, "He ___ to school.");
const second = gapTask(2, "She ___ to work.");

const attempt = (feedback: FeedbackDto): AttemptDto => ({
  attemptId: "10000000-0000-4000-8000-000000000931", taskId: first.taskId, state: "completed", modality: "text",
  taskState: "answered", stepId: "s1", receivedAt: "2026-10-31T10:00:01.000Z", completedAt: "2026-10-31T10:00:01.000Z",
  feedback,
});
const withSentence = attempt({ kind: "great", correctAudioAssetId: sentenceAssetId });

type AudioMode = "hold" | "reject";

/**
 * `hold` — odtwarzanie trwa do `pause()` (bez zdarzenia `ended`), żeby „Dalej”
 * trafiło w trwający odczyt; `reject` — przeglądarka blokuje autoodtwarzanie.
 */
async function spyAudio(page: Page, mode: AudioMode = "hold"): Promise<void> {
  await page.addInitScript((audioMode: AudioMode) => {
    const counters = { plays: 0, pauses: 0 };
    (window as unknown as { __audio: typeof counters }).__audio = counters;
    HTMLMediaElement.prototype.play = function play() {
      counters.plays += 1;
      if (audioMode === "reject") return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      counters.pauses += 1;
    };
  }, mode);
}

const audioCounters = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { plays: number; pauses: number } }).__audio);

function trackMedia(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/media/")) paths.push(path);
  });
  return paths;
}

async function answer(page: Page): Promise<void> {
  await page.getByTestId("kid-lesson-gap-input").fill("goes");
  await page.getByTestId("kid-lesson-check").click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
}

async function open(page: Page, attempts: AttemptDto[], mode: AudioMode = "hold", tasks: (TaskDto | null)[] = [first, second]): Promise<string[]> {
  await spyAudio(page, mode);
  const media = trackMedia(page);
  await installKidUiFixture(page, {
    ...lessonAudioFixture(ids, tasks as TaskDto[]), attempts,
    disclosure: { taskId: first.taskId, stepId: "d1", kind: "hint", reveal: { target: "goes" } },
  });
  await openLessonTask(page, "kid-lesson-gap");
  return media;
}

test("plays the sentence once after a gap answer and replays it from the dock", async ({ page }) => {
  const media = await open(page, [withSentence]);
  expect(media).toEqual([]);
  await answer(page);
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(1);
  expect(media).toEqual([sentencePath]);
  const replay = page.getByTestId("kid-feedback-dock").getByTestId("kid-sentence-audio");
  await expect(replay).toHaveAttribute("aria-label", "Posłuchaj zdania");
  await replay.click();
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(2);
  expect(media).toEqual([sentencePath, sentencePath]);
});

test("the dock message audio is an outlined question, not a second speaker, next to the sentence button", async ({ page }) => {
  await open(page, [withSentence]);
  await answer(page);
  const dock = page.getByTestId("kid-feedback-dock");
  const guidance = dock.getByTestId("kid-guidance-play");
  const sentence = dock.getByTestId("kid-sentence-audio");
  await expect(guidance).toHaveAttribute("aria-label", "Posłuchaj");
  await expect(guidance).toHaveAttribute("data-guidance-icon", "question");
  await expect(guidance).toHaveAttribute("data-variant", "outlined");
  await expect(sentence).toHaveAttribute("data-variant", "tonal");
  await expect(sentence).toHaveClass(/kid-listen/);
  await expect(guidance).not.toHaveClass(/kid-listen/);
});

test("without the sentence recording the dock message audio keeps the speaker", async ({ page }) => {
  await open(page, [attempt({ kind: "great" })]);
  await answer(page);
  const guidance = page.getByTestId("kid-feedback-dock").getByTestId("kid-guidance-play");
  await expect(guidance).toHaveAttribute("data-guidance-icon", "speaker");
  await expect(guidance).toHaveClass(/kid-listen/);
});

test("„Nie pamiętam” with a sentence recording shows the result with readback until „Dalej”", async ({ page }) => {
  const media = await open(page, [{ ...attempt({ kind: "incorrect", correctText: "He goes to school.", correctAudioAssetId: sentenceAssetId }), modality: "dont_remember" }]);
  await page.getByTestId("kid-not-remember").click();
  await expect(page.getByTestId("kid-reveal")).toContainText("goes");
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-reveal")).toHaveCount(0);
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
  await expect(page.getByTestId("kid-feedback-correct-answer")).toContainText("He goes to school.");
  await expect(page.getByTestId("kid-sentence-audio")).toBeVisible();
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(1);
  expect(media).toEqual([sentencePath]);
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-lesson-gap")).toContainText("She");
  await expect(page.getByTestId("kid-feedback-dock")).toHaveCount(0);
});

test("„Dalej” stops the reading and the next task has no sentence button", async ({ page }) => {
  await open(page, [withSentence]);
  await answer(page);
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(1);
  const pausesBefore = (await audioCounters(page)).pauses;
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-lesson-gap")).toContainText("She");
  expect((await audioCounters(page)).pauses).toBeGreaterThan(pausesBefore);
  await expect(page.getByTestId("kid-sentence-audio")).toHaveCount(0);
  expect((await audioCounters(page)).plays).toBe(1);
});

test("blocked autoplay shows no error and keeps the replay button", async ({ page }) => {
  await open(page, [withSentence], "reject");
  await answer(page);
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(1);
  await expect(page.getByTestId("kid-sentence-audio")).toBeVisible();
  // Zakres `main`: pusty `alert` poza nim to ogłaszacz tras Next.js.
  await expect(page.locator("main.kid-learning").getByRole("alert")).toHaveCount(0);
  await expect(page.locator("main.kid-learning")).toHaveAttribute("data-action-notice", "false");
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
});

test("feedback without the sentence recording has no button and plays nothing", async ({ page }) => {
  const media = await open(page, [attempt({ kind: "great" })]);
  await answer(page);
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await expect(page.getByTestId("kid-sentence-audio")).toHaveCount(0);
  expect(media).toEqual([]);
  expect((await audioCounters(page)).plays).toBe(0);
});

test("sentence button fits the feedback dock on every form factor", async ({ page }, testInfo) => {
  await open(page, [attempt({ kind: "incorrect", correctText: "He goes to school.", correctAudioAssetId: sentenceAssetId })]);
  await answer(page);
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const label = `${viewport.width}x${viewport.height}`;
    await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
    const button = page.getByTestId("kid-sentence-audio");
    await button.scrollIntoViewIfNeeded();
    const bounds = (await button.boundingBox())!;
    const dock = (await page.getByTestId("kid-feedback-dock").boundingBox())!;
    expect(bounds.width, `width at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.height, `height at ${label}`).toBeGreaterThanOrEqual(48);
    expect(bounds.x, `inside dock at ${label}`).toBeGreaterThanOrEqual(dock.x - 1);
    expect(bounds.x + bounds.width, `inside dock at ${label}`).toBeLessThanOrEqual(dock.x + dock.width + 1);
    expect(bounds.y, `inside dock at ${label}`).toBeGreaterThanOrEqual(dock.y - 1);
    expect(bounds.y + bounds.height, `inside dock at ${label}`).toBeLessThanOrEqual(dock.y + dock.height + 1);
    expect(bounds.x, `in viewport at ${label}`).toBeGreaterThanOrEqual(-1);
    expect(bounds.y, `in viewport at ${label}`).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width, `in viewport at ${label}`).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height, `in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
    // Obrysowany „?” komunikatu obok też ma pełny cel i mieści się w doku.
    const guidance = (await page.getByTestId("kid-feedback-dock").getByTestId("kid-guidance-play").boundingBox())!;
    expect(guidance.width, `guidance width at ${label}`).toBeGreaterThanOrEqual(48);
    expect(guidance.height, `guidance height at ${label}`).toBeGreaterThanOrEqual(48);
    expect(guidance.x + guidance.width, `guidance inside dock at ${label}`).toBeLessThanOrEqual(dock.x + dock.width + 1);
    // „Dalej” pozostaje osiągalne obok przycisku odczytu.
    const next = (await page.getByTestId("kid-next").boundingBox())!;
    expect(next.y + next.height, `next in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `page overflow at ${label}`).toBe(false);
    expect(await page.getByTestId("kid-feedback-dock").evaluate((element) => element.scrollWidth > element.clientWidth + 1), `dock overflow at ${label}`).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`sentence-audio-${label}.png`) });
  }
});
