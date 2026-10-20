import { expect as baseExpect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { KidDeckDto, KidProfileDto, MockTestSummaryDto, SessionDto, SessionSummaryDto, TaskDto } from "@learning/contracts";
import { installKidUiFixture } from "./helpers/kid-ui-fixture";

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
  await expect(page.getByTestId("kid-mock-budget")).toContainText("1 zadań");
  const start = page.getByTestId("kid-mock-confirm");
  await expect(start).toBeVisible();
  await expectThemeToken(page, start, "accent");
  const info = page.getByTestId("kid-mock-info");
  await expect(info).toContainText("Odpowiedzi omówimy na końcu.");
  await expectThemeToken(page, info);
  await page.getByRole("button", { name: "Koniec" }).click();
  await expect(page.getByTestId("kid-deck-card")).toBeVisible();
});

test("session conflict resumes the already active task", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
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
  const conflictInfo = page.getByTestId("kid-conflict-info");
  await expect(conflictInfo).toContainText("Masz rozpoczętą sesję. Wróć do niej lub zakończ ją przed nową.");
  await expectThemeToken(page, conflictInfo);
  const resume = page.getByRole("button", { name: "Wróć do sesji" });
  await expectThemeToken(page, resume, "accent");
  await resume.click();
  await expect(page.getByTestId("kid-input")).toBeVisible();
  await expect(page.getByTestId("kid-source")).toHaveText("kot");
});

test("long session summary remains readable and its actions stay reachable at 200 percent", async ({ page }) => {
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")], tasks: [null], summary: summary(20) });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
  await expect(page.getByTestId("kid-summary-practice").getByRole("listitem")).toHaveCount(20);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByTestId("kid-summary-practice").getByText("word-20")).toBeVisible();
  await page.getByTestId("kid-switch-profile").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("kid-again")).toBeVisible();
  await expect(page.getByTestId("kid-switch-profile")).toBeVisible();
  await expectThemeToken(page, page.getByTestId("kid-summary-practice"));
});

test("dark session summary keeps switch-profile text readable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await setup(page, { profiles: [profile(), profile(otherChildId, "Maja")], tasks: [null], summary: summary() });
  await page.getByTestId("kid-profile").first().click();
  await page.getByTestId("kid-deck").click();
  const button = page.getByTestId("kid-switch-profile");
  await expect(button).toBeVisible();
  const ratio = await button.evaluate((element) => {
    const luminance = (value: string) => {
      const [red, green, blue] = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const style = getComputedStyle(element);
    const [foreground, background] = [luminance(style.color), luminance(style.backgroundColor)];
    return (Math.max(foreground!, background!) + 0.05) / (Math.min(foreground!, background!) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
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
  await expect(page.getByTestId("kid-mock-score")).toContainText("1/1");
  await expect(page.getByTestId("kid-mock-solution")).toHaveAttribute("data-status", "correct");
  await expect(page.getByTestId("kid-mock-practice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Kto się dziś uczy?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Posłuchaj" }).locator("svg")).toBeVisible();
  await expectThemeToken(page, page.getByTestId("kid-mock-score"), "good-bg");
  await expectThemeToken(page, page.getByTestId("kid-mock-solution"), "good-bg");
});
