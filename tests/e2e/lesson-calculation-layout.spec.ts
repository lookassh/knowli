import { expect, test, type Page } from "@playwright/test";
import type { TaskDto } from "@learning/contracts";
import { installKidUiFixture, type KidUiFixture } from "./helpers/kid-ui-fixture";

/**
 * Geometria zadania rachunkowego (`lesson_calculation`) na wspólnym widoku
 * odpowiedzi pisemnej: długie polskie polecenie, pole wyniku i „Sprawdź”
 * mieszczą się w ramce lub są osiągalne przez scroll, bez poziomego
 * przepełnienia, z celami dotykowymi ≥48 px i główną akcją ≥54 px.
 */

const childId = "10000000-0000-4000-8000-000000000501";
const deckId = "10000000-0000-4000-8000-000000000502";
const sessionId = "10000000-0000-4000-8000-000000000503";
const taskId = "10000000-0000-4000-8000-000000000505";
const LONG_PROMPT = "Na mapie w skali 1:25 000 odcinek między szkołą a rzeką ma 12,5 cm. Oblicz odległość w terenie w m.";

function calculationFixture(): KidUiFixture {
  const task: TaskDto = {
    taskId, sessionId, ordinal: 0, exerciseType: "lesson_calculation", direction: null, state: "issued", remainingAssessed: 1,
    prompt: { kind: "lesson_calculation", instructionPl: "Oblicz i wpisz wynik z jednostką.", prompt: LONG_PROMPT },
  };
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "owl", recordingMode: "hold" }],
    decks: [{ deckId, title: "Posługuję się mapą", itemCount: 8, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null, kind: "lesson", subjectTitle: "Geografia" }],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000504",
      policyId: "lesson-default", microphoneEnabled: false, state: "active", taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-28T10:00:00.000Z", resumed: false },
    tasks: [task],
  };
}

async function openCalculation(page: Page): Promise<void> {
  await installKidUiFixture(page, calculationFixture());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").click();
  await expect(page.getByTestId("kid-lesson-source")).toHaveText(LONG_PROMPT);
}

test("calculation keeps the Polish prompt, result field and actions inside the frame across form factors", async ({ page }, testInfo) => {
  await openCalculation(page);
  await expect(page.getByTestId("kid-instruction")).toContainText("Oblicz i wpisz wynik");
  await expect(page.getByTestId("kid-lesson-source")).toHaveAttribute("lang", "pl-PL");
  await expect(page.getByTestId("kid-lesson-input")).toHaveAttribute("type", "text");
  await expect(page.getByTestId("kid-lesson-listen")).toHaveCount(0);

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("kid-session-frame")).toHaveCSS("height", `${viewport.height}px`);
    const frame = (await page.getByTestId("kid-session-frame").boundingBox())!;
    const material = (await page.getByTestId("kid-material").boundingBox())!;
    expect(material.x, `material left at ${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(frame.x - 1);
    expect(material.x + material.width).toBeLessThanOrEqual(frame.x + frame.width + 1);

    for (const testId of ["kid-lesson-source", "kid-lesson-input", "kid-lesson-check", "kid-skip", "kid-not-remember"]) {
      const element = page.getByTestId(testId);
      await element.scrollIntoViewIfNeeded();
      const bounds = (await element.boundingBox())!;
      const label = `${testId} at ${viewport.width}x${viewport.height}`;
      expect(bounds.x, label).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, label).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds.y, label).toBeGreaterThanOrEqual(-1);
      expect(bounds.y + bounds.height, label).toBeLessThanOrEqual(viewport.height + 1);
      if (testId !== "kid-lesson-source") expect(bounds.height, label).toBeGreaterThanOrEqual(48);
      if (testId === "kid-lesson-check") expect(bounds.height, label).toBeGreaterThanOrEqual(54);
    }

    // Polecenie nie jest przycięte: cały tekst mieści się w swoim elemencie.
    expect(await page.getByTestId("kid-lesson-source").evaluate((element) =>
      element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`calculation-${viewport.width}x${viewport.height}.png`) });
  }
});

test("calculation input accepts Polish decimals and units verbatim and enables the check action", async ({ page }) => {
  await openCalculation(page);
  const input = page.getByTestId("kid-lesson-input");
  await expect(page.getByTestId("kid-lesson-check")).toBeDisabled();
  await input.fill("3 125 m");
  await expect(input).toHaveValue("3 125 m");
  await input.fill("3,125 km");
  await expect(input).toHaveValue("3,125 km");
  await expect(page.getByTestId("kid-lesson-check")).toBeEnabled();
});
