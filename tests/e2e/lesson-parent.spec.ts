import { expect, test, type Page } from "@playwright/test";
import { openNewMaterial } from "./helpers/parent-new-material";
import { randomUUID } from "node:crypto";
import { LessonDeckDtoSchema } from "@learning/contracts";

/**
 * E2E panelu rodzica dla lekcji (fake providerzy, zadanie 12). Pełny przepływ:
 * logowanie → Nowa lekcja (Present Simple) z materiałem → generowanie (polling)
 * → przegląd pogrupowany po regułach i etapach → edycja odpowiedzi z błędem
 * walidacji (komunikat przy ćwiczeniu) i poprawką → zapis → brak pokrycia
 * (usunięcie etapu samodzielnego) → dogenerowanie → publikacja → przypisanie
 * dziecku z celem „Gramatyka" → lista pokazuje lekcję. Dodatkowo: ochrona
 * wyjścia z niezapisanymi zmianami i konflikt wersji.
 */

async function enterParent(page: Page): Promise<void> {
  await page.goto("/parent");
  await page.getByTestId("auth-secret").fill("1234");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("tab-decks")).toBeVisible();
  await page.getByTestId("tab-decks").click();
}

async function createLesson(
  page: Page,
  title: string,
  waitForGeneration = true,
  selectedObjectiveIds?: readonly string[],
): Promise<string> {
  await openNewMaterial(page, "lesson");
  await expect(page.getByTestId("new-lesson-form")).toBeVisible();
  // Katalog ma english_grammar → present_simple z regułami zaznaczonymi domyślnie.
  await expect(page.getByTestId("lesson-subject")).toBeVisible();
  // Domyślnie jedna reguła: cała pula trafia na nią, więc etapy spełniają minima
  // (guided≥3, productive≥4, independent≥2) i pokrycie startowo jest pełne.
  const objectiveCheckboxes = page.locator('[data-testid^="lesson-objective-"]');
  await expect(objectiveCheckboxes.first()).toBeVisible();
  const objectiveCount = await objectiveCheckboxes.count();
  for (let i = 0; i < objectiveCount; i++) {
    const id = (await objectiveCheckboxes.nth(i).getAttribute("data-testid"))!.replace("lesson-objective-", "");
    const objective = page.getByTestId(`lesson-objective-${id}`);
    const shouldBeChecked = selectedObjectiveIds ? selectedObjectiveIds.includes(id) : i === 0;
    await objective.setChecked(shouldBeChecked);
    await expect(objective).toBeChecked({ checked: shouldBeChecked });
  }
  await page.getByTestId("lesson-material").fill(
    `Materiał ${title}. He plays football every day. She watches television in the evening. They study English on Monday and Tuesday.`,
  );
  // Pula 20 na jedną regułę → guided 7 / productive 9 / independent 4 (spełnia minima),
  // a przegląd/usuwanie są lekkie.
  await page.getByTestId("lesson-pool-size").fill(selectedObjectiveIds && selectedObjectiveIds.length > 1 ? "60" : "20");
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/parent/lessons"),
  );
  await page.getByTestId("lesson-create-submit").click();
  const deck = (await (await created).json()) as { deckId: string };
  // Po utworzeniu wchodzimy do edytora i czekamy na koniec generowania (polling).
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  if (!waitForGeneration) return deck.deckId;
  await expect(page.getByTestId("generation-banner")).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('[data-testid^="objective-group-"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-testid^="exercise-"]').first()).toBeVisible({ timeout: 120_000 });
  // Nadaj tytuł i zapisz, aby lista pokazywała lekcję po tytule.
  await page.getByTestId("editor-title").fill(title);
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/lesson-drafts/"),
  );
  await page.getByTestId("save-lesson").click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId("save-lesson")).toBeEnabled();
  await expect(page.getByTestId("editor-title")).toHaveValue(title);
  return deck.deckId;
}

test("defaults the pool size to max(60, 12 × selected objectives)", async ({ page }) => {
  await enterParent(page);
  await openNewMaterial(page, "lesson");
  await expect(page.locator('[data-testid^="lesson-objective-"]').first()).toBeVisible();
  const objectiveCount = await page.locator('[data-testid^="lesson-objective-"]').count();
  await expect(page.getByTestId("lesson-pool-size")).toHaveValue(String(Math.max(60, 12 * objectiveCount)));
});

test("parent can safely restart a running lesson generation", async ({ page }) => {
  await enterParent(page);
  await createLesson(page, `Restart ${randomUUID().slice(0, 8)}`, false);
  const retry = page.getByTestId("retry-stalled-generation");
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.getByTestId("generation-banner")).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('[data-testid^="objective-group-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="exercise-audio-state-"]')).toHaveCount(0);
});

test("generates a multi-objective Present Simple pool with Polish prompts and no audio assets", async ({ page }) => {
  const title = `Cele Present Simple ${randomUUID().slice(0, 8)}`;
  const objectiveIds = [
    "english_grammar.present_simple.question",
    "english_grammar.present_simple.negative",
    "english_grammar.present_simple.short_answers",
  ];
  await enterParent(page);
  const deckId = await createLesson(page, title, true, objectiveIds);

  for (const objectiveId of objectiveIds) {
    await expect(page.getByTestId(`objective-group-${objectiveId}`)).toBeVisible();
    await expect(page.getByTestId(`examples-${objectiveId}`)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="exercise-audio-state-"]')).toHaveCount(0);

  const response = await page.request.get(`/api/v1/parent/lessons/${deckId}`);
  expect(response.ok()).toBeTruthy();
  const deck = LessonDeckDtoSchema.parse(await response.json());
  expect(deck.draft?.objectiveIds).toEqual(expect.arrayContaining(objectiveIds));
  expect(deck.draft?.assets).toEqual([]);
  for (const objectiveId of objectiveIds) {
    expect(deck.draft?.examples[objectiveId]?.length).toBeGreaterThan(0);
    const exercises = deck.draft!.exercises.filter((exercise) => exercise.objectiveId === objectiveId);
    expect(exercises.length).toBeGreaterThanOrEqual(9);
    expect(exercises.every((exercise) => exercise.instructionPl?.length)).toBe(true);
  }
  expect(deck.draft?.exercises.some((exercise) => exercise.exerciseType === "lesson_open_answer" && exercise.prompt?.startsWith("Przetłumacz"))).toBe(true);
});

test("creates a lesson, reviews it grouped by objective and stage, fixes a validation error, saves, closes coverage and publishes", async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8);
  const childName = `Lekcyjne dziecko ${suffix}`;
  const lessonTitle = `Present Simple ${suffix}`;

  await enterParent(page);
  // dziecko do przypisania
  await page.getByTestId("tab-children").click();
  await page.getByTestId("child-name").fill(childName);
  await page.getByTestId("child-add").click();
  const childRow = page.locator('[data-testid^="child-row-"]').filter({ hasText: childName });
  await expect(childRow).toHaveCount(1);
  const childHref = await childRow.getByTestId("child-learn-link").getAttribute("href");
  const childId = childHref?.match(/\/kids\/([0-9a-f-]{36})\//)?.[1];
  expect(childId).toBeTruthy();

  await page.getByTestId("tab-decks").click();
  await createLesson(page, lessonTitle);

  // Przegląd pogrupowany po etapach obecny.
  await expect(page.locator('[data-testid^="stage-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="exercise-type-"]').first()).toBeVisible();

  // Edycja ćwiczenia tekstowego: wyczyść „element sprawdzany" → błąd walidacji
  // domenowej przy tym ćwiczeniu (focus musi być niepusty dla typów tekstowych).
  const objectiveGroupEarly = page.locator('[data-testid^="objective-group-"]').first();
  const objId = (await objectiveGroupEarly.getAttribute("data-testid"))!.replace("objective-group-", "");
  const productiveStage = page.getByTestId(`stage-${objId}-productive`);
  const firstProductive = productiveStage.locator('[data-testid^="exercise-"]').first();
  const exerciseTestId = (await firstProductive.getAttribute("data-testid"))!; // exercise-<index>
  const idx = exerciseTestId.replace("exercise-", "");
  const originalFocus = await page.getByTestId(`exercise-focus-${idx}`).inputValue();
  await page.getByTestId(`exercise-focus-${idx}`).fill("");
  await page.getByTestId("save-lesson").click();
  await expect(page.getByTestId(`exercise-errors-${idx}`)).toBeVisible();
  // Poprawka: przywróć element sprawdzany.
  await page.getByTestId(`exercise-focus-${idx}`).fill(originalFocus);
  await page.getByTestId("save-lesson").click();
  await expect(page.getByTestId(`exercise-errors-${idx}`)).toHaveCount(0);

  // Doprowadź do braku pokrycia: usuń wszystkie ćwiczenia etapu samodzielnego.
  const objectiveGroup = page.locator('[data-testid^="objective-group-"]').first();
  const objectiveId = (await objectiveGroup.getAttribute("data-testid"))!.replace("objective-group-", "");
  const independentStage = page.getByTestId(`stage-${objectiveId}-independent`);
  let removeButtons = independentStage.locator('[data-testid^="exercise-remove-"]');
  while (await removeButtons.count()) {
    await removeButtons.first().click();
  }
  await page.getByTestId("save-lesson").click();
  // Pokrycie pokazuje brak etapu samodzielnego; publikacja zablokowana.
  await expect(page.getByTestId("coverage-gaps")).toBeVisible();
  await expect(page.getByTestId("publish-lesson")).toBeDisabled();

  // Dogeneruj dla reguły, aby domknąć brak (polling do końca generowania).
  await page.getByTestId(`regen-count-${objectiveId}`).fill("12");
  await page.getByTestId(`regen-submit-${objectiveId}`).click();
  await expect(page.getByTestId("generation-banner")).toBeHidden({ timeout: 120_000 });
  // Pokrycie domknięte → publikacja odblokowana.
  await expect(page.getByTestId("publish-lesson")).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByTestId("coverage-ok")).toBeVisible();

  // Lekcje gramatyki nie tworzą audio odpowiedzi; publikacja zależy od treści i pokrycia.
  await expect(page.locator('[data-testid^="exercise-audio-state-"]')).toHaveCount(0);

  // Publikacja (odblokowana po domknięciu pokrycia).
  await page.getByTestId("publish-lesson").click();
  await expect(page.getByTestId("publish-status")).toBeVisible({ timeout: 120_000 });

  // Przypisanie z celem kartkówki „Gramatyka".
  const assignRow = page.locator('[data-testid^="assign-row-"]').filter({ hasText: childName });
  await assignRow.getByTestId("mock-enable").check();
  await expect(assignRow.getByTestId("mock-goal-lesson")).toContainText("Gramatyka");
  await assignRow.locator('[data-testid^="assign-submit-"]').click();
  await expect(page.locator('[data-testid^="assignment-row-"]').filter({ hasText: childName })).toBeVisible();

  // Lista zestawów pokazuje lekcję z etykietą rodzaju.
  await page.getByTestId("editor-back").click();
  const lessonRow = page.locator('[data-testid^="deck-row-"]').filter({ hasText: lessonTitle });
  await expect(lessonRow).toBeVisible();
  await expect(lessonRow.locator('[data-testid^="deck-kind-"]')).toHaveText("Lekcja");

  // Lekcja opublikowana trafia do Kid API przypisanego dziecka.
  const kidDecks = await request.get(`/api/v1/kid/decks?childId=${childId}`);
  expect(kidDecks.ok()).toBeTruthy();
});

test("guards against leaving the lesson editor with unsaved changes", async ({ page }) => {
  const lessonTitle = `Ochrona ${randomUUID().slice(0, 8)}`;
  await enterParent(page);
  await createLesson(page, lessonTitle);
  await page.getByTestId("editor-title").fill(`${lessonTitle} zmienione`);
  // Próba wyjścia z brudnym formularzem → dialog ochrony.
  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("leave-editor-dialog")).toBeVisible();
  await page.getByTestId("leave-editor-stay").click();
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
});

test("shows a version conflict when the draft changed in another window", async ({ page, context }) => {
  const lessonTitle = `Konflikt ${randomUUID().slice(0, 8)}`;
  await enterParent(page);
  const deckId = await createLesson(page, lessonTitle);

  // Lokalna zmiana zamraża bazę formularza przed zapisem drugiego okna.
  await page.getByTestId("editor-title").fill(`${lessonTitle} lokalnie`);

  // Drugie okno tej samej sesji (ta sama przeglądarka/cookies) edytuje i zapisuje
  // szkic → podbija editNumber. Najnowsza lekcja jest pierwsza na liście.
  const other = await context.newPage();
  await other.goto("/parent");
  await other.getByTestId("tab-decks").click();
  await other.locator(`[data-deck-id="${deckId}"]`).click();
  await expect(other.getByTestId("lesson-editor")).toBeVisible();
  await other.getByTestId("editor-title").fill(`${lessonTitle} zdalnie`);
  const remoteSaved = other.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/lesson-drafts/"),
  );
  await other.getByTestId("save-lesson").click();
  expect((await remoteSaved).status()).toBe(200);
  await expect(other.getByTestId("editor-title")).toHaveValue(`${lessonTitle} zdalnie`);
  await other.close();

  // Pierwsze okno zapisuje na nieaktualnym editNumber → konflikt.
  const staleSave = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/v1/parent/lesson-drafts/"),
  );
  await page.getByTestId("save-lesson").click();
  expect((await staleSave).status()).toBe(409);
  await expect(page.getByTestId("lesson-conflict-panel")).toBeVisible();
  await page.getByTestId("conflict-load-remote").click();
  await expect(page.getByTestId("lesson-conflict-panel")).toHaveCount(0);
  await expect(page.getByTestId("editor-title")).toHaveValue(`${lessonTitle} zdalnie`);
});

test("keeps the lesson editor usable at phone and desktop widths", async ({ page }, testInfo) => {
  const lessonTitle = `Mobile ${randomUUID().slice(0, 8)}`;
  await enterParent(page);
  await createLesson(page, lessonTitle);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("save-lesson")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`lesson-editor-${viewport.width}.png`), fullPage: true });
  }
});


test("parent edits an AI example before publishing: change is sent in PATCH.examples and persists (P2-10)", async ({ page }) => {
  const lessonTitle = `Przyklady ${randomUUID().slice(0, 8)}`;
  await enterParent(page);
  const deckId = await createLesson(page, lessonTitle);

  // Sekcja przykładów AI jest obecna; przykłady są EDYTOWALNE (wym. 3.3), nie read-only.
  const examplesSection = page.getByTestId("lesson-examples");
  await expect(examplesSection).toBeVisible();
  const firstObjectiveBlock = examplesSection.locator('[data-testid^="examples-"]').first();
  await expect(firstObjectiveBlock).toBeVisible();
  const objectiveId = (await firstObjectiveBlock.getAttribute("data-testid"))!.replace("examples-", "");
  const exampleInput = page.getByTestId(`example-line-${objectiveId}-0`);
  await expect(exampleInput).toBeVisible();
  const previews = page.getByTestId(`lesson-card-preview-${objectiveId}`);
  await expect(previews.first()).toBeVisible();
  await expect(previews.first()).toContainText("Forma podstawowa");

  const corrected = `He plays football every day. ${randomUUID().slice(0, 6)}`;
  await exampleInput.fill(corrected);
  await expect(previews.last()).toContainText(corrected);
  await expect(page.getByTestId(`example-add-${objectiveId}`)).toBeVisible();
  await page.getByTestId(`example-add-${objectiveId}`).click();
  const added = "We work, and we learn.";
  await page.getByTestId(`example-line-${objectiveId}-1`).fill(added);
  await expect(previews.last()).toContainText(added);

  // Zapis wysyła poprawione przykłady w PATCH.examples.
  const patchPromise = page.waitForRequest(
    (r) => r.method() === "PATCH" && /\/api\/v1\/parent\/lesson-drafts\//.test(r.url()),
  );
  await page.getByTestId("save-lesson").click();
  const patch = await patchPromise;
  const body = JSON.parse(patch.postData() ?? "{}") as { examples?: Record<string, string[]> };
  expect(body.examples).toBeTruthy();
  expect(body.examples![objectiveId]).toContain(corrected);
  expect(body.examples![objectiveId]).toContain(added);

  // Przeładowanie edytora pokazuje poprawioną treść przykładu (trwałość).
  // Wejście od nowa (jak w teście konfliktu) — wiersz po deckId, lista jest pogrupowana.
  await page.goto("/parent");
  await page.getByTestId("tab-decks").click();
  await page.locator(`[data-deck-id="${deckId}"]`).click();
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  await expect(page.getByTestId(`example-line-${objectiveId}-0`)).toHaveValue(corrected);
});
