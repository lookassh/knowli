import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AttemptDto, FeedbackDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { recordAttemptPosts, tapPoolAndCheck } from "./helpers/lesson-assignment-task";
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
  await expect.poll(() => media).toEqual([sentencePath]);
  const replay = page.getByTestId("kid-feedback-dock").getByTestId("kid-sentence-audio");
  await expect(replay).toHaveAttribute("aria-label", "Posłuchaj zdania");
  await replay.click();
  await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(2);
  await expect.poll(() => media).toEqual([sentencePath, sentencePath]);
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
  await expect.poll(() => media).toEqual([sentencePath]);
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

/**
 * Tekst z lukami i bankiem słów („Angielski — rozdział”, `lesson_cloze` z
 * `contentLocale` en-GB): odczyt pełnego, kilkuzdaniowego tekstu po odpowiedzi.
 * Dłuższy bodziec niż jednozdaniowe luki gramatyki, a `correctText` to cały
 * wypełniony tekst — dok musi zmieścić w viewporcie „Posłuchaj zdania”, „?”
 * i „Dalej” także w niskim landscape (<480 px), a długa treść wyniku przewija
 * się wewnątrz doku. Materiał obok doku zachowuje czytelne minimum, a pierwszą
 * lukę tekstu da się przewinąć do kontenera materiału nad dokiem (telefon,
 * landscape, tablet, desktop). Treść jest zmyślona. Symulacja nie zastępuje
 * odbioru na fizycznym urządzeniu.
 */
const clozeUid = (n: number) => `10000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`;
const clozeSolution = ["sun hat", "swimming costume", "sandcastle"];
const clozeTask: TaskDto = {
  taskId: clozeUid(41), sessionId: ids.sessionId, ordinal: 1, exerciseType: "lesson_cloze", direction: null, state: "issued", remainingAssessed: 2,
  prompt: {
    kind: "lesson_cloze",
    instructionPl: "W weekend jedziemy nad morze. Rano zakładam kapelusz przeciwsłoneczny i strój kąpielowy. Mój młodszy brat buduje na plaży duży zamek z piasku, a mama kupuje nam lody. Uzupełnij tekst.",
    contentLocale: "en-GB",
    segments: [
      { text: "At the weekend we go to the seaside. In the morning I put on my " },
      { gapId: clozeUid(42) },
      { text: " and my " },
      { gapId: clozeUid(43) },
      { text: ". My little brother builds a big " },
      { gapId: clozeUid(44) },
      { text: " on the beach, and Mum buys us ice cream." },
    ],
    words: [
      { id: clozeUid(51), text: "sun hat" },
      { id: clozeUid(52), text: "swimming costume" },
      { id: clozeUid(53), text: "sandcastle" },
      { id: clozeUid(54), text: "umbrella" },
      { id: clozeUid(55), text: "woolly gloves" },
    ],
  },
};
/** Pełny wypełniony tekst z poprawnymi słowami (jak `filledText` serwera). */
const clozeFilledText = (() => {
  if (clozeTask.prompt.kind !== "lesson_cloze") throw new Error("cloze fixture expected");
  let gap = 0;
  return clozeTask.prompt.segments.map((segment) => ("gapId" in segment ? clozeSolution[gap++] : segment.text)).join("");
})();

const clozeAttempt = (feedback: FeedbackDto): AttemptDto => ({
  attemptId: clozeUid(61), taskId: clozeTask.taskId, state: "completed", modality: "assignment",
  taskState: "answered", stepId: "s1", receivedAt: "2026-10-31T10:00:01.000Z", completedAt: "2026-10-31T10:00:01.000Z",
  feedback,
});

const CLOZE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 812, height: 375 },
  { width: 740, height: 420 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

const CLOZE_FEEDBACKS: { kind: string; feedback: FeedbackDto }[] = [
  { kind: "great", feedback: { kind: "great", correctAudioAssetId: sentenceAssetId } },
  { kind: "incorrect", feedback: { kind: "incorrect", correctText: clozeFilledText, correctAudioAssetId: sentenceAssetId } },
];

/**
 * Najmniejsza widoczna wysokość materiału obok doku: dwa cele dotykowe 48 px
 * (wiersz tekstu z luką i miejsce luki). Pomiar 2026-10-31: z nakładką
 * najciaśniej jest na 360×800 po błędzie (dok z całym tekstem zakrywa dół
 * materiału, nad nim zostaje ok. 167 px); przy wysokości <480 (812×375,
 * 740×420) materiał ma naturalną wysokość ok. 407 px i przewija strona.
 */
const MIN_VISIBLE_MATERIAL = 96;

interface Box { x: number; y: number; width: number; height: number }

const within = (inner: Box, outer: Box): boolean => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
  && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1
  && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function boxOf(locator: Locator): Promise<Box> {
  const bounds = await locator.boundingBox();
  if (bounds === null) throw new Error("element has no layout box");
  return bounds;
}

test.describe("cloze with a word bank: sentence readback dock geometry", () => {
  for (const viewport of CLOZE_VIEWPORTS) {
    for (const { kind, feedback } of CLOZE_FEEDBACKS) {
      const label = `${viewport.width}x${viewport.height}`;
      test(`„Posłuchaj zdania” and „Dalej” fit ${label} after a ${kind} answer`, async ({ page }, testInfo) => {
        const posted = recordAttemptPosts(page);
        await spyAudio(page);
        const media = trackMedia(page);
        await installKidUiFixture(page, { ...lessonAudioFixture(ids, [clozeTask]), attempts: [clozeAttempt(feedback)] });
        await openLessonTask(page, "kid-lesson-cloze");
        await page.setViewportSize(viewport);
        await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
        await expect(page.getByTestId("kid-lesson-cloze-gap")).toHaveCount(3);
        expect(media).toEqual([]);

        // Odpowiedź ułożona w przeglądarce: trzy stuknięcia w bank, potem „Sprawdź”.
        await tapPoolAndCheck(page, "kid-lesson-cloze-option", 3, posted);
        const dock = page.getByTestId("kid-feedback-dock");
        await expect(dock).toBeVisible();
        if (kind === "great") await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
        else await expect(page.getByTestId("kid-feedback-correct-answer")).toHaveText(clozeFilledText);

        // Nagranie całego tekstu gra raz, bez akcji dziecka.
        await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(1);
        await expect.poll(() => media).toEqual([sentencePath]);

        // Dok i jego akcje stoją w viewporcie bez przewijania strony.
        const viewportBox: Box = { x: 0, y: 0, width: viewport.width, height: viewport.height };
        const dockBox = await boxOf(dock);
        expect(within(dockBox, viewportBox), `dock in viewport at ${label}: ${JSON.stringify(dockBox)}`).toBe(true);
        const sentence = dock.getByTestId("kid-sentence-audio");
        const guidance = dock.getByTestId("kid-guidance-play");
        const next = dock.getByTestId("kid-next");
        await expect(sentence).toHaveAttribute("aria-label", "Posłuchaj zdania");
        const boxes = { sentence: await boxOf(sentence), guidance: await boxOf(guidance), next: await boxOf(next) };
        for (const [name, bounds] of Object.entries(boxes)) {
          expect(within(bounds, dockBox), `${name} inside dock at ${label}: ${JSON.stringify(bounds)}`).toBe(true);
          expect(within(bounds, viewportBox), `${name} inside viewport at ${label}: ${JSON.stringify(bounds)}`).toBe(true);
          expect(bounds.width, `${name} width at ${label}`).toBeGreaterThanOrEqual(48);
          expect(bounds.height, `${name} height at ${label}`).toBeGreaterThanOrEqual(48);
        }
        // „Dalej” to akcja główna.
        expect(boxes.next.height, `next height at ${label}`).toBeGreaterThanOrEqual(54);
        expect(overlaps(boxes.sentence, boxes.guidance), `sentence/guidance overlap at ${label}`).toBe(false);
        expect(overlaps(boxes.sentence, boxes.next), `sentence/next overlap at ${label}`).toBe(false);
        expect(overlaps(boxes.guidance, boxes.next), `guidance/next overlap at ${label}`).toBe(false);

        // Kontener materiału obok doku. Poniżej 480 px wysokości przewija się strona, a dok stoi
        // w przepływie pod materiałem; wyżej dok jest nakładką na dolną krawędź materiału
        // (`ExerciseFrame`), więc widoczny materiał kończy się na górnej krawędzi doku.
        const pageScrolls = viewport.height < 480;
        if (pageScrolls) await expect(page.locator(".kid-page")).toHaveAttribute("data-viewport-very-short", "true");
        else await expect(page.locator(".kid-page")).not.toHaveAttribute("data-viewport-very-short", "true");
        // Materiał i dok mierzone w jednej chwili — przewinięcie strony po pokazaniu doku nie
        // rozjedzie porównania.
        const material = page.getByTestId("kid-material");
        const [materialBox, dockWithMaterial] = await page.evaluate(() => {
          const rect = (testId: string) => {
            const r = document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          return [rect("kid-material"), rect("kid-feedback-dock")] as const;
        });
        const materialBottom = materialBox.y + materialBox.height;
        const geometry = `material ${JSON.stringify(materialBox)}, dock ${JSON.stringify(dockWithMaterial)} at ${label}`;
        if (pageScrolls) {
          expect(materialBottom, `material bottom above the dock: ${geometry}`).toBeLessThanOrEqual(dockWithMaterial.y + 1);
          // Materiał ma naturalną wysokość (nie jest ściśnięty przez dok) — przewija strona.
          expect(materialBox.height, `material height: ${geometry}`).toBeGreaterThanOrEqual(MIN_VISIBLE_MATERIAL);
        } else {
          const visible = Math.min(materialBottom, dockWithMaterial.y) - Math.max(materialBox.y, 0);
          expect(visible, `material visible above the dock: ${geometry}`).toBeGreaterThanOrEqual(MIN_VISIBLE_MATERIAL);
        }
        // Wynik z całym tekstem mieści się w szerokości doku (wysokość przewija się w środku).
        const result = await boxOf(page.getByTestId("kid-feedback"));
        expect(result.x, `feedback inside dock at ${label}`).toBeGreaterThanOrEqual(dockBox.x - 1);
        expect(result.x + result.width, `feedback inside dock at ${label}`).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);

        const overflow = await page.evaluate(() => {
          const horizontal = (element: Element | null): boolean => element !== null && element.scrollWidth > element.clientWidth + 1;
          return {
            page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            material: horizontal(document.querySelector("[data-testid='kid-material']")),
            dock: horizontal(document.querySelector("[data-testid='kid-feedback-dock']")),
            feedback: horizontal(document.querySelector("[data-testid='kid-feedback']")),
          };
        });
        expect(overflow, `horizontal overflow at ${label}`).toEqual({ page: false, material: false, dock: false, feedback: false });
        await page.screenshot({ path: testInfo.outputPath(`cloze-sentence-audio-${kind}-${label}.png`) });

        // Długi wypełniony tekst nie jest trwale przycięty: po przewinięciu treści wyniku do końca
        // jego ostatnia linia stoi w obszarze treści doku i w viewporcie.
        if (kind === "incorrect") {
          const content = dock.locator(".kid-feedback-content");
          await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          const contentBox = await boxOf(content);
          const answerBox = await boxOf(page.getByTestId("kid-feedback-correct-answer"));
          expect(answerBox.y + answerBox.height, `last line in feedback content at ${label}`).toBeLessThanOrEqual(contentBox.y + contentBox.height + 1);
          expect(answerBox.y + answerBox.height, `last line in viewport at ${label}`).toBeLessThanOrEqual(viewport.height + 1);
          await content.evaluate((element) => { element.scrollTop = 0; });
        }

        // Pierwszą lukę tekstu da się przewinąć do kontenera materiału: w nim, w viewporcie i nad dokiem.
        const firstGap = page.getByTestId("kid-lesson-cloze-gap").first();
        await firstGap.scrollIntoViewIfNeeded();
        const gapBox = await boxOf(firstGap);
        const materialNow = await boxOf(material);
        const dockNow = await boxOf(dock);
        const reached = `gap ${JSON.stringify(gapBox)}, material ${JSON.stringify(materialNow)}, dock ${JSON.stringify(dockNow)} at ${label}`;
        expect(within(gapBox, materialNow), `first gap inside material: ${reached}`).toBe(true);
        expect(within(gapBox, viewportBox), `first gap inside viewport: ${reached}`).toBe(true);
        expect(gapBox.y + gapBox.height, `first gap above the dock: ${reached}`).toBeLessThanOrEqual(dockNow.y + 1);

        // Autoodtwarzanie nie powtórzyło się samo; „Posłuchaj zdania” gra drugi raz.
        expect((await audioCounters(page)).plays).toBe(1);
        await sentence.click();
        await expect.poll(() => audioCounters(page).then((c) => c.plays)).toBe(2);
        await expect.poll(() => media).toEqual([sentencePath, sentencePath]);
      });
    }
  }
});
