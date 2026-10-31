import { expect, test, type Page } from "@playwright/test";
import { messages } from "@learning/contracts";

/**
 * Zakładka „Źródła” panelu rodzica (Etap 2, design 2026-10-30 §3.4): lista,
 * nowe źródło, edycja z konfliktem rewizji (409), usunięcie z potwierdzeniem
 * i przyciski tworzenia lekcji ze źródła. API rodzica zaślepione
 * w przeglądarce (stan w pamięci testu), teksty fikcyjne.
 */

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NEW_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const catalog = {
  subjects: [
    { id: "english_grammar", titlePl: "Gramatyka angielska", creation: "catalog", subjectTitleRequired: false,
      topics: [{ id: "present_simple", titlePl: "Present Simple", objectives: [{ id: "negation", titlePl: "Przeczenia" }] }] },
    { id: "school", titlePl: "Przedmiot szkolny", creation: "material", subjectTitleRequired: true, topics: [] },
    { id: "english_chapter", titlePl: "Angielski — rozdział", creation: "material", subjectTitleRequired: false, topics: [] },
  ],
};

interface StoredSource {
  id: string;
  title: string;
  body: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  decks: Array<{ deckId: string; title: string; kind: "lesson" | "vocabulary"; state: string; copiedRevision: number | null; stale: boolean }>;
}

interface Api {
  sources: Map<string, StoredSource>;
  creates: Array<Record<string, unknown>>;
  patches: Array<Record<string, unknown>>;
  deletes: string[];
  lessonCreates: Array<{ path: string; body: Record<string, unknown> }>;
  /** Następny PATCH kończy się konfliktem rewizji, a źródło zmienia się „w innym oknie”. */
  conflictNext: boolean;
}

const BODY = "Unit 3 — Food\npizza — pizza\napple — jabłko\nI like pizza. Do you like apples?";

function storedSource(): StoredSource {
  return {
    id: SOURCE_ID,
    title: "Unit 3 — Food",
    body: BODY,
    revision: 2,
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-10-31T12:00:00.000Z",
    decks: [
      { deckId: "10000000-0000-4000-8000-000000000001", title: "Angielski — rozdział: Unit 3", kind: "lesson", state: "published", copiedRevision: 1, stale: true },
      { deckId: "10000000-0000-4000-8000-000000000002", title: "Jedzenie — sprawdzian", kind: "lesson", state: "draft", copiedRevision: 2, stale: false },
    ],
  };
}

function summary(source: StoredSource) {
  const { body: _body, decks, ...rest } = source;
  return { ...rest, deckCount: decks.filter((deck) => deck.state !== "archived").length };
}

const envelope = (code: string, message: string) => ({ code, message, retryable: false, requestId: "r" });

async function mockApi(page: Page): Promise<Api> {
  const api: Api = { sources: new Map([[SOURCE_ID, storedSource()]]), creates: [], patches: [], deletes: [], lessonCreates: [], conflictNext: false };
  await page.route("**/api/v1/parent/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace("/api/v1/parent", "");
    if (path === "/login") return route.fulfill({ json: { authenticated: true, setupRequired: false } });
    if (path === "/lesson-catalog") return route.fulfill({ json: catalog });
    if (path === "/sources" && method === "GET") {
      return route.fulfill({ json: [...api.sources.values()].map(summary) });
    }
    if (path === "/sources" && method === "POST") {
      const body = request.postDataJSON() as { clientRequestId: string; title: string; body: string };
      api.creates.push(body);
      api.sources.set(NEW_ID, { id: NEW_ID, title: body.title, body: body.body, revision: 1, createdAt: "2026-10-31T13:00:00.000Z", updatedAt: "2026-10-31T13:00:00.000Z", decks: [] });
      return route.fulfill({ status: 201, json: { id: NEW_ID } });
    }
    const sourceMatch = /^\/sources\/([0-9a-f-]+)$/.exec(path);
    if (sourceMatch) {
      const id = sourceMatch[1]!;
      const stored = api.sources.get(id);
      if (!stored) return route.fulfill({ status: 404, json: envelope("not_found", "Nie znaleziono.") });
      if (method === "GET") return route.fulfill({ json: stored });
      if (method === "PATCH") {
        const patch = request.postDataJSON() as { expectedRevision: number; title?: string; body?: string };
        api.patches.push(patch);
        if (api.conflictNext) {
          api.conflictNext = false;
          api.sources.set(id, { ...stored, body: `${stored.body}\nWe like apples.`, revision: stored.revision + 1 });
          return route.fulfill({ status: 409, json: envelope("conflict", "Wersja jest nieaktualna.") });
        }
        const updated = { ...stored, ...(patch.title ? { title: patch.title } : {}), ...(patch.body ? { body: patch.body } : {}), revision: stored.revision + 1,
          decks: stored.decks.map((deck) => ({ ...deck, stale: true })) };
        api.sources.set(id, updated);
        return route.fulfill({ json: updated });
      }
      if (method === "DELETE") {
        api.deletes.push(id);
        api.sources.delete(id);
        return route.fulfill({ status: 204 });
      }
    }
    if (method === "POST" && /^\/lessons(\/school|\/material)?$/.test(path)) {
      const body = request.postDataJSON() as Record<string, unknown>;
      api.lessonCreates.push({ path, body });
      return route.fulfill({ status: 202, json: { runId: "00000000-0000-4000-8000-0000000000aa", deckId: body.deckId } });
    }
    // edytor lekcji po utworzeniu: odczyt nieistotny dla tego speca
    if (/^\/lessons\/[0-9a-f-]+$/.test(path)) return route.fulfill({ status: 404, json: envelope("not_found", "Brak") });
    return route.fulfill({ json: [] });
  });
  return api;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function expectTargets(page: Page, ids: string[], width: number): Promise<void> {
  for (const id of ids) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    // ≥ 44 px; tolerancja 0,01 px na zaokrąglenie przekształceń okna (np. 43,999996 w otwartym modalu)
    expect(box!.height, id).toBeGreaterThanOrEqual(44 - 0.01);
    expect(box!.x, id).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, id).toBeLessThanOrEqual(width + 0.5);
  }
}

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
    });

    test("lista i nowe źródło: licznik znaków, zapis otwiera stronę źródła", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto("/parent/decks");
      await page.getByTestId("tab-sources").click();
      await expect(page).toHaveURL(/\/parent\/sources$/);
      await expect(page.getByTestId("tab-sources")).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId("source-row-0")).toContainText("Unit 3 — Food");
      await expect(page.getByTestId("source-row-0")).toContainText("2 zestawy");
      await expect(page.getByTestId("source-row-0")).toContainText("31.10.2026");
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["source-row-0", "new-source-open"], viewport.width);
      if (viewport.width < 600) {
        // przycisk nad dolnym paskiem nawigacji
        const fab = (await page.getByTestId("new-source-open").boundingBox())!;
        const nav = (await page.getByTestId("tab-sources").boundingBox())!;
        expect(fab.y + fab.height).toBeLessThanOrEqual(nav.y);
      }

      await page.getByTestId("new-source-open").click();
      await expect(page.getByTestId("new-source-dialog")).toBeVisible();
      await expect(page.getByTestId("source-create-submit")).toBeDisabled();
      await page.getByTestId("source-title").fill("Unit 4 — Sport");
      await page.getByTestId("source-body").fill("football — piłka nożna\nI play football.");
      await expect(page.getByTestId("source-body-counter")).toHaveText(messages.sources.counter.replace("{n}", "39"));
      await expect(page.getByTestId("source-body-hint")).toHaveText(messages.sources.bodyHint);
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["source-title", "source-body", "source-create-submit"], viewport.width);
      await page.getByTestId("source-create-submit").click();

      await expect(page).toHaveURL(new RegExp(`/parent/sources/${NEW_ID}$`));
      await expect(page.getByTestId("source-page")).toBeVisible();
      await expect(page.getByTestId("source-heading")).toHaveText("Unit 4 — Sport");
      await expect(page.getByTestId("source-no-decks")).toBeVisible();
      expect(api.creates).toEqual([{ clientRequestId: expect.any(String), title: "Unit 4 — Sport", body: "football — piłka nożna\nI play football." }]);
    });

    test("edycja: tylko zmienione pola, konflikt 409 pokazuje komunikat i odświeżenie", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(`/parent/sources/${SOURCE_ID}`);
      await expect(page.getByTestId("source-preview")).toContainText("I like pizza.");
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["source-back", "source-create-chapter", "source-create-school", "source-edit", "source-delete", "source-deck-0"], viewport.width);
      await expect(page.getByTestId("source-deck-stale-0")).toHaveText(messages.sources.sourceChanged);

      await page.getByTestId("source-edit").click();
      await expect(page.getByTestId("source-body")).toHaveValue(BODY);
      // bez zmian nie ma czego zapisać (zapis podbiłby rewizję i oznaczył zestawy jako nieaktualne)
      await expect(page.getByTestId("source-save")).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["source-title", "source-body", "source-save", "source-edit-cancel"], viewport.width);

      api.conflictNext = true;
      await page.getByTestId("source-title").fill("Unit 3 — Jedzenie");
      await expect(page.getByTestId("source-save")).toBeEnabled();
      await page.getByTestId("source-save").click();
      await expect(page.getByTestId("source-conflict")).toContainText(messages.sources.conflict);
      expect(api.patches).toEqual([{ expectedRevision: 2, title: "Unit 3 — Jedzenie" }]);
      await expect(page.getByTestId("source-save")).toBeDisabled();
      await expectNoHorizontalOverflow(page);

      await page.getByTestId("source-conflict-refresh").click();
      await expect(page.getByTestId("source-conflict")).toHaveCount(0);
      await expect(page.getByTestId("source-preview")).toContainText("We like apples.");
      await expect(page.getByTestId("source-heading")).toHaveText("Unit 3 — Food");

      // ponowna edycja od najnowszej rewizji zapisuje się
      await page.getByTestId("source-edit").click();
      await page.getByTestId("source-body").fill("I like pizza.");
      await page.getByTestId("source-save").click();
      await expect(page.getByTestId("source-preview")).toHaveText("I like pizza.");
      expect(api.patches[1]).toEqual({ expectedRevision: 3, body: "I like pizza." });
    });

    test("usunięcie: potwierdzenie z liczbą zestawów, powrót do listy", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(`/parent/sources/${SOURCE_ID}`);
      await page.getByTestId("source-delete").click();
      const dialog = page.getByTestId("source-delete-dialog");
      await expect(dialog).toContainText(messages.sources.deleteConfirm.replace("{n}", "2"));
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["source-delete-cancel", "source-delete-confirm"], viewport.width);
      await page.getByTestId("source-delete-cancel").click();
      await expect(dialog).toHaveCount(0);
      expect(api.deletes).toEqual([]);

      await page.getByTestId("source-delete").click();
      await page.getByTestId("source-delete-confirm").click();
      await expect(page).toHaveURL(/\/parent\/sources$/);
      await expect(page.getByText(messages.sources.empty)).toBeVisible();
      expect(api.deletes).toEqual([SOURCE_ID]);
    });

    test("przyciski tworzenia: formularz nowej lekcji ze źródłem zamiast pola materiału", async ({ page }) => {
      const api = await mockApi(page);
      await page.goto(`/parent/sources/${SOURCE_ID}`);
      await page.getByTestId("source-create-school").click();
      await expect(page).toHaveURL(new RegExp(`/parent/lessons/new\\?source=${SOURCE_ID}&subject=school$`));
      await expect(page.getByTestId("lesson-subject")).toHaveValue("school");
      await expect(page.getByTestId("lesson-source")).toContainText(messages.sources.fromSource.replace("{title}", "Unit 3 — Food"));
      await expect(page.getByTestId("lesson-material")).toHaveCount(0);

      await page.getByTestId("lesson-source-change").click();
      await expect(page).toHaveURL(new RegExp(`/parent/sources/${SOURCE_ID}$`));
      await page.getByTestId("source-create-chapter").click();
      await expect(page).toHaveURL(new RegExp(`/parent/lessons/new\\?source=${SOURCE_ID}&subject=english_chapter$`));
      await expect(page.getByTestId("lesson-subject")).toHaveValue("english_chapter");
      await expect(page.getByTestId("lesson-source-preview")).toContainText("Do you like apples?");
      await expect(page.getByTestId("material-topic-name")).toHaveValue("Unit 3 — Food");
      await expectNoHorizontalOverflow(page);
      await expectTargets(page, ["new-lesson-cancel", "lesson-subject", "lesson-source-change", "material-topic-name", "lesson-create-submit"], viewport.width);

      await page.getByTestId("lesson-create-submit").click();
      await expect(page).toHaveURL(/\/parent\/decks\/[0-9a-f-]+$/);
      expect(api.lessonCreates).toHaveLength(1);
      expect(api.lessonCreates[0]!.path).toBe("/lessons/material");
      expect(api.lessonCreates[0]!.body).toMatchObject({ subjectId: "english_chapter", topicTitlePl: "Unit 3 — Food", sourceMaterialId: SOURCE_ID });
      expect(api.lessonCreates[0]!.body).not.toHaveProperty("material");
    });
  });
}
