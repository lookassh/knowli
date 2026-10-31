import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LessonDeckDtoSchema, messages } from "@learning/contracts";
import { closeWorldDatabase, worldPool } from "./helpers/world-database";
import { loginParent } from "./helpers/parent-session";

/**
 * E2E zakładki „Źródła” na prawdziwej bazie, workerze i fałszywych providerach
 * (Etap 2, design 2026-10-30 §3.4): rodzic zapisuje źródło (fikcyjny rozdział),
 * tworzy z niego lekcję rozdziału (formularz bez pola materiału, polecenie
 * z `sourceMaterialId`), czeka na generację workera, widzi w edytorze „Ze źródła”,
 * po edycji źródła — notkę o zmianie, a po jego usunięciu lekcja zostaje
 * z własną kopią tekstu, bez odnośnika. Efekt sprawdzany w interfejsie, w API
 * rodzica i w bazie (`decks.source_material_id`, kontekst wersji zestawu).
 */

test.afterAll(closeWorldDatabase);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Fikcyjny rozdział: słowa i dwie ramy zdaniowe (bez fragmentów podręcznika). */
const CHAPTER_BODY = [
  "Zagadnienie 1: Ubrania",
  "coat, boots, dress, skirt, t-shirt",
  "Zagadnienie 2: Pogoda",
  "It's raining. It's snowing. What's the weather like?",
  "Zagadnienie 3: Co mam na sobie",
  "I'm wearing a coat. I'm wearing boots.",
].join("\n");
const ADDED_LINE = "It's sunny today.";

interface StoredDeck {
  source_material_id: string | null;
  source_material_revision: number | null;
}

test("rodzic tworzy źródło, lekcję rozdziału, edytuje i usuwa źródło — lekcja zostaje z własną kopią", async ({ page }) => {
  const title = `Rozdział ${randomUUID().slice(0, 8)}: Ubrania i pogoda`;
  const pool = await worldPool();
  await loginParent(page);

  // 1. Nowe źródło: okno z tytułem i tekstem, po zapisie — strona źródła.
  await page.goto("/parent/sources");
  await expect(page.getByTestId("sources-panel")).toBeVisible();
  const createdSource = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/parent/sources"),
  );
  await page.getByTestId("new-source-open").click();
  await expect(page.getByTestId("new-source-dialog")).toBeVisible();
  await expect(page.getByTestId("source-create-submit")).toBeDisabled();
  await page.getByTestId("source-title").fill(title);
  await page.getByTestId("source-body").fill(CHAPTER_BODY);
  await page.getByTestId("source-create-submit").click();
  expect((await createdSource).status()).toBe(201);
  await expect(page).toHaveURL(new RegExp(`/parent/sources/${UUID}$`));
  const sourceId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("source-heading")).toHaveText(title);
  await expect(page.getByTestId("source-preview")).toContainText("coat, boots, dress, skirt, t-shirt");
  await expect(page.getByTestId("source-no-decks")).toBeVisible();

  // Źródło jest na liście (z prawdziwej bazy) i wraca po przeładowaniu strony.
  await page.reload();
  await expect(page.getByTestId("source-heading")).toHaveText(title);
  await page.getByTestId("source-back").click();
  await expect(page).toHaveURL(/\/parent\/sources$/);
  const row = page.locator(`[data-source-id="${sourceId}"]`);
  await expect(row).toContainText(title);
  await expect(row).toContainText(messages.sources.deckCount.many!.replace("{n}", "0"));

  // 2. „Utwórz lekcję rozdziału”: formularz z podglądem źródła, bez pola materiału.
  await row.click();
  await page.getByTestId("source-create-chapter").click();
  await expect(page).toHaveURL(new RegExp(`/parent/lessons/new\\?source=${sourceId}&subject=english_chapter$`));
  await expect(page.getByTestId("new-lesson-form")).toBeVisible();
  await expect(page.getByTestId("lesson-subject")).toHaveValue("english_chapter");
  await expect(page.getByTestId("lesson-material")).toHaveCount(0);
  await expect(page.getByTestId("lesson-source")).toContainText(messages.sources.fromSource.replace("{title}", title));
  await expect(page.getByTestId("lesson-source-preview")).toContainText("I'm wearing a coat.");
  await expect(page.getByTestId("material-topic-name")).toHaveValue(title);
  await page.getByTestId("lesson-pool-size").fill("40");

  const lessonRequest = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/v1/parent/lessons/material"),
  );
  const lessonResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/parent/lessons/material"),
  );
  await page.getByTestId("lesson-create-submit").click();
  const command = (await lessonRequest).postDataJSON() as Record<string, unknown>;
  // Polecenie niesie odwołanie do źródła zamiast tekstu — serwer kopiuje jego bieżącą treść.
  expect(command).toMatchObject({ subjectId: "english_chapter", sourceMaterialId: sourceId });
  expect(command).not.toHaveProperty("material");
  const accepted = await lessonResponse;
  expect(accepted.status()).toBe(202);
  const { deckId } = (await accepted.json()) as { deckId: string };

  // 3. Edytor: generacja workera kończy się, a nagłówek wskazuje źródło.
  await expect(page).toHaveURL(new RegExp(`/parent/decks/${deckId}$`));
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  const note = page.getByTestId("lesson-source-note");
  await expect(note).toContainText(messages.sources.fromSource.replace("{title}", title));
  await expect(page.getByTestId("lesson-source-changed")).toHaveCount(0);
  await expect(page.getByTestId("generation-banner")).toBeHidden({ timeout: 120_000 });
  await expect(page.locator('[data-testid^="objective-group-"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('[data-testid^="exercise-"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("generation-failed")).toHaveCount(0);

  const afterCreate = LessonDeckDtoSchema.parse(await (await page.request.get(`/api/v1/parent/lessons/${deckId}`)).json());
  expect(afterCreate.source).toEqual({ id: sourceId, title, copiedRevision: 1, currentRevision: 1 });
  expect(afterCreate.draft?.exercises.length).toBeGreaterThan(0);

  // Baza: odnośnik i rewizja źródła przy zestawie oraz kopia tekstu w kontekście wersji.
  const storedLesson = async () => {
    const { rows: decks } = await pool.query<StoredDeck>(
      "select source_material_id, source_material_revision from learning_app.decks where id = $1", [deckId],
    );
    const { rows: versions } = await pool.query<{ material: string }>(
      "select lesson_context->>'material' as material from learning_app.deck_versions where deck_id = $1", [deckId],
    );
    return { deck: decks[0], materials: versions.map((version) => version.material) };
  };
  const created = await storedLesson();
  expect(created.deck).toEqual({ source_material_id: sourceId, source_material_revision: 1 });
  expect(created.materials).toEqual([CHAPTER_BODY]);

  // 4. Strona źródła pokazuje zestaw bez znacznika zmiany; edycja dopisuje linię do tekstu.
  await page.getByTestId("lesson-source-link").click();
  await expect(page).toHaveURL(new RegExp(`/parent/sources/${sourceId}$`));
  await expect(page.getByTestId("source-deck-0")).toHaveAttribute("data-deck-id", deckId);
  await expect(page.getByTestId("source-deck-stale-0")).toHaveCount(0);
  await page.getByTestId("source-edit").click();
  await page.getByTestId("source-body").fill(`${CHAPTER_BODY}\n${ADDED_LINE}`);
  const patched = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/v1/parent/sources/${sourceId}`),
  );
  await page.getByTestId("source-save").click();
  expect((await patched).status()).toBe(200);
  await expect(page.getByTestId("source-status")).toHaveText(messages.sources.saved);
  await expect(page.getByTestId("source-preview")).toContainText(ADDED_LINE);
  await expect(page.getByTestId("source-deck-stale-0")).toHaveText(messages.sources.sourceChanged);

  // 5. Lekcja ma własną kopię: edytor pokazuje notkę zmiany, a tekst lekcji się nie zmienia.
  await page.getByTestId("source-deck-0").click();
  await expect(page).toHaveURL(new RegExp(`/parent/decks/${deckId}$`));
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  await expect(page.getByTestId("lesson-source-note")).toContainText(messages.sources.fromSource.replace("{title}", title));
  await expect(page.getByTestId("lesson-source-changed")).toHaveText(messages.sources.sourceChanged);
  const afterEdit = LessonDeckDtoSchema.parse(await (await page.request.get(`/api/v1/parent/lessons/${deckId}`)).json());
  expect(afterEdit.source).toEqual({ id: sourceId, title, copiedRevision: 1, currentRevision: 2 });
  const edited = await storedLesson();
  expect(edited.deck).toEqual({ source_material_id: sourceId, source_material_revision: 1 });
  expect(edited.materials).toEqual([CHAPTER_BODY]);

  // 6. Usunięcie źródła z potwierdzeniem podającym liczbę zestawów.
  await page.getByTestId("lesson-source-link").click();
  await expect(page).toHaveURL(new RegExp(`/parent/sources/${sourceId}$`));
  await page.getByTestId("source-delete").click();
  await expect(page.getByTestId("source-delete-dialog")).toContainText(messages.sources.deleteConfirm.replace("{n}", "1"));
  const deleted = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/v1/parent/sources/${sourceId}`),
  );
  await page.getByTestId("source-delete-confirm").click();
  expect((await deleted).status()).toBe(204);
  await expect(page).toHaveURL(/\/parent\/sources$/);
  await expect(page.locator(`[data-source-id="${sourceId}"]`)).toHaveCount(0);
  expect((await page.request.get(`/api/v1/parent/sources/${sourceId}`)).status()).toBe(404);

  // 7. Lekcja zostaje z treścią i własną kopią tekstu, ale bez odnośnika do źródła.
  await page.goto(`/parent/decks/${deckId}`);
  await expect(page.getByTestId("lesson-editor")).toBeVisible();
  await expect(page.locator('[data-testid^="exercise-"]').first()).toBeVisible();
  await expect(page.getByTestId("lesson-source-note")).toHaveCount(0);
  await expect(page.getByTestId("lesson-source-link")).toHaveCount(0);
  const afterDelete = LessonDeckDtoSchema.parse(await (await page.request.get(`/api/v1/parent/lessons/${deckId}`)).json());
  expect(afterDelete.source).toBeUndefined();
  expect(afterDelete.draft?.exercises.length).toBe(afterCreate.draft?.exercises.length);
  const removed = await storedLesson();
  expect(removed.deck?.source_material_id).toBeNull();
  expect(removed.materials).toEqual([CHAPTER_BODY]);
});
