import { expect, test, type Page } from "@playwright/test";
import { assertKidLayout, installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";
import type { AttemptDto, TaskDto } from "@learning/contracts";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// S10e w Chrome mieści się między progiem redukcji viewport-short (≤700px)
// a dużymi ekranami — to strefa, w której obrazek i słowa muszą się zmieścić
// bez pomocy redukcji viewport-short.
const viewports = [
  { width: 360, height: 740 },
  { width: 360, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
];

const words = ["red", "blue", "green", "black"];

function pictureRecognitionLayoutFixture(optionCount: 2 | 3 | 4) {
  const fixture = pictureVocabularyFixture();
  const taskId = id(30);
  const imageAssetId = id(31);
  const audioAssetId = id(32);
  const task: TaskDto = {
    taskId, sessionId: fixture.session.sessionId, ordinal: 1, exerciseType: "picture_recognition",
    direction: "source_to_target", state: "issued",
    prompt: {
      kind: "picture_recognition",
      visual: { kind: "image", imageAssetId },
      source: "czerwony",
      options: words.slice(0, optionCount).map((text, index) => ({ id: id(40 + index), text })),
    },
    remainingAssessed: 2,
  };
  const attempt = (n: number, feedback: AttemptDto["feedback"], taskState: AttemptDto["taskState"]): AttemptDto => ({
    attemptId: id(n), taskId, state: "completed", modality: "choice", feedback,
    taskState, stepId: `step-${n}`, receivedAt: "2026-10-19T10:00:01.000Z", completedAt: "2026-10-19T10:00:02.000Z",
  });
  return { fixture, task, audioAssetId, attempt };
}

async function openRecognition(page: Page, fixture: KidUiFixture, task: TaskDto, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await installKidUiFixture(page, { ...fixture, tasks: [task, null] });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_recognition");
}

test("obrazek i trzy słowa mieszczą się bez przewijania na telefonach", async ({ page }, testInfo) => {
  const { fixture, task } = pictureRecognitionLayoutFixture(3);
  await openRecognition(page, fixture, task, viewports[0]!);

  await expect(page.getByTestId("kid-instruction")).toContainText("Które słowo pasuje do obrazka?");
  await expect(page.getByTestId("kid-picture-caption")).toHaveText("czerwony");

  for (const [index, viewport] of viewports.entries()) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await assertKidLayout(page);

      const geometry = await page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(".kid-material-content")!;
        const contentBounds = content.getBoundingClientRect();
        const viewportBounds = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
        const inside = (element: HTMLElement) => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= contentBounds.top && bounds.bottom <= contentBounds.bottom &&
            bounds.left >= contentBounds.left && bounds.right <= contentBounds.right;
        };
        const inViewport = (element: HTMLElement) => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom &&
            bounds.left >= viewportBounds.left && bounds.right <= viewportBounds.right;
        };
        return {
          contentScrollHeight: content.scrollHeight,
          contentClientHeight: content.clientHeight,
          contentScrollWidth: content.scrollWidth,
          contentClientWidth: content.clientWidth,
          rootScrollHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.scrollHeight,
          rootClientHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.clientHeight,
          documentScrollHeight: document.scrollingElement!.scrollHeight,
          documentClientHeight: document.scrollingElement!.clientHeight,
          illustration: (() => {
            const element = document.querySelector<HTMLElement>("[data-testid='kid-illustration']")!;
            const bounds = element.getBoundingClientRect();
            return { height: bounds.height, width: bounds.width, insideContent: inside(element), inViewport: inViewport(element) };
          })(),
          caption: (() => {
            const element = document.querySelector<HTMLElement>("[data-testid='kid-picture-caption']")!;
            return { insideContent: inside(element), inViewport: inViewport(element) };
          })(),
          options: [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((element) => ({
            height: element.getBoundingClientRect().height,
            insideContent: inside(element),
            inViewport: inViewport(element),
          })),
        };
      });

      expect(geometry.options, JSON.stringify(geometry)).toHaveLength(3);
      expect(geometry.options.every((option) => option.height >= 48), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.insideContent), JSON.stringify(geometry)).toBe(true);
      expect(geometry.options.every((option) => option.inViewport), JSON.stringify(geometry)).toBe(true);
      expect(geometry.illustration.insideContent, JSON.stringify(geometry)).toBe(true);
      expect(geometry.illustration.inViewport, JSON.stringify(geometry)).toBe(true);
      expect(geometry.illustration.height, JSON.stringify(geometry)).toBeGreaterThanOrEqual(100);
      expect(geometry.caption.insideContent, JSON.stringify(geometry)).toBe(true);
      expect(geometry.caption.inViewport, JSON.stringify(geometry)).toBe(true);
      expect(geometry.contentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientHeight + 1);
      expect(geometry.contentScrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.contentClientWidth + 1);
      expect(geometry.rootScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.rootClientHeight + 1);
      expect(geometry.documentScrollHeight, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
      if (index === 0 || index === viewports.length - 1) {
        await page.screenshot({ path: testInfo.outputPath(`recognition-${viewport.width}x${viewport.height}.png`) });
      }
    });
  }
});

for (const optionCount of [3, 4] as const) {
  test(`feedback z odsłuchem poprawnego słowa trzyma się w kadrze S10e (${optionCount} słowa)`, async ({ page }, testInfo) => {
    const { fixture, task, audioAssetId, attempt } = pictureRecognitionLayoutFixture(optionCount);
    const attempts = [attempt(50, { kind: "great", correctAudioAssetId: audioAssetId }, "answered")];
    await openRecognition(page, { ...fixture, attempts }, task, { width: 360, height: 740 });

    await page.getByTestId("kid-option").nth(0).click();
    await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
    await expect(page.getByTestId("kid-option-audio")).toHaveCount(1);
    await expect(page.getByTestId("kid-feedback-dock")).toHaveAttribute("data-compact", "true");
    await expect.poll(async () => {
      const box = await page.getByTestId("kid-next").boundingBox();
      return box ? Math.round(box.y + box.height) : 9999;
    }, { message: "compact dock action settles in view" }).toBeLessThanOrEqual(740);

    const geometry = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".kid-material-content")!;
      const optionAudio = document.querySelector<HTMLElement>("[data-testid='kid-option-audio']")!.getBoundingClientRect();
      const next = document.querySelector<HTMLElement>("[data-testid='kid-next']")!.getBoundingClientRect();
      return {
        contentScrollHeight: content.scrollHeight,
        contentClientHeight: content.clientHeight,
        rootScrollHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.scrollHeight,
        rootClientHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.clientHeight,
        optionAudio: { top: optionAudio.top, bottom: optionAudio.bottom },
        next: { top: next.top, bottom: next.bottom },
        documentScrollHeight: document.scrollingElement!.scrollHeight,
        documentClientHeight: document.scrollingElement!.clientHeight,
      };
    });
    expect(geometry.contentScrollHeight).toBeLessThanOrEqual(geometry.contentClientHeight + 1);
    expect(geometry.rootScrollHeight).toBeLessThanOrEqual(geometry.rootClientHeight + 1);
    expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
    expect(geometry.optionAudio.bottom).toBeLessThanOrEqual(geometry.documentClientHeight);
    expect(geometry.next.bottom).toBeLessThanOrEqual(geometry.documentClientHeight);
    await expect(page.getByTestId("kid-next")).toBeInViewport();
    if (optionCount === 3) {
      await page.screenshot({ path: testInfo.outputPath("recognition-feedback-360x740.png") });
    }
  });
}

test("cztery słowa mieszczą się na S10e bez przewijania", async ({ page }) => {
  const { fixture, task } = pictureRecognitionLayoutFixture(4);
  await openRecognition(page, fixture, task, { width: 360, height: 740 });

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(4);
  const positions = await options.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { bottom: bounds.bottom, height: bounds.height, inViewport: bounds.top >= 0 && bounds.bottom <= window.innerHeight };
  }));
  expect(positions.every((position) => position.inViewport)).toBe(true);
  expect(positions.every((position) => position.height >= 48)).toBe(true);
  const geometry = await page.evaluate(() => ({
    contentScrollHeight: document.querySelector<HTMLElement>(".kid-material-content")!.scrollHeight,
    contentClientHeight: document.querySelector<HTMLElement>(".kid-material-content")!.clientHeight,
    rootScrollHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.scrollHeight,
    rootClientHeight: document.querySelector<HTMLElement>("[data-testid='kid-session-frame']")!.clientHeight,
    documentScrollHeight: document.scrollingElement!.scrollHeight,
    documentClientHeight: document.scrollingElement!.clientHeight,
  }));
  expect(geometry.contentScrollHeight).toBeLessThanOrEqual(geometry.contentClientHeight + 1);
  expect(geometry.rootScrollHeight).toBeLessThanOrEqual(geometry.rootClientHeight + 1);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
  await expect(page.getByTestId("kid-end")).toBeInViewport();
});

test("układ poziomy zachowuje dostęp do wszystkich odpowiedzi i końca sesji", async ({ page }) => {
  const { fixture, task } = pictureRecognitionLayoutFixture(3);
  await openRecognition(page, fixture, task, { width: 844, height: 390 });

  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(3);
  await options.last().scrollIntoViewIfNeeded();
  await expect(options.last()).toBeInViewport();
  await page.getByTestId("kid-end").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-end")).toBeInViewport();
});
