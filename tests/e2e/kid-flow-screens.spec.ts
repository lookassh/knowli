import { expect as baseExpect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { KidDeckDto, KidProfileDto, MockTestSummaryDto, SessionDto, SessionSummaryDto, TaskDto } from "@learning/contracts";
import { ownColorContrast } from "./helpers/contrast";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";
import { expectBandSpansRoot, expectInsideRoot, measure, resizeAndSettle, type Viewport } from "./helpers/kid-layout";

const expect = baseExpect.configure({ timeout: 1_500 });
test.setTimeout(15_000);

const childId = "10000000-0000-4000-8000-000000000001";
const otherChildId = "10000000-0000-4000-8000-000000000011";
const deckId = "10000000-0000-4000-8000-000000000002";
const sessionId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const assetId = "10000000-0000-4000-8000-000000000006";

function profile(id = childId, displayName = "Szymon"): KidProfileDto {
  return { childId: id, displayName, avatarKey: "cat", recordingMode: "hold" };
}

function deck(overrides: Partial<KidDeckDto> = {}): KidDeckDto {
  return { deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 2,
    testDate: null, recommended: true, mockTestAvailable: false, activeSession: null, ...overrides };
}

function session(mode: SessionDto["mode"] = "training", overrides: Partial<SessionDto> = {}): SessionDto {
  return { mode, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
    policyId: "default", microphoneEnabled: false, state: "active", taskBudget: 1, tasksIssued: 0,
    assessedTasksIssued: 0, startedAt: "2026-10-11T10:00:00.000Z", resumed: false, ...overrides };
}

function recallTask(): TaskDto {
  return { taskId, sessionId, ordinal: 0, exerciseType: "recall", direction: "source_to_target",
    state: "issued", prompt: { kind: "recall", prompt: "kot" }, remainingAssessed: 1 };
}

function summary(practiceCount = 0): SessionSummaryDto {
  return { sessionId, state: "ended", tasksIssued: 1, assessedTasksIssued: 1,
    independentSuccesses: { recall: 0, spelling: 0 },
    practiceItems: Array.from({ length: practiceCount }, (_, index) => ({
      itemId: `10000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      target: `word-${index + 1}`, skills: ["recall" as const, "spelling" as const],
    })),
    endedAt: "2026-10-11T10:01:00.000Z" };
}

async function setup(page: Parameters<typeof installKidUiFixture>[0], options: {
  profiles?: KidProfileDto[];
  decks?: KidDeckDto[];
  session?: SessionDto;
  tasks?: (TaskDto | null)[];
  summary?: SessionSummaryDto;
  mockSummary?: MockTestSummaryDto;
}) {
  await installKidUiFixture(page, {
    profiles: options.profiles ?? [profile()],
    decks: options.decks ?? [deck()],
    session: options.session ?? session(),
    tasks: options.tasks ?? [],
    summary: options.summary ?? summary(),
    mockSummary: options.mockSummary,
  });
  await page.goto("/");
}

const SCREEN_VIEWPORTS: Viewport[] = [
  { width: 360, height: 800 },
  { width: 320, height: 640 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];
const NARROW_VIEWPORTS = SCREEN_VIEWPORTS.slice(0, 3);

async function screenshotAt360(page: Page, path: string) {
  await resizeAndSettle(page, { width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => {
    const { right, width } = document.querySelector("[data-kid-screen]")!.getBoundingClientRect();
    return window.innerWidth === 360 && width > 300 && Math.round(right) <= 360;
  })).toBe(true);
  await page.screenshot({ path });
}

/** Deck with an active session; the first POST /sessions answers 409, so "Ucz się" lands on the conflict screen. */
async function openSessionConflict(page: Page) {
  await setup(page, {
    decks: [deck({ activeSession: { sessionId, mode: "training" } })],
    session: session("training", { tasksIssued: 1, assessedTasksIssued: 1, resumed: true }),
    tasks: [recallTask()],
  });
  let conflictSent = false;
  await page.route("**/api/v1/kid/sessions", async (route) => {
    if (route.request().method() === "POST" && !conflictSent) {
      conflictSent = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "conflict", retryable: false }) });
      return;
    }
    await route.fallback();
  });
  await page.getByTestId("kid-profile").click();
  await page.getByRole("button", { name: "Ucz się" }).click();
}

async function expectThemeToken(page: Page, locator: Locator, token: "surface" | "accent" | "good-bg" = "surface") {
  const colors = await locator.evaluate((element, tokenName) => ({
    background: getComputedStyle(element).backgroundColor,
    token: getComputedStyle(document.querySelector(".kid-ui")!).getPropertyValue(`--kid-${tokenName}`).trim(),
  }), token);
  const normalizedToken = await page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const result = getComputedStyle(probe).color;
    probe.remove();
    return result;
  }, colors.token);
  expect(colors.background).toBe(normalizedToken);
}

test("profile keeps child and parent navigation within the blue theme", async ({ page }) => {
  // Dwie asercje po 10 s (kompilacja /parent on-demand) nie mieszczą się w
  // file-wide 15 s — budżet testu podnosimy, żeby porażkę zgłaszała asercja
  // z czytelnym komunikatem, nie test-timeout.
  test.setTimeout(20_000);
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")] });
  const firstProfile = page.getByTestId("kid-profile").first();
  await expect(firstProfile).toContainText("Szymon");
  await expect(page.getByTestId("kid-profile")).toHaveCount(2);
  await expectThemeToken(page, firstProfile);
  await firstProfile.click();
  await expect(page.getByTestId("kid-deck-card")).toBeVisible();
  await page.getByTestId("kid-parent-link").click();
  // Prawdziwa nawigacja do /parent: next dev kompiluje tę trasę on-demand przy
  // pierwszym wejściu w shardzie — na CI pod obciążeniem to sekundy, nie 1,5 s
  // (file-wide timeout); te dwie asercje dostają realistyczny limit.
  await expect(page.getByTestId("auth-secret")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".kid-ui")).toHaveCount(0, { timeout: 10_000 });
});

test("mock-test ready screen styles start and cancel as clear actions", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page, { decks: [deck({ mockTestAvailable: true })], session: session("mock_test") });
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await expect(page.getByTestId("kid-mock-budget")).toContainText("1 zadanie");
  const start = page.getByTestId("kid-mock-confirm");
  await expect(start).toBeVisible();
  await expect(start).toHaveClass(/kid-action/);
  await expectThemeToken(page, start, "accent");
  const info = page.getByTestId("kid-mock-info");
  await expect(info).toContainText("Odpowiedzi omówimy na końcu.");
  await expectThemeToken(page, info);
  const cancel = page.getByRole("button", { name: "Koniec" });
  // Regresja kaskady: reset przycisku nie może kasować lokalnych
  // stylów przycisku drugorzędnego (ramka, wypełnienie, tło).
  const cancelStyle = await cancel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderTopWidth: style.borderTopWidth, paddingLeft: style.paddingLeft, backgroundColor: style.backgroundColor };
  });
  expect(cancelStyle.borderTopWidth).not.toBe("0px");
  expect(cancelStyle.paddingLeft).not.toBe("0px");
  expect(cancelStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  await cancel.click();
  await expect(page.getByTestId("kid-deck-card")).toBeVisible();
});

test("session conflict resumes the already active task", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSessionConflict(page);
  const conflictInfo = page.getByTestId("kid-conflict-info");
  await expect(conflictInfo).toContainText("Masz rozpoczętą sesję. Wróć do niej lub zakończ ją przed nową.");
  await expectThemeToken(page, conflictInfo);
  const resume = page.getByRole("button", { name: "Wróć do sesji" });
  await expectThemeToken(page, resume, "accent");
  await resume.click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await expect(page.getByTestId("kid-source")).toHaveText("kot");
});

test("mock-test ready screen screenshot at 360x800", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page, { decks: [deck({ mockTestAvailable: true })], session: session("mock_test") });
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await expect(page.getByTestId("kid-mock-confirm")).toBeVisible();
  await screenshotAt360(page, testInfo.outputPath("mock-ready-360x800.png"));
});

test("session conflict screenshot at 360x800", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSessionConflict(page);
  await expect(page.getByTestId("kid-conflict-info")).toBeVisible();
  await screenshotAt360(page, testInfo.outputPath("conflict-360x800.png"));
});

test("long session summary remains readable and its actions stay reachable", async ({ page }) => {
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")], tasks: [null], summary: summary(20) });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-summary-practice").getByRole("listitem")).toHaveCount(20);
  await expect(page.getByTestId("kid-summary-practice").getByText("word-20")).toBeVisible();
  await page.getByTestId("kid-switch-profile").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-again")).toBeVisible();
  await expect(page.getByTestId("kid-switch-profile")).toBeVisible();
  await expectThemeToken(page, page.getByTestId("kid-summary-practice"));
  await expect(page.locator("[data-kid-header='band']")).toHaveCount(1);
  const again = await page.getByTestId("kid-again").boundingBox();
  expect(again?.height ?? 0).toBeGreaterThanOrEqual(54);
});

test("session summary tiles, band and actions fit portrait, landscape, tablet and desktop", async ({ page }, testInfo) => {
  const richSummary: SessionSummaryDto = {
    ...summary(3),
    independentSuccesses: { recall: 3, spelling: 2 },
    activity: { status: "evaluated", pointsAwarded: 4, approvedSeconds: 245, errorCode: null },
  };
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")], tasks: [null], summary: richSummary });
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-summary-recall").locator(".kid-stat__value")).toHaveText("3");
  await expect(page.getByTestId("kid-summary-spelling").locator(".kid-stat__value")).toHaveText("2");
  await expect(page.getByRole("list", { name: "Jeszcze poćwiczymy" }).getByRole("listitem")).toHaveCount(3);
  for (const viewport of SCREEN_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      root: "[data-kid-screen]",
      band: "[data-kid-header='band']",
      reward: "[data-testid='kid-summary-reward']",
      again: "[data-testid='kid-again']",
      switchProfile: "[data-testid='kid-switch-profile']",
    });
    const tiles = await page.locator(".kid-stat").evaluateAll((elements) => elements.map((tile) => {
      const { left, top, right, bottom, width, height } = tile.getBoundingClientRect();
      const label = tile.querySelector(".kid-stat__label")!;
      return { left, top, right, bottom, width, height, overflowX: tile.scrollWidth > tile.clientWidth + 1, labelClipped: label.scrollWidth > label.clientWidth + 1 };
    }));
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectBandSpansRoot(layout, name);
    expect(tiles, `tiles: ${name}`).toHaveLength(2);
    for (const [index, tile] of tiles.entries()) {
      expectInsideRoot(tile, layout.root, `tile ${index}: ${name}`);
      expect(tile.overflowX, `tile ${index} content overflow: ${name}`).toBe(false);
      expect(tile.labelClipped, `tile ${index} label clipped: ${name}`).toBe(false);
    }
    expect(layout.reward.right, `reward in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.again.height, `again height: ${name}`).toBeGreaterThanOrEqual(54);
    expect(layout.switchProfile.height, `switch height: ${name}`).toBeGreaterThanOrEqual(48);
    expect(layout.again.right, `again in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    await page.getByTestId("kid-again").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("kid-again"), `again reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.getByTestId("kid-switch-profile").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("kid-switch-profile"), `switch reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    if (viewport.width === 360) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(".kid-stat")].every((tile) => getComputedStyle(tile).opacity === "1"))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`summary-${name}.png`) });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});

test("dark session summary keeps switch-profile text readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")], tasks: [null], summary: summary() });
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").click();
  const button = page.getByTestId("kid-switch-profile");
  await expect(button).toBeVisible();
  const contrast = await ownColorContrast(button);
  expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
});

test("mock-test summary retains word outcomes and reachable follow-up actions", async ({ page }) => {
  const mockSummary: MockTestSummaryDto = {
    sessionId, deckId, state: "completed", complete: true, taskBudget: 1, answeredCount: 1,
    solutions: [{ taskId, source: "kot", target: "cat", audioAssetId: assetId, results: [{ skill: "recall", outcome: "correct" }] }],
  };
  await setup(page, { decks: [deck({ mockTestAvailable: true })], session: session("mock_test"),
    tasks: [null], mockSummary });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await page.getByTestId("kid-mock-confirm").click();
  await expect(page.getByTestId("kid-mock-summary")).toBeVisible();
  await expect(page.getByTestId("kid-mock-practice")).toHaveClass(/kid-action/);
  await expect(page.getByTestId("kid-mock-solution")).toHaveClass(/kid-mock-row/);
  await expect(page.getByTestId("kid-mock-score")).toContainText("1/1");
  await expect(page.getByTestId("kid-mock-solution")).toHaveAttribute("data-status", "correct");
  await expect(page.getByTestId("kid-mock-practice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kto się dziś uczy?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Posłuchaj" }).locator("svg")).toBeVisible();
  await expectThemeToken(page, page.getByTestId("kid-mock-score"), "good-bg");
  await expectThemeToken(page, page.getByTestId("kid-mock-solution"), "good-bg");
});

function mockTaskId(index: number): string {
  return `10000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`;
}

test("mock-test summary rows, band and actions fit portrait, landscape, tablet and desktop", async ({ page }, testInfo) => {
  const mockSummary: MockTestSummaryDto = {
    sessionId, deckId, state: "ended", complete: false, taskBudget: 5, answeredCount: 4,
    solutions: [
      { taskId: mockTaskId(1), source: "kot", target: "cat", audioAssetId: assetId, results: [{ skill: "recall", outcome: "correct" }] },
      { taskId: mockTaskId(2), source: "pies", target: "dog", audioAssetId: assetId, results: [{ skill: "recall", outcome: "correct" }, { skill: "spelling", outcome: "incorrect" }] },
      { taskId: mockTaskId(3), source: "ptak", target: "bird", audioAssetId: null, results: [{ skill: "spelling", outcome: "incorrect" }] },
      { taskId: mockTaskId(4), source: "ryba", target: "fish", audioAssetId: assetId, results: [{ skill: "recall", outcome: "skipped" }] },
      { taskId: mockTaskId(5), source: "koń", target: "horse", audioAssetId: null, results: [{ skill: "recall", outcome: "not_tested" }] },
    ],
  };
  await setup(page, { decks: [deck({ mockTestAvailable: true })], session: session("mock_test", { taskBudget: 5 }), tasks: [null], mockSummary });
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await page.getByTestId("kid-mock-confirm").click();
  await expect(page.getByTestId("kid-mock-summary")).toBeVisible();
  await expect(page.getByTestId("kid-mock-solution")).toHaveCount(5);
  // Status rozpoznawalny bez koloru: ikona w kafelku i odznaka z tekstem w każdym wierszu.
  await expect(page.locator("[data-testid='kid-mock-status']")).toHaveText(["Poprawnie", "Do poprawy", "Do poprawy", "Pominięte", "Nie sprawdzono"]);
  await expect(page.locator("[data-testid='kid-mock-solution'] .kid-mock-row__icon svg")).toHaveCount(5);
  for (const viewport of SCREEN_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      root: "[data-kid-screen]",
      band: "[data-kid-header='band']",
      score: "[data-testid='kid-mock-score']",
      practice: "[data-testid='kid-mock-practice']",
    });
    const rows = await page.getByTestId("kid-mock-solution").evaluateAll((elements) => elements.map((row) => {
      const box = (element: Element) => {
        const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      const audio = row.querySelector(".kid-mock-row__audio");
      return {
        ...box(row),
        overflowX: row.scrollWidth > row.clientWidth + 1,
        badges: [...row.querySelectorAll("[data-testid='kid-mock-status'], .kid-mock-badge")].map(box),
        audio: audio ? box(audio) : null,
      };
    }));
    expect(layout.scrollWidth, `horizontal overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectBandSpansRoot(layout, name);
    expectInsideRoot(layout.score, layout.root, `score: ${name}`);
    expect(rows, `rows: ${name}`).toHaveLength(5);
    for (const [index, row] of rows.entries()) {
      expectInsideRoot(row, layout.root, `row ${index}: ${name}`);
      expect(row.height, `row ${index} height: ${name}`).toBeGreaterThanOrEqual(48);
      expect(row.overflowX, `row ${index} content overflow: ${name}`).toBe(false);
      for (const badge of row.badges) {
        expect(badge.left, `row ${index} badge left: ${name}`).toBeGreaterThanOrEqual(row.left - 1);
        expect(badge.right, `row ${index} badge right: ${name}`).toBeLessThanOrEqual(row.right + 1);
      }
      if (row.audio) {
        expect(row.audio.width, `row ${index} audio width: ${name}`).toBeGreaterThanOrEqual(48);
        expect(row.audio.height, `row ${index} audio height: ${name}`).toBeGreaterThanOrEqual(48);
        expect(row.audio.right, `row ${index} audio inside row: ${name}`).toBeLessThanOrEqual(row.right + 1);
      }
    }
    expect(layout.practice.height, `practice height: ${name}`).toBeGreaterThanOrEqual(54);
    expect(layout.practice.right, `practice in viewport: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    await page.getByTestId("kid-mock-practice").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("kid-mock-practice"), `practice reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.getByRole("button", { name: "Kto się dziś uczy?" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Kto się dziś uczy?" }), `switch reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    if (viewport.width === 360) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(".kid-mock-score__stars span")].every((star) => getComputedStyle(star).opacity === "1"))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`mock-summary-${name}.png`) });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});

test("mock-test ready and session conflict screens fit narrow and landscape viewports", async ({ page }) => {
  await setup(page, {
    decks: [deck({ mockTestAvailable: true })],
    session: session("mock_test"),
    tasks: [recallTask()],
  });
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-mock-start").click();
  await expect(page.getByTestId("kid-mock-budget").locator(".kid-stat__value")).toHaveText("1");
  for (const viewport of NARROW_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      root: "[data-kid-screen]",
      band: "[data-kid-header='band']",
      budget: "[data-testid='kid-mock-budget']",
      info: "[data-testid='kid-mock-info']",
      confirm: "[data-testid='kid-mock-confirm']",
    });
    expect(layout.scrollWidth, `ready overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectBandSpansRoot(layout, `ready ${name}`);
    expectInsideRoot(layout.budget, layout.root, `ready budget: ${name}`);
    expectInsideRoot(layout.info, layout.root, `ready info: ${name}`);
    expect(layout.confirm.height, `ready confirm height: ${name}`).toBeGreaterThanOrEqual(54);
    await page.getByTestId("kid-mock-confirm").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("kid-mock-confirm"), `ready confirm reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});

test("session conflict keeps scene, message and both actions inside narrow and landscape viewports", async ({ page }) => {
  await openSessionConflict(page);
  await expect(page.getByTestId("kid-conflict-info")).toBeVisible();
  await expect(page.locator("svg.kid-conflict-scene")).toBeVisible();
  const resume = page.getByRole("button", { name: "Wróć do sesji" });
  for (const viewport of NARROW_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`;
    await resizeAndSettle(page, viewport);
    const layout = await measure(page, {
      root: "[data-kid-screen]",
      scene: ".kid-conflict-scene",
      info: "[data-testid='kid-conflict-info']",
    });
    expect(layout.scrollWidth, `conflict overflow: ${name}`).toBeLessThanOrEqual(layout.innerWidth);
    expectInsideRoot(layout.scene, layout.root, `conflict scene: ${name}`);
    expectInsideRoot(layout.info, layout.root, `conflict info: ${name}`);
    expect((await resume.boundingBox())?.height ?? 0, `conflict resume height: ${name}`).toBeGreaterThanOrEqual(54);
    await resume.scrollIntoViewIfNeeded();
    await expect(resume, `conflict resume reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.getByRole("button", { name: "Zakończ rozpoczętą sesję" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Zakończ rozpoczętą sesję" }), `conflict close reachable: ${name}`).toBeInViewport({ ratio: 0.98 });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
});
