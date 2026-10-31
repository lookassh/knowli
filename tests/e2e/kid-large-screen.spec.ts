import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { completedRecallFixture, completedTextChoiceFixture, longLessonCardFixture, makeDeck, openDeckScreen, sessionId } from "./helpers/kid-fixtures";
import { expectFrameFillsViewport, expectInteractiveTargets, waitForKidScale } from "./helpers/kid-frame";
import { measure, resizeAndSettle, type Viewport } from "./helpers/kid-layout";
import { lessonAudioFixture } from "./helpers/lesson-audio";
import { installKidUiFixture, silentWavBuffer, type KidUiFixture } from "./helpers/kid-ui-fixture";
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

// --kid-column-max-width and --kid-visual-choice-max-size from expanded width on (spec §3.1): 720 / 300 px in inner pixels.
const COLUMN_MAX = 720;
const VISUAL_CHOICE_MAX = 300;

async function openPictureChoice(page: Page, fixture: KidUiFixture = pictureChoiceLayoutFixture()) {
  await installKidUiFixture(page, fixture);
  // Without the instruction audio the session shows an "audio unavailable" notice that takes ~87 px of the material.
  await page.route("**/api/v1/media/10000000-0000-4000-8000-000000000012", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: silentWavBuffer() }));
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();
  await page.getByTestId("kid-done").click();
  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_listening");
}

/** Opens the first task of a single-profile, single-deck session. */
async function openSession(page: Page, fixture: KidUiFixture) {
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
}

async function openWrittenRecall(page: Page, fixture: KidUiFixture = completedRecallFixture()) {
  await openSession(page, fixture);
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
  // The sheet takes the 720 px column token (inner pixels), i.e. 720 x 1.6 on screen.
  expect(layout.sheet.width, "sheet width").toBeLessThanOrEqual(COLUMN_MAX * 1.6 + 1);
  expect(layout.sheet.width, "sheet is a full column").toBeGreaterThanOrEqual(COLUMN_MAX * 1.6 - 1);
  expect(Math.abs((layout.sheet.left + layout.sheet.right) / 2 - ULTRAWIDE.width / 2), "sheet centred").toBeLessThanOrEqual(1);
  expect(layout.scrollWidth, "horizontal overflow").toBeLessThanOrEqual(layout.innerWidth);
});

/** Waits for the column (a screen rectangle) to have the expected width and sit in the middle of the window (± 1 px). */
async function expectColumn(page: Page, selector: string, name: string, expectedWidth: number) {
  await expect.poll(async () => {
    const { column, innerWidth } = await measure(page, { column: selector });
    const centred = Math.abs((column.left + column.right) / 2 - innerWidth / 2) <= 1;
    return Math.abs(column.width - expectedWidth) <= 1 && centred ? "ok" : JSON.stringify({ column, innerWidth, expectedWidth });
  }, { message: `column ${selector} at ${name} is ${expectedWidth}px wide and centred` }).toBe("ok");
}

// The column is 560 px below expanded width or on a low window (a phone in landscape, a tablet in portrait),
// 720 px from 840 x 480 on; on a narrow phone it is the whole window.
const COLUMN_CONTROL_WINDOWS = [
  { width: 844, height: 390, column: 560 },
  { width: 768, height: 1024, column: 560 },
] as const;

for (const [name, selector, open] of [
  ["session", ".kid-learning", (page: Page) => openWrittenRecall(page)],
  ["flow screen", "[data-kid-screen='true']", (page: Page) => openDeckScreen(page, [makeDeck(0)])],
] as const) {
  test(`${name} column width follows the token`, async ({ page }) => {
    await page.setViewportSize(SESSION_WINDOWS[0]);
    await open(page);
    for (const { width, height, scale } of SESSION_WINDOWS) {
      await resizeAndSettle(page, { width, height });
      await waitForKidScale(page, scale);
      await expectColumn(page, selector, `${width}x${height}`, COLUMN_MAX * scale);
    }
    for (const { width, height, column } of COLUMN_CONTROL_WINDOWS) {
      await resizeAndSettle(page, { width, height });
      await waitForKidScale(page, 1);
      await expectColumn(page, selector, `${width}x${height}`, column);
    }
    await resizeAndSettle(page, { width: 390, height: 750 });
    await waitForKidScale(page, 1);
    const phone = await measure(page, { column: selector });
    // The whole window width: the 16 px margins are padding inside the column.
    expect(phone.column.width, "phone column fills the window").toBeGreaterThanOrEqual(390 - 1);
    expect(phone.column.width, "phone column stays in the window").toBeLessThanOrEqual(390 + 1);
  });
}

test.describe("touch tablet in landscape", () => {
  // A touch tablet never scales (no fine pointer) but is wide enough for the 720 px column.
  test.use({ viewport: { width: 1366, height: 1024 }, isMobile: true, hasTouch: true });

  test("session column is 720 px at scale 1", async ({ page }) => {
    await openWrittenRecall(page);
    await waitForKidScale(page, 1);
    await expectColumn(page, ".kid-learning", "1366x1024 touch", COLUMN_MAX);
  });

  test("flow screen column is 720 px at scale 1", async ({ page }) => {
    await openDeckScreen(page, [makeDeck(0)]);
    await waitForKidScale(page, 1);
    await expectColumn(page, "[data-kid-screen='true']", "1366x1024 touch", COLUMN_MAX);
  });
});

/** Four colour tiles: no image assets, so the tile size is the only thing under test. */
function fourPictureTilesFixture(): KidUiFixture {
  const fixture = pictureChoiceLayoutFixture();
  const listening = fixture.tasks[1];
  if (!listening || listening.prompt.kind !== "picture_listening") throw new Error("picture listening fixture missing");
  const colors = ["#ffff00", "#ff00ff", "#00ffff", "#ff8800"];
  fixture.tasks = [fixture.tasks[0]!, {
    ...listening,
    prompt: { ...listening.prompt, options: colors.map((color, index) => ({
      id: `10000000-0000-4000-8000-${String(90 + index).padStart(12, "0")}`,
      labelPl: `Kolor ${index + 1}`,
      visual: { kind: "color" as const, color },
    })) },
  }, fixture.tasks[2]!];
  return fixture;
}

/** Tile rectangles (screen pixels) and the material rectangle that bounds them (inner pixels, as container units are). */
async function pictureTiles(page: Page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>("[data-testid='kid-option']")].map((element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { left, top, width, height };
    });
    // 100cqw / 100cqh come from the nearest size container above the tile grid.
    let container: HTMLElement | null = document.querySelector<HTMLElement>(".kid-picture-options")!.parentElement;
    while (container && !getComputedStyle(container).containerType.includes("size")) container = container.parentElement;
    return { tiles, container: { width: container!.clientWidth, height: container!.clientHeight } };
  });
}

for (const { width, height, scale } of [{ width: 1920, height: 1080, scale: 1.2 }, { width: 3440, height: 1440, scale: 1.6 }]) {
  test(`picture tiles use the new cap and keep their size after the verdict at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPictureChoice(page, fourPictureTilesFixture());
    await waitForKidScale(page, scale);
    await expect(page.getByTestId("kid-option")).toHaveCount(4);
    // Let the grid settle (fonts, first layout pass) before reading the tile size.
    await page.evaluate(async () => { await document.fonts.ready; });

    const before = await pictureTiles(page);
    // --visual-choice-size: the cap, half the material width, or the material height shared by two rows (never below 112).
    const gap = 12;
    const limit = Math.min(VISUAL_CHOICE_MAX, (before.container.width - gap) / 2, Math.max(112, (before.container.height - gap) / 2));
    if (width === ULTRAWIDE.width) {
      // The material is tall and wide enough here, so only the cap can decide: 300 x 1.6 = 480, not 260 x 1.6 = 416.
      expect(limit, `material allows the full cap: ${JSON.stringify(before.container)}`).toBe(VISUAL_CHOICE_MAX);
    }
    for (const [index, tile] of before.tiles.entries()) {
      expect(Math.abs(tile.width - limit * scale), `tile ${index} width: ${JSON.stringify({ tile, limit, scale })}`).toBeLessThanOrEqual(2);
      expect(Math.abs(tile.height - limit * scale), `tile ${index} height: ${JSON.stringify({ tile, limit, scale })}`).toBeLessThanOrEqual(2);
    }

    await page.getByTestId("kid-option").first().click();
    await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
    await expect(page.getByTestId("kid-next")).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    const after = await pictureTiles(page);
    expect(after.tiles).toHaveLength(before.tiles.length);
    for (const [index, tile] of after.tiles.entries()) {
      const was = before.tiles[index]!;
      for (const key of ["left", "top", "width", "height"] as const) {
        expect(Math.abs(tile[key] - was[key]), `tile ${index} ${key} after the verdict: ${JSON.stringify({ was, tile })}`).toBeLessThanOrEqual(1);
      }
    }
  });
}

// Compact exercise frame from 840 x 781 on (spec §3.2): the instruction, the answers and the footer (action or
// result panel) stand together at the top, so no empty band separates the answers from the footer. Every window here
// scales, so each test also waits for its zoom; the band is measured in screen pixels against the window height.
const TALL_WINDOWS = SESSION_WINDOWS.filter(({ height }) => height >= 781);
const MAX_BAND = 0.15;

/** Screen rectangles of all elements matching the selector, in document order. */
async function boxes(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  }));
}

const nextFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

for (const { width, height, scale } of TALL_WINDOWS) {
  test(`text choice has no empty band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openSession(page, completedTextChoiceFixture());
    await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-feedback-layout", "flow");
    await expect(page.getByTestId("kid-option")).toHaveCount(4);
    await waitForKidScale(page, scale);
    await page.evaluate(async () => { await document.fonts.ready; });
    const before = await boxes(page, "[data-testid='kid-option']");

    await page.getByTestId("kid-option").first().click();
    await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
    await nextFrames(page);

    const after = await boxes(page, "[data-testid='kid-option']");
    const [dock] = await boxes(page, "[data-testid='kid-feedback-dock']");
    const details = JSON.stringify({ before, after, dock });
    expect(after).toHaveLength(4);
    for (const [index, option] of after.entries()) {
      for (const key of ["left", "top", "width", "height"] as const) {
        expect(Math.abs(option[key] - before[index]![key]), `option ${index} ${key} after the verdict: ${details}`).toBeLessThanOrEqual(1);
      }
    }
    const band = dock!.top - Math.max(...after.map((option) => option.bottom));
    expect(band, `panel below the options: ${details}`).toBeGreaterThanOrEqual(-1);
    expect(band, `no empty band between the options and the panel: ${details}`).toBeLessThanOrEqual(MAX_BAND * height);
    expect(dock!.bottom, `panel in the window: ${details}`).toBeLessThanOrEqual(height + 1);
  });

  test(`written answer has no empty band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openWrittenRecall(page);
    await waitForKidScale(page, scale);
    await page.getByTestId("kid-input").fill("cat");
    await page.evaluate(async () => { await document.fonts.ready; });
    const before = await measure(page, { input: "[data-testid='kid-input']", submit: "[data-testid='kid-submit']" });
    const band = before.submit.top - before.input.bottom;
    expect(band, `action below the field: ${JSON.stringify(before)}`).toBeGreaterThanOrEqual(0);
    expect(band, `no empty band between the field and the action: ${JSON.stringify(before)}`).toBeLessThanOrEqual(MAX_BAND * height);

    await page.getByTestId("kid-submit").click();
    await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();
    await settledDockReserve(page);
    const after = await measure(page, { input: "[data-testid='kid-input']", dock: "[data-testid='kid-feedback-dock']" });
    const details = JSON.stringify({ before: before.input, after });
    expect(after.input.bottom, `field not covered by the panel: ${details}`).toBeLessThanOrEqual(after.dock.top + 1);
    expect(Math.abs(after.input.top - before.input.top), `field stays in place: ${details}`).toBeLessThanOrEqual(1);
    expect(after.dock.top - after.input.bottom, `no empty band between the field and the panel: ${details}`)
      .toBeLessThanOrEqual(MAX_BAND * height);
    expect(after.dock.bottom, `panel in the window: ${details}`).toBeLessThanOrEqual(height + 1);
  });
}

// Picture choice keeps its frame (excluded from the compact rule): the tiles fill the material height (cqh) anyway.
for (const { width, height, scale } of TALL_WINDOWS.filter(({ width }) => width === ULTRAWIDE.width)) {
  test(`picture choice has no empty band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openPictureChoice(page, fourPictureTilesFixture());
    await expect(page.getByTestId("kid-option")).toHaveCount(4);
    await waitForKidScale(page, scale);
    await page.evaluate(async () => { await document.fonts.ready; });

    await page.getByTestId("kid-option").first().click();
    await expect(page.getByTestId("kid-outcome-correct")).toBeVisible();
    await expect(page.getByTestId("kid-next")).toBeVisible();
    await nextFrames(page);

    const tiles = await boxes(page, "[data-testid='kid-option']");
    const [dock] = await boxes(page, "[data-testid='kid-feedback-dock']");
    const details = JSON.stringify({ tiles, dock });
    for (const [index, tile] of [...tiles, dock!].entries()) {
      const name = index < tiles.length ? `tile ${index}` : "panel";
      expect(tile.left, `${name} in the window: ${details}`).toBeGreaterThanOrEqual(-1);
      expect(tile.top, `${name} in the window: ${details}`).toBeGreaterThanOrEqual(-1);
      expect(tile.right, `${name} in the window: ${details}`).toBeLessThanOrEqual(width + 1);
      expect(tile.bottom, `${name} in the window: ${details}`).toBeLessThanOrEqual(height + 1);
    }
    const band = dock!.top - Math.max(...tiles.map((tile) => tile.bottom));
    expect(band, `panel below the tiles: ${details}`).toBeGreaterThanOrEqual(-1);
    expect(band, `no empty band between the tiles and the panel: ${details}`).toBeLessThanOrEqual(MAX_BAND * height);
  });
}

test("long lesson card scrolls inside the material", async ({ page }) => {
  await page.setViewportSize(ULTRAWIDE);
  await openSession(page, longLessonCardFixture());
  await expect(page.getByTestId("kid-lesson-card")).toBeVisible();
  await waitForKidScale(page, 1.6);
  await page.evaluate(async () => { await document.fonts.ready; });

  // The material track keeps its minimum 0: content longer than the window scrolls inside the material.
  const material = await page.getByTestId("kid-material").evaluate((element) =>
    ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(material.scrollHeight, `material scrolls: ${JSON.stringify(material)}`).toBeGreaterThan(material.clientHeight);
  const [next] = await boxes(page, "[data-testid='kid-lesson-next']");
  expect(next!.top, `main action in the window: ${JSON.stringify(next)}`).toBeGreaterThanOrEqual(0);
  expect(next!.bottom, `main action in the window: ${JSON.stringify(next)}`).toBeLessThanOrEqual(ULTRAWIDE.height + 1);
  await expectSessionFitsWindow(page, ULTRAWIDE);
});

// JS measurements under zoom (spec §4.4): rectangles are screen pixels, offset/scroll lengths and position: fixed
// lengths are inner pixels. The checks below compare screen rectangles only, at scale 1.6.
const ULTRAWIDE_SCALE = 1.6;

// A long source prompt and a spelling hint whose dock (382 inner px over a 54 px footer) covers the answer form.
// 3440x1440 has the compact frame (spec §3.2): the reserve grows the material row instead, and only once the material
// reaches its limit does the reserve lengthen the scroll range and the correcting scroll run — the path under test.
// So the prompt fills enough of the material for that (about 2/3), yet still fits before the verdict: outside the
// compact frame .materialContent (flex: 1 with an explicit min-height) does not grow with overflowing children, so
// the reserve padding would not lengthen the scroll range there — a known limitation.
const LONG_RECALL_PROMPT = "Przeczytaj uważnie całą historyjkę, a potem przetłumacz zdanie na angielski, pilnując kolejności "
  + "słów i małych liter: dzieci szły starym drewnianym mostem nad rzeką i liczyły łódki, które powoli płynęły do portu, "
  + "zanim słońce schowało się za wzgórzami, a w miasteczku zapaliły się wszystkie światła.";
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
        scrollHeight: material.scrollHeight,
        clientHeight: material.clientHeight,
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
  const material = await page.getByTestId("kid-material").evaluate((element) =>
    ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(material.scrollHeight, `the long prompt still fits the material before the verdict: ${JSON.stringify(material)}`)
    .toBeLessThanOrEqual(material.clientHeight + 1);
  await page.getByTestId("kid-input").fill("the children walked");
  await page.getByTestId("kid-submit").click();
  await expect(page.getByTestId("kid-feedback-dock")).toBeVisible();

  const geometry = await settledDockReserve(page);
  const details = JSON.stringify(geometry);
  // The dock really covers the content: without overlap the reserve stays off and the bound below proves nothing.
  expect(geometry.inlineReserve, `dock reserve engaged: ${details}`).toBeGreaterThan(0);
  // The reserve lengthened the scroll range and the correcting scroll ran; without it the content would simply end
  // above the dock in the grown material row and the bound below would not test the scroll.
  expect(geometry.scrollTop, `correcting scroll ran: ${details}`).toBeGreaterThan(0);
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
