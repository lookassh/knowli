import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { completedRecallFixture, makeDeck, openDeckScreen, sessionId } from "./helpers/kid-fixtures";
import { expectFrameFillsViewport, expectInteractiveTargets, waitForKidScale } from "./helpers/kid-frame";
import { measure, resizeAndSettle, type Viewport } from "./helpers/kid-layout";
import { lessonAudioFixture } from "./helpers/lesson-audio";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureChoiceLayoutFixture } from "./helpers/picture-fixtures";

// Large windows zoom the whole Kid UI by min(width / 840, height / 900), capped at 1.6 and rounded
// down to 0.01 (spec 2026-10-30-kid-ui-large-screens §3.4). Expected scales are written out on purpose.
const SESSION_WINDOWS = [
  { width: 1280, height: 600, scale: 1 },
  { width: 1536, height: 730, scale: 1 },
  { width: 1920, height: 1080, scale: 1.2 },
  { width: 1146, height: 1300, scale: 1.36 },
  { width: 3440, height: 1300, scale: 1.44 },
  { width: 3440, height: 1440, scale: 1.6 },
] as const;

const ULTRAWIDE = { width: 3440, height: 1440 };

async function openPictureChoice(page: Page) {
  await installKidUiFixture(page, pictureChoiceLayoutFixture());
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");
}

async function openWrittenRecall(page: Page, fixture: KidUiFixture = completedRecallFixture()) {
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
}

/** Document scroll size against the window: zoom must not make the page wider or taller than the screen. */
async function documentOverflow(page: Page) {
  return page.evaluate(() => ({
    width: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight - window.innerHeight,
  }));
}

async function expectSessionFitsWindow(page: Page, viewport: Viewport) {
  const name = `${viewport.width}x${viewport.height}`;
  await expectFrameFillsViewport(page, viewport);
  const overflow = await documentOverflow(page);
  expect(overflow.width, `horizontal overflow: ${name}`).toBeLessThanOrEqual(0);
  expect(overflow.height, `vertical overflow: ${name}`).toBeLessThanOrEqual(0);
}

for (const { width, height, scale } of SESSION_WINDOWS) {
  test(`session at ${width}x${height} uses scale ${scale} and fills the window`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPictureChoice(page);
    await waitForKidScale(page, scale);
    await expectSessionFitsWindow(page, { width, height });
  });
}

test("rescales on resize", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openPictureChoice(page);
  await waitForKidScale(page, 1.6);
  await expectSessionFitsWindow(page, ULTRAWIDE);

  const fullHd = { width: 1920, height: 1080 };
  await resizeAndSettle(page, fullHd);
  await waitForKidScale(page, 1.2);
  await expectSessionFitsWindow(page, fullHd);
});

test("short flow screens do not scroll", async ({ page }) => {
  const fixture: KidUiFixture = {
    ...completedRecallFixture(),
    summary: { sessionId, state: "completed", tasksIssued: 1, assessedTasksIssued: 1, endedAt: "2026-10-11T10:01:00.000Z",
      independentSuccesses: { recall: 1, spelling: 0 }, practiceItems: [] },
  };
  await installKidUiFixture(page, fixture);
  await page.setViewportSize(ULTRAWIDE);
  await page.goto("/");

  const expectFlowFitsWindow = async (name: string) => {
    await waitForKidScale(page, 1.6);
    // Window-unit tokens divide by --kid-zoom, so min-height 100dvh stays one screen tall under zoom.
    await expect.poll(async () => {
      const layout = await measure(page, { page: ".kid-page" });
      const overflow = await documentOverflow(page);
      const deviation = Math.max(Math.abs(layout.page.left), Math.abs(layout.page.top),
        Math.abs(layout.page.width - ULTRAWIDE.width), Math.abs(layout.page.height - ULTRAWIDE.height));
      return overflow.width <= 0 && overflow.height <= 1 && deviation <= 1 ? "ok" : JSON.stringify({ page: layout.page, overflow });
    }, { message: `${name} fits the window without scrolling` }).toBe("ok");
  };

  await expect(page.getByTestId("kid-profile")).toHaveCount(1);
  await expectFlowFitsWindow("profile screen");

  await page.getByTestId("kid-profile").click();
  await expect(page.getByTestId("kid-deck-screen")).toBeVisible();
  await expectFlowFitsWindow("deck screen");

  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();
  await page.getByTestId("kid-end-confirm-end").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expectFlowFitsWindow("summary");
});

test("answer text scales", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await waitForKidScale(page, 1.6);
  // A rectangle is in screen pixels and offsetHeight in inner pixels: their ratio is the zoom.
  const ratio = await page.getByTestId("kid-input").evaluate((element: HTMLElement) =>
    element.getBoundingClientRect().height / element.offsetHeight);
  expect(ratio).toBeGreaterThanOrEqual(1.59);
  expect(ratio).toBeLessThanOrEqual(1.61);
});

test("targets stay large", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await page.getByTestId("kid-input").fill("cat");
  await waitForKidScale(page, 1.6);
  await expectInteractiveTargets(page, [
    "[data-testid='kid-input']",
    "[data-testid='kid-submit']",
    "[data-testid='kid-not-remember']",
    "[data-testid='kid-end']",
  ]);
  const submit = await page.getByTestId("kid-submit").boundingBox();
  expect(submit!.height, "primary action height").toBeGreaterThanOrEqual(54);
});

test("end-session sheet", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page);
  await waitForKidScale(page, 1.6);
  await page.getByTestId("kid-end").click();
  await expect(page.getByTestId("kid-end-confirm")).toBeVisible();
  const layout = await measure(page, {
    scrim: "[data-testid='kid-end-confirm-scrim']",
    sheet: "[data-testid='kid-end-confirm']",
  });
  expect(Math.abs(layout.scrim.left), "scrim left").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.top), "scrim top").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.width - ULTRAWIDE.width), "scrim width").toBeLessThanOrEqual(1);
  expect(Math.abs(layout.scrim.height - ULTRAWIDE.height), "scrim height").toBeLessThanOrEqual(1);
  // The sheet keeps its 560 px column cap in inner pixels, i.e. 560 x 1.6 on screen.
  expect(layout.sheet.width, "sheet width").toBeLessThanOrEqual(560 * 1.6 + 1);
  expect(Math.abs((layout.sheet.left + layout.sheet.right) / 2 - ULTRAWIDE.width / 2), "sheet centred").toBeLessThanOrEqual(1);
  expect(layout.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(layout.innerWidth);
});

// JS measurements under zoom (spec §4.4): rectangles are screen pixels, offset/scroll lengths and position: fixed
// lengths are inner pixels. The checks below compare screen rectangles only, at scale 1.6.
const ULTRAWIDE_SCALE = 1.6;

// A long source prompt (about half the material's height) and a spelling hint whose dock covers the answer form.
// The material must not overflow before the verdict: .materialContent (flex: 1 with an explicit min-height) does not
// grow with overflowing children, so the reserve padding would not lengthen the scroll range — a known limitation.
const LONG_RECALL_PROMPT = "Przetłumacz całe zdanie: dzieci szły starym drewnianym mostem nad rzeką i liczyły łódki, "
  + "które powoli płynęły do portu, zanim słońce schowało się za wzgórzami, a w miasteczku zapaliły się wszystkie światła.";
const HINT_START = "The children walked along the old wooden bridge near the river, ";
const HINT_FIX = "counting the little boats";
const HINT_END = " that sailed slowly towards the harbour before the sun went down behind the hills and the lights came on.";

function longSpellingHintFixture(): KidUiFixture {
  const fixture = completedRecallFixture({
    feedback: {
      kind: "spelling_hint",
      correctText: HINT_START + HINT_FIX + HINT_END,
      spellingDiff: {
        given: [{ text: HINT_START, state: "plain" }, { text: "cownting the litle bots", state: "pill" }, { text: HINT_END, state: "plain" }],
        expected: [{ text: HINT_START, state: "plain" }, { text: HINT_FIX, state: "pill" }, { text: HINT_END, state: "plain" }],
      },
    },
  });
  return { ...fixture, tasks: [{ ...fixture.tasks[0]!, prompt: { kind: "recall", prompt: LONG_RECALL_PROMPT } }] };
}

/** Reads the overlay reserve geometry once it stops changing (the reserve and its correcting scroll take a few frames). */
async function settledDockReserve(page: Page) {
  return page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
    const read = () => {
      const material = document.querySelector<HTMLElement>("[data-testid='kid-material']")!;
      const content = material.querySelector<HTMLElement>(".kid-material-content")!;
      const dock = document.querySelector<HTMLElement>("[data-testid='kid-feedback-dock']")!;
      return {
        inlineReserve: Number.parseFloat(content.style.paddingBottom) || 0,
        scrollTop: material.scrollTop,
        lastChildBottom: content.lastElementChild!.getBoundingClientRect().bottom,
        dockTop: dock.getBoundingClientRect().top,
      };
    };
    let previous = read();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await frame();
      await frame();
      const next = read();
      if (JSON.stringify(next) === JSON.stringify(previous)) return next;
      previous = next;
    }
    return previous;
  });
}

test("overlay dock reserve is exact", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openWrittenRecall(page, longSpellingHintFixture());
  await waitForKidScale(page, ULTRAWIDE_SCALE);
  expect(await page.getByTestId("kid-material").evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    "the long prompt still fits the material before the verdict").toBe(true);
  await page.getByTestId("kid-input").fill("the children walked");
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();

  const geometry = await settledDockReserve(page);
  const details = JSON.stringify(geometry);
  // The dock really covers the content: without overlap the reserve stays off and the bound below proves nothing.
  expect(geometry.inlineReserve, `dock reserve engaged: ${details}`).toBeGreaterThan(0);
  // The correcting scroll leaves the answer 8 inner px above the dock: not under it, and not scrolled past it.
  expect(geometry.lastChildBottom, `answer above the dock: ${details}`).toBeLessThanOrEqual(geometry.dockTop + 1);
  expect(geometry.lastChildBottom, `answer right above the dock: ${details}`)
    .toBeGreaterThanOrEqual(geometry.dockTop - (8 * ULTRAWIDE_SCALE + 3));
});

test("microphone panel opens under its button", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openDeckScreen(page, [makeDeck(0)]);
  await waitForKidScale(page, ULTRAWIDE_SCALE);
  const button = page.getByTestId("kid-mic-settings");
  await button.click();
  const panel = page.getByTestId("kid-mic-settings-panel");
  await expect(panel).toBeVisible();
  // JS has placed the panel; its static position would sit right under the button anyway.
  await expect.poll(() => panel.evaluate((element: HTMLElement) => element.style.left !== "" && element.style.top !== "")).toBe(true);

  const buttonBox = (await button.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  const details = JSON.stringify({ buttonBox, panelBox });
  const buttonBottom = buttonBox.y + buttonBox.height;
  expect(panelBox.y, `panel below the button: ${details}`).toBeGreaterThanOrEqual(buttonBottom);
  expect(panelBox.y, `panel right below the button: ${details}`).toBeLessThanOrEqual(buttonBottom + 8 * ULTRAWIDE_SCALE + 2);
  // The 280 px panel fits the window, so it starts at the button's left edge.
  expect(Math.abs(panelBox.x - buttonBox.x), `panel aligned with the button: ${details}`).toBeLessThanOrEqual(2);
});

// A question long enough to push the answer field below the visible material at 3440x1440.
const LONG_LESSON_TEXT = (
  "Pająki nie są owadami, chociaż wiele osób tak myśli. Pająk ma osiem nóg, a owad sześć. "
  + "Ciało pająka składa się z dwóch części: głowotułowia i odwłoka. Pająki nie mają czułków ani skrzydeł. "
  + "Większość pająków tka sieci z cienkich, mocnych nici, które wytwarzają kądziołki na końcu odwłoka. "
).repeat(5).slice(0, 1200).trim() + " Czym różni się pająk od owada?";

function longQuestionFixture(): KidUiFixture {
  const ids = {
    childId: "10000000-0000-4000-8000-000000000a01",
    deckId: "10000000-0000-4000-8000-000000000a02",
    sessionId: "10000000-0000-4000-8000-000000000a03",
    deckVersionId: "10000000-0000-4000-8000-000000000a04",
  };
  const task: TaskDto = {
    taskId: "10000000-0000-4000-8000-000000000a11", sessionId: ids.sessionId, ordinal: 0, exerciseType: "lesson_open_answer",
    direction: null, state: "issued", remainingAssessed: 2,
    prompt: { kind: "lesson_open_answer", instructionPl: "Odpowiedz własnymi słowami.", prompt: LONG_LESSON_TEXT, promptLocale: "pl-PL",
      questionAudioAssetId: "10000000-0000-4000-8000-000000000a21" },
  };
  return lessonAudioFixture(ids, [task]);
}

test("keyboard focus stays visible", async ({ page }) => {
  await installKidUiFixture(page, longQuestionFixture());
  await page.setViewportSize(ULTRAWIDE);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  const field = page.getByTestId("kid-lesson-input");
  await expect(field).toBeVisible();
  await waitForKidScale(page, ULTRAWIDE_SCALE);

  // The question audio button in the instruction row is the control right before the field.
  await page.getByTestId("kid-question-audio").focus();
  const before = await measure(page, { field: "[data-testid='kid-lesson-input']", material: "[data-testid='kid-material']" });
  expect(before.field.top, `field starts below the visible material: ${JSON.stringify(before)}`).toBeGreaterThan(before.material.bottom);

  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await expect.poll(async () => {
    const layout = await measure(page, {
      field: "[data-testid='kid-lesson-input']",
      material: "[data-testid='kid-material']",
      actions: "[data-testid='kid-exercise-actions']",
    });
    const visible = layout.field.top >= layout.material.top - 1 && layout.field.bottom <= layout.material.bottom + 1
      && layout.field.bottom <= layout.actions.top + 1;
    return visible ? "ok" : JSON.stringify(layout);
  }, { message: "focused field is inside the material and above the actions" }).toBe("ok");
});
