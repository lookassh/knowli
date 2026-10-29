import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Edytor lekcji na Mantine (plan 2026-10-29-parent-ui-mantine, faza 6b;
 * szkic zaakceptowany 2026-10-29, decyzje A–D): zakładki „Ćwiczenia” /
 * „Dzieci i postęp”, reguły i etapy jako grupy rozwijane (telefon: pierwsza
 * reguła rozwinięta, etapy zwinięte; desktop: wszystko rozwinięte), karta
 * ćwiczenia jako podgląd z „Edytuj”, błąd walidacji rozwija swoją grupę,
 * dogenerowanie w oknie, przypięty pasek akcji, tryb ciemny. API rodzica
 * zaślepione w przeglądarce.
 */

const deckId = "00000000-0000-4000-8000-0000000000f1";
const draftId = "00000000-0000-4000-8000-0000000000f2";
const publishedId = "00000000-0000-4000-8000-0000000000f3";
const childId = "00000000-0000-4000-8000-0000000000c1";
const OBJ_A = "english_grammar.present_simple.third_person_s";
const OBJ_B = "english_grammar.present_simple.negative";
const uuid = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

const choice = (n: number, objectiveId: string) => ({
  id: uuid(n), revisionId: uuid(n + 50), exerciseType: "lesson_choice", objectiveId,
  instructionPl: "Wybierz poprawną formę.", stem: `He ___ football (${n}).`, answer: "plays",
  acceptedAnswers: [], focus: ["-s"], options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }], correctOption: "a",
});
const gap = (n: number, objectiveId: string) => ({
  id: uuid(n), revisionId: uuid(n + 50), exerciseType: "lesson_gap", objectiveId,
  instructionPl: "Uzupełnij zdanie.", stem: `She ___ (watch) TV (${n}).`, answer: "watches", acceptedAnswers: [], focus: ["-es"],
});

const version = (id: string, status: "draft" | "published", editNumber: number) => ({
  id, deckId, editNumber, status, title: "Present Simple", subjectId: "english_grammar", topicId: "present_simple", topicVersion: 1,
  objectiveIds: [OBJ_A, OBJ_B],
  examples: { [OBJ_A]: ["He plays football every day."], [OBJ_B]: ["He doesn't play."] },
  exercises: [choice(1, OBJ_A), gap(2, OBJ_A), choice(3, OBJ_B), gap(4, OBJ_B)],
  assets: [], rejectedCount: 0, coverage: [],
});

const lesson = {
  id: deckId, title: "Present Simple", state: "published", sessionTaskBudget: 20,
  draft: version(draftId, "draft", 2), published: version(publishedId, "published", 1), generation: null,
  assignments: [{ childId, displayName: "Ala", testDate: "2026-11-12", testGoals: null, mockTestTaskCount: 10, active: true }],
  grading: { available: true, model: "test-grader" },
};

const catalog = {
  subjects: [{
    id: "english_grammar", titlePl: "Gramatyka angielska",
    topics: [{
      id: "present_simple", version: 1, titlePl: "Present Simple",
      objectives: [
        { id: OBJ_A, titlePl: "Końcówka -s w 3. osobie", cards: [{ title: "Jak dodajemy -s", body: "Do czasownika dodajemy -s. {{examples}}" }] },
        { id: OBJ_B, titlePl: "Przeczenia z doesn't", cards: [{ title: "Przeczenia", body: "Używamy doesn't. {{examples}}" }] },
      ],
    }],
  }],
};

interface Calls { requests: Array<{ method: string; path: string; body: unknown }> }

async function openLesson(page: Page, options: { data?: typeof lesson } = {}): Promise<Calls> {
  const data = options.data ?? lesson;
  const calls: Calls = { requests: [] };
  await page.route("**/api/v1/parent/**", (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    calls.requests.push({ method, path, body: method === "GET" ? null : request.postDataJSON() });
    if (path.endsWith("/login")) return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (path.endsWith("/lesson-catalog")) return route.fulfill({ json: catalog });
    if (path.endsWith("/children")) return route.fulfill({ json: [{ id: childId, displayName: "Ala", avatarKey: "fox", recordingMode: "hold", canRead: true }] });
    if (path.endsWith("/decks")) return route.fulfill({ json: [{ deckId, title: lesson.title, state: "published", kind: "lesson", editableVersionId: draftId, publishedVersionId: publishedId }] });
    if (path.endsWith(`/lessons/${deckId}`)) return route.fulfill({ json: data });
    if (method === "POST" && path.endsWith(`/decks/${deckId}/archive`)) return route.fulfill({ status: 204, body: "" });
    if (method === "PATCH" && path.endsWith(`/lesson-drafts/${draftId}`)) {
      return route.fulfill({ status: 400, json: {
        code: "validation", message: "Popraw ćwiczenia.", retryable: false, requestId: "r",
        details: { exercises: [{ index: 3, errors: ["Odpowiedź nie może być pusta."] }] },
      } });
    }
    if (method === "POST" && path.endsWith(`/lesson-drafts/${draftId}/regenerate`)) {
      return route.fulfill({ status: 202, json: { generationRunId: uuid(99), deckId } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/parent/decks/${deckId}`);
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  await expect(page.locator('[data-testid^="objective-group-"]').first()).toBeVisible();
  return calls;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("telefon: pierwsza reguła rozwinięta, etapy zwinięte, pasek nad nawigacją, cele ≥ 44 px", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await openLesson(page);
    await expectNoHorizontalOverflow(page);

    // pierwsza reguła: karta wyjaśnienia widoczna, etapy zwinięte; druga reguła zwinięta
    await expect(page.getByTestId(`examples-${OBJ_A}`)).toBeVisible();
    await expect(page.getByTestId("exercise-0")).toBeHidden();
    await expect(page.getByTestId(`examples-${OBJ_B}`)).toBeHidden();
    await page.getByTestId(`stage-${OBJ_A}-guided`).getByRole("button").first().click();
    await expect(page.getByTestId("exercise-0")).toBeVisible();
    // podgląd karty: treść i poprawna odpowiedź, bez pól
    await expect(page.getByTestId("exercise-0")).toContainText("✓ plays");
    await expect(page.getByTestId("exercise-instruction-0")).toHaveCount(0);

    const bar = (await page.getByTestId("editor-action-bar").boundingBox())!;
    const nav = (await page.getByTestId("tab-decks").boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y + 1);
    for (const id of ["editor-back", "lesson-menu", "lesson-tab-children", `objective-menu-${OBJ_A}`, "exercise-menu-0", "exercise-edit-0", "save-lesson", "publish-lesson"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width, id).toBeLessThanOrEqual(viewport.width + 0.5);
    }
    await page.getByTestId("exercise-edit-0").click();
    await expect(page.getByTestId("exercise-option-0-1")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});

test("desktop: wszystko rozwinięte, edycja karty zostawia ją otwartą i blokuje publikację", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLesson(page);
  for (const index of [0, 1, 2, 3]) await expect(page.getByTestId(`exercise-${index}`)).toBeVisible();
  await expect(page.getByTestId("publish-lesson")).toBeEnabled();

  await page.getByTestId("exercise-edit-1").click();
  await page.getByTestId("exercise-answer-1").fill("watched");
  // lekcja bez audio: znacznik zmiany bez wzmianki o mediach
  await expect(page.getByTestId("exercise-1")).toContainText(messages.lessons.exerciseChanged);
  // zmieniona karta nie daje się zwinąć
  await expect(page.getByTestId("exercise-collapse-1")).toHaveCount(0);
  await expect(page.getByTestId("publish-lesson")).toBeDisabled();
  await expect(page.getByTestId("publish-blocked-reason")).toContainText(messages.decks.unsavedChanges);
  // dogenerowanie zablokowane przy niezapisanych zmianach
  await expect(page.getByTestId(`regen-open-${OBJ_A}`)).toBeDisabled();
});

test("błąd walidacji przy ćwiczeniu rozwija jego regułę i etap na telefonie", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLesson(page);
  await page.getByTestId("editor-title").fill("Present Simple — poprawki");
  await page.getByTestId("save-lesson").click();
  await expect(page.getByTestId("exercise-errors-3")).toBeVisible();
  await expect(page.getByTestId("exercise-errors-3")).toContainText("Odpowiedź nie może być pusta.");
  // karta z błędem w trybie edycji
  await expect(page.getByTestId("exercise-answer-3")).toBeVisible();
  await expect(page.getByTestId("api-error")).toContainText(messages.errors.validation);
});

test("zakładka „Dzieci i postęp”: przypisanie z terminem, nadzór; ćwiczenia ukryte", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLesson(page);
  await page.getByTestId("lesson-tab-children").click();
  await expect(page.getByTestId("assign-row-0")).toBeVisible();
  await expect(page.getByTestId("assignment-row-0")).toContainText("12.11.2026");
  await expect(page.getByTestId("supervision-panel")).toBeVisible();
  await expect(page.getByTestId(`objective-group-${OBJ_A}`)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // usunięcie przypisania wymaga potwierdzenia w oknie (bez okna przeglądarki)
  page.on("dialog", (dialog) => { throw new Error(`niespodziewane okno przeglądarki: ${dialog.message()}`); });
  await page.getByTestId("unassign-submit-0").click();
  await expect(page.getByTestId("unassign-confirm")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("unassign-confirm")).toHaveCount(0);
});

test("dogenerowanie: okno z liczbą (domyślnie 4) wysyła polecenie dla reguły", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const calls = await openLesson(page);
  await page.getByTestId(`regen-open-${OBJ_B}`).click();
  await expect(page.getByTestId(`regen-count-${OBJ_B}`)).toHaveValue("4");
  await page.getByTestId(`regen-count-${OBJ_B}`).fill("6");
  await page.getByTestId(`regen-submit-${OBJ_B}`).click();
  await expect.poll(() => calls.requests.filter((r) => r.method === "POST" && r.path.endsWith("/regenerate")).length).toBe(1);
  const body = calls.requests.find((r) => r.path.endsWith("/regenerate"))!.body as Record<string, unknown>;
  expect(body).toMatchObject({ objectiveId: OBJ_B, count: 6 });
});

test("tryb ciemny obejmuje edytor lekcji", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await openLesson(page);
  await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", "dark");
  for (const id of ["exercise-0", "editor-action-bar"]) {
    const background = await page.getByTestId(id).evaluate((element) => getComputedStyle(element).backgroundColor);
    const [r, g, b] = background.match(/\d+/g)!.map(Number);
    expect(r! + g! + b!, id).toBeLessThan(3 * 80);
  }
});

test("menu ⋯ lekcji: usunięcie z listy po potwierdzeniu wraca do listy bez tej lekcji", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await openLesson(page);
  await page.getByTestId("lesson-menu").click();
  await page.getByTestId("archive-lesson").click();
  const dialog = page.getByRole("dialog", { name: messages.lessons.archiveTitle });
  await expect(dialog).toBeVisible();
  expect(calls.requests.filter((r) => r.path.endsWith("/archive"))).toHaveLength(0);
  await dialog.getByRole("button", { name: messages.lessons.archive }).click();
  await expect(page).toHaveURL(/\/parent\/decks$/);
  expect(calls.requests.filter((r) => r.method === "POST" && r.path.endsWith("/archive"))).toHaveLength(1);
  // lista z serwera jeszcze pokazuje lekcję jako aktywną — panel ukrywa ją od razu
  await expect(page.locator(`[data-deck-id="${deckId}"]`)).toHaveCount(0);
});

test("zagadnienie szkolne przy 320 px: pola z przyciskami bez przepełnienia, usunięcie zagadnienia po potwierdzeniu", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const OBJ = "school.map.scale";
  const school = {
    ...version(draftId, "draft", 2),
    subjectId: "school", topicId: "map", subjectTitlePl: "Geografia",
    objectiveIds: [OBJ],
    examples: {},
    dynamicTopic: { titlePl: "Posługuję się mapą", objectives: [{ id: OBJ, titlePl: "Skala mapy", cards: [
      { title: "Skala", body: "Skala mówi, ile razy odległość na mapie jest mniejsza niż w terenie." },
      { title: "Przykład", body: "1:25 000 — 1 cm to 250 m." },
    ] }] },
    exercises: [{
      id: uuid(10), revisionId: uuid(60), exerciseType: "lesson_open_answer", objectiveId: OBJ,
      instructionPl: "Odpowiedz jednym zdaniem.", prompt: "Czym jest skala mapy?", answer: "Stosunek odległości na mapie do odległości w terenie.",
      acceptedAnswers: [], focus: [], questionType: "definition", expectedForm: "one_sentence",
      requiredElements: [{ id: "e1", text: "stosunek odległości" }, { id: "e2", text: "mapa a teren" }],
      supplementaryElements: [], commonErrors: ["myli skalę z legendą"],
      sourceRefs: [{ quote: "Skala mapy to stosunek odległości na mapie do odległości w terenie." }, { quote: "Własne wyjaśnienie", parentAdded: true }],
    }],
  };
  await openLesson(page, { data: { ...lesson, draft: school, published: null, assignments: [] } as unknown as typeof lesson });
  await expect(page.getByTestId(`examples-${OBJ}`)).toBeVisible();
  await page.getByTestId(`stage-${OBJ}-independent`).getByRole("button").first().click();
  await page.getByTestId("exercise-edit-0").click();
  // fokus przechodzi na pierwsze pole karty
  await expect(page.getByTestId("exercise-instruction-0")).toBeFocused();
  for (const id of ["exercise-required-remove-0-0", "exercise-source-remove-0-0", `dynamic-objective-remove-${OBJ}`, "exercise-required-0-0", "exercise-source-0-0"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width, id).toBeLessThanOrEqual(320 + 0.5);
    expect(box.width, id).toBeGreaterThan(120);
  }
  await expectNoHorizontalOverflow(page);

  await page.getByTestId(`dynamic-objective-remove-${OBJ}`).click();
  await expect(page.getByTestId("dynamic-objective-remove-confirm")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("exercise-0")).toBeVisible();
  await page.getByTestId(`dynamic-objective-remove-${OBJ}`).click();
  await page.getByTestId("dynamic-objective-remove-confirm").click();
  await expect(page.getByTestId("exercise-0")).toHaveCount(0);
});

test("ćwiczenie z gotowym audio: odsłuch w menu ⋯, po zmianie zapowiedź nowych mediów", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const withAudio = {
    ...lesson,
    draft: { ...lesson.draft, assets: [{ itemRevisionId: uuid(51), role: "target_audio", state: "approved", assetId: uuid(90) }] },
  };
  await openLesson(page, { data: withAudio as unknown as typeof lesson });
  await expect(page.getByTestId("exercise-audio-state-0")).toBeVisible();
  await page.getByTestId("exercise-menu-0").click();
  await expect(page.getByTestId("exercise-play-0")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("exercise-edit-0").click();
  await page.getByTestId("exercise-instruction-0").fill("Wybierz właściwą formę.");
  await expect(page.getByTestId("exercise-0")).toContainText(messages.decks.changedMediaAfterSave);
  await expect(page.getByTestId("exercise-audio-state-0")).toHaveCount(0);
});
