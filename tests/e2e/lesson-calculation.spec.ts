import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { AttemptDtoSchema, LessonDraftDtoSchema, SessionDtoSchema, TaskDtoSchema, type TaskDto } from "@learning/contracts";
import { closeWorldDatabase, worldPool } from "./helpers/world-database";
import { loginParent } from "./helpers/parent-session";

const material = "Odległość w terenie obliczamy, mnożąc odległość na mapie przez mianownik skali.";
test.afterAll(closeWorldDatabase);

async function openCalculationDraft(page: Page) {
  await loginParent(page);
  const deckId = randomUUID();
  const versionId = randomUUID();
  const objectiveId = "school.d" + deckId.replaceAll("-", "") + ".scale";
  const pool = await worldPool();
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: [objectiveId], poolSize: 20,
    examples: {}, material, subjectTitlePl: "Geografia",
    dynamicTopic: { titlePl: "Skala", objectives: [{ id: objectiveId, titlePl: "Skala mapy", descriptionEn: "Map scale.", cards: [{ title: "Skala", body: material }, { title: "Metoda", body: material }] }] },
  };
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,$2,'lesson')", [deckId, "Rachunki " + deckId.slice(0, 8)]);
  await pool.query("insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context) values ($1,$2,1,1,'draft','Skala',$3::jsonb)", [versionId, deckId, JSON.stringify(context)]);
  const exercises = [3, 5].map((distance) => ({
    exerciseType: "lesson_calculation", objectiveId, instructionPl: "Oblicz.",
    prompt: "Na mapie w skali 1:25 000 odcinek ma " + distance + " cm. Oblicz odległość w terenie w m.",
    answer: distance === 3 ? "750 m" : "1250 m", acceptedAnswers: [], focus: [],
    calculation: { kind: "scale_distance", params: { mapDistanceCm: distance, scaleDenominator: 25000 }, unit: "m", templateFamilyId: "scale" }, sourceRefs: [{ quote: material }],
  }));
  const seeded = await page.request.patch("/api/v1/parent/lesson-drafts/" + versionId, { data: { expectedEditNumber: 1, exercises } });
  expect(seeded.status()).toBe(200);
  await page.goto("/parent");
  await page.getByTestId("tab-decks").click();
  await page.locator('[data-deck-id="' + deckId + '"]').click();
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  // karty ćwiczeń domyślnie w podglądzie (szkic 6b) — oba warianty do edycji
  for (const index of [0, 1]) await page.getByTestId(`exercise-edit-${index}`).click();
  return { versionId, deckId };
}

test("edits decimal parameters, computes and persists preview, rejects invalid scale and removes one variant", async ({ page }) => {
  const { versionId, deckId } = await openCalculationDraft(page);
  await expect(page.getByTestId("calculation-family-scale")).toHaveCount(1);
  await expect(page.getByTestId("exercise-answer-0")).toBeDisabled();
  await expect(page.getByTestId("exercise-focus-0")).toBeDisabled();
  await expect(page.getByTestId("exercise-accepted-0")).toBeDisabled();
  const distance = page.getByTestId("calculation-mapDistanceCm-0");
  await distance.fill("3,5");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("875 m");
  await distance.fill("4");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("1000 m");
  await expect(page.getByTestId("calculation-prompt-0")).toContainText("4 cm");
  await page.getByTestId("calculation-scaleDenominator-0").fill("0");
  await expect(page.getByTestId("save-lesson")).toBeDisabled();
  await expect(page.getByTestId("calculation-status-0")).toContainText("Sprawdź parametry");
  await page.getByTestId("calculation-scaleDenominator-0").fill("25000");
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith("/lesson-drafts/" + versionId));
  await page.getByTestId("save-lesson").click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  const response = await page.request.get("/api/v1/parent/lessons/" + deckId);
  const draft = LessonDraftDtoSchema.parse((await response.json()).draft);
  expect(draft.exercises[0]).toMatchObject({ answer: "1000 m", calculation: { params: { mapDistanceCm: 4, scaleDenominator: 25000 } } });
  expect(draft.exercises[0]!.prompt).toContain("4 cm");
  await page.getByTestId("exercise-menu-0").click();
  await page.getByTestId("exercise-remove-0").click();
  await expect(page.getByTestId("calculation-family-scale")).toHaveCount(1);
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("1250 m");
  const removed = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith("/lesson-drafts/" + versionId));
  await page.getByTestId("save-lesson").click();
  expect(LessonDraftDtoSchema.parse(await (await removed).json()).exercises).toHaveLength(1);
});

test("ignores a delayed old preview and revalidates through the server before saving", async ({ page }) => {
  const { versionId } = await openCalculationDraft(page);
  let releaseOld!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { releaseOld = resolve; });
  const oldStarted = new Promise<void>(resolve => { started = resolve; });
  let oldFinished!: () => void;
  const oldDone = new Promise<void>(resolve => { oldFinished = resolve; });
  await page.route("**/lessons/preview-calculation", async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON().params.mapDistanceCm === 6) {
      started();
      await gate;
      await route.fulfill({ response });
      oldFinished();
    } else await route.fulfill({ response });
  });
  await page.getByTestId("calculation-mapDistanceCm-0").fill("6");
  await oldStarted;
  await expect(page.getByTestId("save-lesson")).toBeDisabled();
  await page.getByTestId("calculation-mapDistanceCm-0").fill("4");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("1000 m");
  const oldResponse = page.waitForResponse(response => response.url().endsWith("/lessons/preview-calculation") && response.request().postDataJSON().params.mapDistanceCm === 6);
  releaseOld();
  await oldDone;
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("1000 m");
  await expect(page.getByTestId("calculation-prompt-0")).toContainText("4 cm");
  // A valid cached display cannot bypass a failed fresh preview at save time.
  await page.unroute("**/lessons/preview-calculation");
  await page.route("**/lessons/preview-calculation", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "internal", message: "Podgląd niedostępny" }) }));
  let patches = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().endsWith("/lesson-drafts/" + versionId)) patches++; });
  await page.getByTestId("save-lesson").click();
  await expect(page.getByTestId("api-error")).toBeVisible();
  expect(patches).toBe(0);
});


test("previews height and conversion kinds, units and decimal tolerance through the server", async ({ page }) => {
  const { versionId } = await openCalculationDraft(page);
  await page.getByTestId("calculation-kind-0").selectOption("height_difference");
  await page.getByTestId("calculation-upperHeightM-0").fill("-100");
  await page.getByTestId("calculation-lowerHeightM-0").fill("-350");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("250 m");
  await page.getByTestId("calculation-unit-0").selectOption("km");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("0,25 km");
  await page.getByTestId("calculation-tolerance-0").fill("0,003");
  await expect(page.getByTestId("save-lesson")).toBeDisabled();
  await expect(page.getByTestId("calculation-status-0")).toContainText("Sprawdź parametry");
  await page.getByTestId("calculation-tolerance-0").fill("0,002");
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  await page.getByTestId("calculation-kind-0").selectOption("unit_conversion");
  await page.getByTestId("calculation-value-0").fill("2,5");
  await page.getByTestId("calculation-fromUnit-0").selectOption("km");
  await page.getByTestId("calculation-unit-0").selectOption("m");
  await page.getByTestId("calculation-tolerance-0").fill("");
  await expect(page.getByTestId("exercise-answer-0")).toHaveValue("2500 m");
  await expect(page.getByTestId("calculation-prompt-0")).toHaveText("Przelicz 2,5 km na m.");
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  // A different kind cannot stay in the family of the remaining scale variant.
  const rejected = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith("/lesson-drafts/" + versionId));
  await page.getByTestId("save-lesson").click();
  expect((await rejected).status()).toBe(400);
  // The server flags the variant that differs from the first member of the family.
  await expect(page.getByTestId("exercise-errors-1")).toContainText("rodziny");
  await page.getByTestId("calculation-family-0").fill("conversion");
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith("/lesson-drafts/" + versionId));
  await page.getByTestId("save-lesson").click();
  const draft = LessonDraftDtoSchema.parse(await (await saved).json());
  expect(draft.exercises[0]).toMatchObject({ answer: "2500 m", calculation: { kind: "unit_conversion", params: { value: 2.5, fromUnit: "km" }, unit: "m", templateFamilyId: "conversion" } });
  expect(draft.exercises[0]!.calculation!.tolerance).toBeUndefined();
});

/** Szkic spełniający minima publikacji szkoły (3/2/2, dwa różne pytania otwarte) z jednym rachunkiem. */
async function publishAssignedCalculationLesson(page: Page) {
  await loginParent(page);
  const child = await page.request.post("/api/v1/parent/children", { data: { displayName: "Rachunki " + randomUUID().slice(0, 6), avatarKey: "owl" } });
  expect(child.status()).toBe(201);
  const childId = ((await child.json()) as { id: string }).id;
  const deckId = randomUUID();
  const versionId = randomUUID();
  const objectiveId = "school.d" + deckId.replaceAll("-", "") + ".scale";
  const pool = await worldPool();
  const context = {
    subjectId: "school", topicId: "dynamic", topicVersion: 1, objectiveIds: [objectiveId], poolSize: 20,
    examples: {}, material, subjectTitlePl: "Geografia",
    dynamicTopic: { titlePl: "Skala", objectives: [{ id: objectiveId, titlePl: "Skala mapy", descriptionEn: "Map scale.", cards: [{ title: "Skala", body: material }, { title: "Metoda", body: material }] }] },
  };
  await pool.query("insert into learning_app.decks (id,title,kind) values ($1,$2,'lesson')", [deckId, "Rachunki dziecka " + deckId.slice(0, 8)]);
  await pool.query("insert into learning_app.deck_versions (id,deck_id,version_number,edit_number,state,title,lesson_context) values ($1,$2,1,1,'draft','Skala',$3::jsonb)", [versionId, deckId, JSON.stringify(context)]);
  const common = { objectiveId, acceptedAnswers: [], sourceRefs: [{ quote: material }] };
  // Rachunek pierwszy w puli: plan należnego sprawdzenia bierze go jak w teście integracyjnym.
  const exercises = [
    { ...common, exerciseType: "lesson_calculation", instructionPl: "Oblicz.", prompt: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m.",
      answer: "750 m", focus: [], calculation: { kind: "scale_distance", params: { mapDistanceCm: 3, scaleDenominator: 25000 }, unit: "m", templateFamilyId: "scale" } },
    ...["mapie", "terenie", "skali"].map((answer) => ({ ...common, exerciseType: "lesson_choice", instructionPl: "Wybierz.", stem: "Wybierz słowo: " + answer + ".", answer, focus: [answer],
      options: [{ id: "a", text: answer }, { id: "b", text: "innym" }], correctOption: "a" })),
    ...["mapie", "terenie"].map((answer) => ({ ...common, exerciseType: "lesson_gap", instructionPl: "Uzupełnij.", stem: "Odległość na ___ (" + answer + ").", answer, focus: [answer] })),
    ...["Mnożymy odległość na mapie.", "Mnożymy przez mianownik skali."].map((answer, i) => ({ ...common, exerciseType: "lesson_open_answer", instructionPl: "Wyjaśnij.",
      prompt: "Wyjaśnij zasadę " + (i + 1) + ".", answer, focus: [answer], questionType: "definition", expectedForm: "explanation", requiredElements: [{ id: "e1", text: answer }] })),
  ];
  const saved = await page.request.patch("/api/v1/parent/lesson-drafts/" + versionId, { data: { expectedEditNumber: 1, exercises } });
  expect(saved.status()).toBe(200);
  const { editNumber } = LessonDraftDtoSchema.parse(await saved.json());
  expect((await page.request.post("/api/v1/parent/lesson-drafts/" + versionId + "/publish", { data: { expectedEditNumber: editNumber } })).ok()).toBe(true);
  expect((await page.request.put("/api/v1/parent/assignments/" + childId + "/" + deckId, { data: { testDate: null } })).status()).toBe(204);
  // Należny cel: nowa sesja ma zamrożony plan, a samodzielne sprawdzenie pojawia się jako powtórka.
  await pool.query(`insert into learning_app.child_objective_progress
    (child_id,subject_id,objective_id,topic_id,status,streak,next_review_at,projection_version)
    values ($1,'school',$2,'dynamic','needs_confirmation',3,'2000-01-01T00:00:00Z','proj-1')`, [childId, objectiveId]);
  return { childId, deckId };
}

/** Prowadzi sesję przez API do pierwszego wydanego rachunku (karty kończy, resztę pomija). */
async function reachCalculationTask(page: Page, childId: string, deckId: string): Promise<{ sessionId: string; task: TaskDto }> {
  const started = await page.request.post("/api/v1/kid/sessions", { data: { childId, deckId, microphoneEnabled: false } });
  expect(started.ok()).toBe(true);
  const { sessionId } = SessionDtoSchema.parse(await started.json());
  const issued: string[] = [];
  for (let i = 0; i < 15; i++) {
    const next = await page.request.post("/api/v1/kid/sessions/" + sessionId + "/next");
    expect(next.status(), "wydane przed wyczerpaniem budżetu: " + issued.join(", ")).toBe(200);
    const task = TaskDtoSchema.parse(await next.json());
    issued.push(task.prompt.kind);
    if (task.prompt.kind === "lesson_calculation") return { sessionId, task };
    const step = task.prompt.kind === "lesson_card"
      ? await page.request.post("/api/v1/kid/tasks/" + task.taskId + "/complete-presentation", { data: {} })
      : await page.request.post("/api/v1/kid/tasks/" + task.taskId + "/attempts", { data: { clientAttemptId: randomUUID(), modality: "skip" } });
    expect(step.ok()).toBe(true);
  }
  throw new Error("Sesja nie wydała zadania rachunkowego");
}

async function openKidDeck(page: Page, childId: string, deckId: string) {
  await page.goto("/kids/" + childId + "/learn");
  const deck = page.locator('[data-testid="kid-deck-card"][data-deck-id="' + deckId + '"]');
  await expect(deck).toBeVisible();
  await deck.getByTestId("kid-deck").click();
}

test("child answers a published calculation in Polish notation; reload keeps the task and never duplicates the attempt", async ({ page }) => {
  const { childId, deckId } = await publishAssignedCalculationLesson(page);
  const { task } = await reachCalculationTask(page, childId, deckId);
  expect(task.prompt).toEqual({ kind: "lesson_calculation", instructionPl: "Oblicz.", prompt: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m." });
  expect(JSON.stringify(task)).not.toMatch(/750 m|"calculation"|"answer"|scaleDenominator|templateFamilyId|sourceRefs|tolerance/);

  await openKidDeck(page, childId, deckId);
  await expect(page.locator('main[data-task-id="' + task.taskId + '"]')).toBeVisible();
  await expect(page.getByTestId("kid-lesson-source")).toContainText("3 cm");
  await page.reload();
  await openKidDeck(page, childId, deckId);
  await expect(page.locator('main[data-task-id="' + task.taskId + '"]')).toBeVisible();

  const input = page.getByTestId("kid-lesson-input");
  await input.fill("0,75 km");
  const attemptResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/tasks/" + task.taskId + "/attempts"));
  await page.getByTestId("kid-lesson-check").click();
  const response = await attemptResponse;
  expect(response.request().postDataJSON()).toMatchObject({ modality: "text", text: "0,75 km" });
  const attempt = AttemptDtoSchema.parse(await response.json());
  expect(attempt.feedback).toEqual({ kind: "great" });
  await expect(page.getByTestId("kid-feedback")).toContainText("Świetnie!");

  await page.reload();
  await openKidDeck(page, childId, deckId);
  await expect(page.locator("main[data-task-id]")).toBeVisible();
  await expect(page.locator('main[data-task-id="' + task.taskId + '"]')).toHaveCount(0);
  const pool = await worldPool();
  const rows = (await pool.query(`select a.outcome, a.independent, a.details->>'verdict' as verdict from learning_app.assessments a
    join learning_app.attempts t on t.id=a.attempt_id where t.task_id=$1`, [task.taskId])).rows;
  expect(rows).toEqual([{ outcome: "correct", independent: true, verdict: "closed_correct" }]);
  expect((await pool.query("select count(*)::int as count from learning_app.attempts where task_id=$1", [task.taskId])).rows[0]!.count).toBe(1);
});
