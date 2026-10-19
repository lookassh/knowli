import { expect, test } from "@playwright/test";
import { assertKidLayout, installKidUiFixture } from "./helpers/kid-ui-fixture";
import { pictureVocabularyFixture } from "./helpers/picture-fixtures";
import type { AttemptDto, TaskDto } from "@learning/contracts";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function pictureRecognitionFixture() {
  const fixture = pictureVocabularyFixture();
  const taskId = id(20);
  const optionRed = id(21);
  const optionBlue = id(22);
  const audioId = id(23);
  const task: TaskDto = {
    taskId, sessionId: fixture.session.sessionId, ordinal: 1, exerciseType: "picture_recognition",
    direction: "source_to_target", state: "issued",
    prompt: {
      kind: "picture_recognition",
      visual: { kind: "color", color: "#ff0000" },
      source: "czerwony",
      options: [
        { id: optionRed, text: "red" },
        { id: optionBlue, text: "blue" },
      ],
    },
    remainingAssessed: 2,
  };
  const attempt = (n: number, feedback: AttemptDto["feedback"], taskState: AttemptDto["taskState"]): AttemptDto => ({
    attemptId: id(n), taskId, state: "completed", modality: "choice", feedback,
    taskState, stepId: `step-${n}`, receivedAt: "2026-10-19T10:00:01.000Z", completedAt: "2026-10-19T10:00:02.000Z",
  });
  return { fixture, task, optionRed, optionBlue, audioId, attempt };
}

test("picture_recognition: poprawny wybór pokazuje odsłuch poprawnego słowa w feedbackzie", async ({ page }) => {
  const { fixture, task, optionRed, audioId, attempt } = pictureRecognitionFixture();
  fixture.tasks = [task, null];
  fixture.attempts = [attempt(24, { kind: "great", correctAudioAssetId: audioId }, "answered")];
  const requested: string[] = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/api\/v1\/media\/([^/?]+)/);
    if (match) requested.push(match[1]!);
  });
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();

  await expect(page.getByTestId("kid-exercise")).toHaveAttribute("data-prompt-kind", "picture_recognition");
  await expect(page.getByTestId("kid-instruction")).toContainText("Które słowo pasuje do obrazka?");
  await assertKidLayout(page);
  // pod obrazkiem mały polski podpis; opcje to angielskie słowa
  await expect(page.getByTestId("kid-picture-caption")).toHaveText("czerwony");
  const options = page.getByTestId("kid-option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("red");
  await expect(options.nth(1)).toContainText("blue");
  // przed odpowiedzią żadne audio zadania (A07) ani odsłuch poprawnego słowa
  await expect(page.getByTestId("kid-play")).toHaveCount(0);
  await expect(page.getByTestId("kid-option-audio")).toHaveCount(0);

  await options.nth(0).click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await expect(options.nth(0)).toHaveClass(/kid-option--correct/);
  // głośniczek pojawia się przy podświetlonej poprawnej opcji dopiero w feedbackzie
  const speaker = page.getByTestId("kid-option-audio");
  await expect(speaker).toHaveCount(1);
  await expect(speaker).toHaveAccessibleName("Posłuchaj poprawnego słowa");
  await speaker.click();
  await expect.poll(() => requested).toContain(audioId);

  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
});

test("picture_recognition: pomyłka podświetla wybór, odsłuch poprawnego słowa i pozwala drugą próbę z klawiatury", async ({ page }) => {
  const { fixture, task, optionRed, optionBlue, audioId, attempt } = pictureRecognitionFixture();
  fixture.tasks = [task, null];
  fixture.attempts = [
    attempt(25, { kind: "incorrect", correctText: "red", correctAudioAssetId: audioId }, "issued"),
    attempt(26, { kind: "great" }, "answered"),
  ];
  const attemptPosts: { optionId?: string }[] = [];
  page.on("request", (request) => {
    if (/\/attempts$/.test(request.url()) && request.method() === "POST") {
      attemptPosts.push(request.postDataJSON());
    }
  });
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();

  const options = page.getByTestId("kid-option");
  await expect(page.getByTestId("kid-option-audio")).toHaveCount(0);
  // pomyłka: wybrana opcja czerwona podświetlenia, poprawna zielona + głośniczek
  await options.nth(1).click();
  await expect(page.getByTestId("kid-feedback")).toContainText("Posłuchaj: red. Poćwiczymy razem");
  await expect(options.nth(1)).toHaveClass(/kid-option--wrong/);
  await expect(options.nth(0)).toHaveClass(/kid-option--correct/);
  await expect(page.getByTestId("kid-option-audio")).toHaveCount(1);
  // druga próba bez zaliczenia sukcesu po pierwszej pomyłce
  await expect(page.getByTestId("kid-next")).toContainText("Spróbuj jeszcze raz");
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-feedback")).toHaveCount(0);
  await expect(page.getByTestId("kid-option-audio")).toHaveCount(0);
  // klawiatura 1–4 wybiera opcję bez myszy (1 = poprawne "red")
  await page.keyboard.press("1");
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
  await expect(options.nth(0)).toHaveClass(/kid-option--correct/);
  expect(attemptPosts.map((post) => post.optionId)).toEqual([optionBlue, optionRed]);
  await page.getByTestId("kid-next").click();
  await expect(page.getByTestId("kid-summary")).toBeVisible();
});

test("picture_recognition: strzałki przenoszą fokus między opcjami", async ({ page }) => {
  const { fixture, task, attempt } = pictureRecognitionFixture();
  fixture.tasks = [task, null];
  fixture.attempts = [attempt(27, { kind: "great" }, "answered")];
  await installKidUiFixture(page, fixture);
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
  await page.getByTestId("kid-deck").first().click();

  const options = page.getByTestId("kid-option");
  await options.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");
});
