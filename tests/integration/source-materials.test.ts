import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createLessonFromMaterial,
  createSchoolLesson,
  createServices,
  createSourceMaterial,
  deleteSourceMaterial,
  executeLessonGeneration,
  getSourceMaterial,
  listSourceMaterials,
  readGeneration,
  readLessonDeck,
  regenerateObjective,
  updateSourceMaterial,
  type Services,
} from "@learning/server";
import { fakeGeneration } from "./fakes";
import { buildTestServices, ManualClock, testDatabase } from "./helpers";

/**
 * Źródła (materiał źródłowy rodzica) na PostgreSQL (design 2026-10-30, §3):
 * idempotentne tworzenie, kontrola rewizji przy edycji, usunięcie z odnośnikiem
 * zestawu ustawionym na null oraz liczniki i znacznik „stale” w odczycie, a od
 * §3.3 także tworzenie lekcji ze źródła (kopia tekstu i rewizji, brak odczytu
 * źródła po utworzeniu, usunięcie źródła w trakcie tworzenia).
 * Teksty są fikcyjne — materiał z podręcznika nie trafia do repozytorium.
 */

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function count(table: string): Promise<number> {
  const rows = await query<{ count: number }>(`select count(*)::int as count from learning_app.${table}`);
  return rows[0]!.count;
}

interface DeckSeed {
  title: string;
  kind?: "vocabulary" | "lesson";
  sourceId: string | null;
  copiedRevision?: number | null;
  archived?: boolean;
  createdAt?: string;
}

/** Wstawia zestaw z odnośnikiem do źródła bezpośrednio SQL-em (bez Task 3). */
async function insertDeck(seed: DeckSeed): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into learning_app.decks (id, title, kind, source_material_id, source_material_revision, archived_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      seed.title,
      seed.kind ?? "vocabulary",
      seed.sourceId,
      seed.copiedRevision === undefined ? (seed.sourceId ? 1 : null) : seed.copiedRevision,
      seed.archived ? "2026-10-31T09:00:00.000Z" : null,
      seed.createdAt ?? "2026-10-31T08:00:00.000Z",
    ],
  );
  return id;
}

/** Zestaw słówek w stanie „published”: wersja opublikowana + wskaźnik na decks. */
async function publishDeckDirectly(deckId: string): Promise<void> {
  const versionId = randomUUID();
  await pool.query(
    `insert into learning_app.deck_versions (id, deck_id, version_number, state, title, published_at)
     values ($1, $2, 1, 'published', 'v1', '2026-10-31T08:30:00.000Z')`,
    [versionId, deckId],
  );
  await pool.query("update learning_app.decks set published_version_id = $1 where id = $2", [versionId, deckId]);
}

describe("źródła — tabela i przypadki użycia (integracja)", () => {
  let services: Services;
  let clock: ManualClock;

  beforeEach(async () => {
    await pool.query("truncate learning_app.decks, learning_app.source_materials cascade");
    ({ services, clock } = buildTestServices("2026-10-31T10:00:00.000Z"));
  });

  afterAll(async () => {
    await pool.end();
  });

  const input = (overrides: Partial<{ clientRequestId: string; title: string; body: string }> = {}) => ({
    clientRequestId: randomUUID(),
    title: "Rozdział 4: Pogoda",
    body: "Fikcyjny tekst rozdziału o pogodzie.",
    ...overrides,
  });

  describe("createSourceMaterial", () => {
    it("stores a trimmed title and body as revision 1 with the clock time", async () => {
      const created = await createSourceMaterial(services, input({ title: "  Pogoda  ", body: "\n Tekst \n" }));

      expect(created.created).toBe(true);
      const rows = await query<{
        title: string;
        body: string;
        revision: number;
        request_hash: string;
        created_at: Date;
        updated_at: Date;
      }>("select title, body, revision, request_hash, created_at, updated_at from learning_app.source_materials where id = $1", [created.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: "Pogoda", body: "Tekst", revision: 1 });
      expect(rows[0]!.request_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]!.created_at.toISOString()).toBe("2026-10-31T10:00:00.000Z");
      expect(rows[0]!.updated_at.toISOString()).toBe("2026-10-31T10:00:00.000Z");
    });

    it("returns the existing record for a retry with the same request id and content", async () => {
      const request = input();
      const first = await createSourceMaterial(services, request);
      clock.advanceMs(60_000);
      const retry = await createSourceMaterial(services, request);
      // Normalizacja po trim: inne białe znaki wokół tej samej treści to to samo żądanie.
      const padded = await createSourceMaterial(services, { ...request, title: `  ${request.title} `, body: ` ${request.body}\n` });

      expect(retry).toEqual({ id: first.id, created: false });
      expect(padded).toEqual({ id: first.id, created: false });
      expect(await count("source_materials")).toBe(1);
      expect((await getSourceMaterial(services, first.id)).updatedAt).toBe("2026-10-31T10:00:00.000Z");
    });

    it("rejects a retry with the same request id and different content as a conflict", async () => {
      const request = input();
      const first = await createSourceMaterial(services, request);

      await expect(createSourceMaterial(services, { ...request, body: "Inna treść." })).rejects.toMatchObject({ code: "conflict" });
      await expect(createSourceMaterial(services, { ...request, title: "Inny tytuł" })).rejects.toMatchObject({ code: "conflict" });

      expect(await count("source_materials")).toBe(1);
      expect(await getSourceMaterial(services, first.id)).toMatchObject({ title: request.title, body: request.body });
    });

    it("creates a single record for two simultaneous requests with the same request id", async () => {
      const request = input();
      const results = await Promise.all([createSourceMaterial(services, request), createSourceMaterial(services, request)]);

      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(results[0]!.id).toBe(results[1]!.id);
      expect(await count("source_materials")).toBe(1);
    });

    it("lets only one of two simultaneous requests with the same id and different content win", async () => {
      const clientRequestId = randomUUID();
      const results = await Promise.allSettled([
        createSourceMaterial(services, input({ clientRequestId, body: "Treść A." })),
        createSourceMaterial(services, input({ clientRequestId, body: "Treść B." })),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "conflict" });
      expect(await count("source_materials")).toBe(1);
    });

    it("creates a new record when the same request is repeated after the source was deleted", async () => {
      const request = input();
      const first = await createSourceMaterial(services, request);
      await deleteSourceMaterial(services, first.id);

      const again = await createSourceMaterial(services, request);

      expect(again.created).toBe(true);
      expect(again.id).not.toBe(first.id);
      expect(await count("source_materials")).toBe(1);
    });

    it("rejects invalid input before writing anything", async () => {
      await expect(createSourceMaterial(services, input({ title: "   " }))).rejects.toBeDefined();
      await expect(createSourceMaterial(services, input({ title: "a".repeat(121) }))).rejects.toBeDefined();
      await expect(createSourceMaterial(services, input({ body: " \n " }))).rejects.toBeDefined();
      await expect(createSourceMaterial(services, input({ body: "a".repeat(16_001) }))).rejects.toBeDefined();
      await expect(createSourceMaterial(services, { ...input(), clientRequestId: "nie-uuid" })).rejects.toBeDefined();
      expect(await count("source_materials")).toBe(0);
    });
  });

  describe("updateSourceMaterial", () => {
    it("bumps the revision and updated_at, keeping created_at and the first request hash", async () => {
      const created = await createSourceMaterial(services, input());
      const before = (await query<{ request_hash: string }>("select request_hash from learning_app.source_materials where id = $1", [created.id]))[0]!;
      clock.advanceMs(5 * 60_000);

      const updated = await updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "Nowy tytuł", body: "Nowa treść." });

      expect(updated).toMatchObject({
        id: created.id,
        title: "Nowy tytuł",
        body: "Nowa treść.",
        revision: 2,
        createdAt: "2026-10-31T10:00:00.000Z",
        updatedAt: "2026-10-31T10:05:00.000Z",
        deckCount: 0,
        decks: [],
      });
      const after = (await query<{ request_hash: string }>("select request_hash from learning_app.source_materials where id = $1", [created.id]))[0]!;
      expect(after.request_hash).toBe(before.request_hash);
    });

    it("changes only the supplied field", async () => {
      const request = input();
      const created = await createSourceMaterial(services, request);

      const titleOnly = await updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "Sam tytuł" });
      expect(titleOnly).toMatchObject({ title: "Sam tytuł", body: request.body, revision: 2 });

      const bodyOnly = await updateSourceMaterial(services, created.id, { expectedRevision: 2, body: "Sama treść." });
      expect(bodyOnly).toMatchObject({ title: "Sam tytuł", body: "Sama treść.", revision: 3 });
    });

    it("rejects a mismatched expectedRevision as a conflict without changing anything", async () => {
      const created = await createSourceMaterial(services, input());
      await updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "Druga rewizja" });

      await expect(updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "Spóźniona edycja" })).rejects.toMatchObject({ code: "conflict" });
      await expect(updateSourceMaterial(services, created.id, { expectedRevision: 3, title: "Z przyszłości" })).rejects.toMatchObject({ code: "conflict" });

      expect(await getSourceMaterial(services, created.id)).toMatchObject({ title: "Druga rewizja", revision: 2 });
    });

    it("lets exactly one of two simultaneous edits of the same revision win", async () => {
      const created = await createSourceMaterial(services, input());

      const results = await Promise.allSettled([
        updateSourceMaterial(services, created.id, { expectedRevision: 1, body: "Edycja z pierwszej przeglądarki." }),
        updateSourceMaterial(services, created.id, { expectedRevision: 1, body: "Edycja z drugiej przeglądarki." }),
      ]);

      const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof updateSourceMaterial>>> => result.status === "fulfilled");
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ code: "conflict" });
      const stored = await getSourceMaterial(services, created.id);
      expect(stored.revision).toBe(2);
      expect(stored.body).toBe(fulfilled[0]!.value.body);
    });

    it("reports not_found for a missing source and validation for an empty patch", async () => {
      await expect(updateSourceMaterial(services, randomUUID(), { expectedRevision: 1, title: "X" })).rejects.toMatchObject({ code: "not_found" });

      const created = await createSourceMaterial(services, input());
      await expect(updateSourceMaterial(services, created.id, { expectedRevision: 1 } as never)).rejects.toBeDefined();
      await expect(updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "  " })).rejects.toBeDefined();
      expect((await getSourceMaterial(services, created.id)).revision).toBe(1);
    });
  });

  describe("deleteSourceMaterial", () => {
    it("removes the source and leaves its decks with a null reference", async () => {
      const created = await createSourceMaterial(services, input());
      const lessonDeck = await insertDeck({ title: "Lekcja ze źródła", kind: "lesson", sourceId: created.id, copiedRevision: 1 });
      const vocabularyDeck = await insertDeck({ title: "Słówka ze źródła", sourceId: created.id, copiedRevision: 1, archived: true });

      await deleteSourceMaterial(services, created.id);

      expect(await count("source_materials")).toBe(0);
      const decks = await query<{ id: string; source_material_id: string | null }>(
        "select id, source_material_id from learning_app.decks where id = any($1) order by title",
        [[lessonDeck, vocabularyDeck]],
      );
      expect(decks).toHaveLength(2);
      expect(decks.every((deck) => deck.source_material_id === null)).toBe(true);
      await expect(getSourceMaterial(services, created.id)).rejects.toMatchObject({ code: "not_found" });
    });

    it("does not touch decks of other sources and reports not_found for a missing source", async () => {
      const first = await createSourceMaterial(services, input());
      const second = await createSourceMaterial(services, input({ title: "Drugie źródło" }));
      const keptDeck = await insertDeck({ title: "Zestaw drugiego źródła", sourceId: second.id });

      await deleteSourceMaterial(services, first.id);
      await expect(deleteSourceMaterial(services, first.id)).rejects.toMatchObject({ code: "not_found" });
      await expect(deleteSourceMaterial(services, "nie-uuid")).rejects.toBeDefined();

      const rows = await query<{ source_material_id: string | null }>("select source_material_id from learning_app.decks where id = $1", [keptDeck]);
      expect(rows[0]!.source_material_id).toBe(second.id);
    });
  });

  describe("listSourceMaterials and getSourceMaterial", () => {
    it("lists sources by updatedAt descending, counting only non-archived decks", async () => {
      const older = await createSourceMaterial(services, input({ title: "Starsze" }));
      clock.advanceMs(60_000);
      const middle = await createSourceMaterial(services, input({ title: "Środkowe" }));
      clock.advanceMs(60_000);
      const newer = await createSourceMaterial(services, input({ title: "Nowsze" }));
      clock.advanceMs(60_000);
      // Edycja najstarszego przesuwa je na początek listy.
      await updateSourceMaterial(services, older.id, { expectedRevision: 1, body: "Zmieniona treść." });

      await insertDeck({ title: "A", sourceId: middle.id });
      await insertDeck({ title: "B", kind: "lesson", sourceId: middle.id });
      await insertDeck({ title: "C zarchiwizowany", sourceId: middle.id, archived: true });
      await insertDeck({ title: "D bez źródła", sourceId: null });

      const list = await listSourceMaterials(services);

      expect(list.map((source) => source.title)).toEqual(["Starsze", "Nowsze", "Środkowe"]);
      expect(list.map((source) => source.deckCount)).toEqual([0, 0, 2]);
      expect(list.map((source) => source.id)).toEqual([older.id, newer.id, middle.id]);
      expect(list[0]).toMatchObject({ revision: 2, updatedAt: "2026-10-31T10:03:00.000Z", createdAt: "2026-10-31T10:00:00.000Z" });
      expect(list[0]).not.toHaveProperty("body");
    });

    it("returns an empty list when there are no sources", async () => {
      expect(await listSourceMaterials(services)).toEqual([]);
    });

    it("returns the full text with decks, their kind, state and stale marker", async () => {
      const created = await createSourceMaterial(services, input({ body: "Pełny tekst źródła." }));
      await updateSourceMaterial(services, created.id, { expectedRevision: 1, title: "Po edycji" });

      const staleLesson = await insertDeck({ title: "Lekcja ze starej rewizji", kind: "lesson", sourceId: created.id, copiedRevision: 1, createdAt: "2026-10-31T08:00:00.000Z" });
      const currentDeck = await insertDeck({ title: "Zestaw z bieżącej rewizji", sourceId: created.id, copiedRevision: 2, createdAt: "2026-10-31T08:10:00.000Z" });
      const unknownRevision = await insertDeck({ title: "Bez rewizji", sourceId: created.id, copiedRevision: null, createdAt: "2026-10-31T08:20:00.000Z" });
      const archivedDeck = await insertDeck({ title: "Zarchiwizowany", sourceId: created.id, copiedRevision: 1, archived: true, createdAt: "2026-10-31T08:30:00.000Z" });
      await publishDeckDirectly(currentDeck);
      await insertDeck({ title: "Cudzy zestaw", sourceId: null });

      const source = await getSourceMaterial(services, created.id);

      expect(source).toMatchObject({
        id: created.id,
        title: "Po edycji",
        body: "Pełny tekst źródła.",
        revision: 2,
        deckCount: 3,
      });
      // Najnowsze zestawy pierwsze; zarchiwizowany jest widoczny, ale nie liczy się do deckCount.
      expect(source.decks).toEqual([
        { deckId: archivedDeck, title: "Zarchiwizowany", kind: "vocabulary", state: "archived", copiedRevision: 1, stale: true },
        { deckId: unknownRevision, title: "Bez rewizji", kind: "vocabulary", state: "draft", copiedRevision: null, stale: false },
        { deckId: currentDeck, title: "Zestaw z bieżącej rewizji", kind: "vocabulary", state: "published", copiedRevision: 2, stale: false },
        { deckId: staleLesson, title: "Lekcja ze starej rewizji", kind: "lesson", state: "draft", copiedRevision: 1, stale: true },
      ]);
    });

    it("reports an editable review version as the deck state", async () => {
      const created = await createSourceMaterial(services, input());
      const deckId = await insertDeck({ title: "W przeglądzie", sourceId: created.id });
      await pool.query(
        "insert into learning_app.deck_versions (id, deck_id, version_number, state, title) values ($1, $2, 1, 'review', 'v1')",
        [randomUUID(), deckId],
      );

      const source = await getSourceMaterial(services, created.id);

      expect(source.decks.map((deck) => deck.state)).toEqual(["review"]);
    });

    it("reports not_found for a missing source and rejects a malformed id", async () => {
      await expect(getSourceMaterial(services, randomUUID())).rejects.toMatchObject({ code: "not_found" });
      await expect(getSourceMaterial(services, "nie-uuid")).rejects.toBeDefined();
    });
  });

  describe("ograniczenia bazy", () => {
    async function insertRaw(overrides: Partial<{ title: string; body: string; revision: number; clientRequestId: string }> = {}): Promise<void> {
      await pool.query(
        `insert into learning_app.source_materials (id, client_request_id, request_hash, title, body, revision)
         values ($1, $2, 'hash', $3, $4, $5)`,
        [randomUUID(), overrides.clientRequestId ?? randomUUID(), overrides.title ?? "T", overrides.body ?? "B", overrides.revision ?? 1],
      );
    }

    it("enforces title and body length, positive revision and unique client request id", async () => {
      await expect(insertRaw({ title: "" })).rejects.toThrow(/source_materials_title_length/);
      await expect(insertRaw({ title: "a".repeat(121) })).rejects.toThrow(/source_materials_title_length/);
      await expect(insertRaw({ body: "" })).rejects.toThrow(/source_materials_body_length/);
      await expect(insertRaw({ body: "a".repeat(16_001) })).rejects.toThrow(/source_materials_body_length/);
      await expect(insertRaw({ revision: 0 })).rejects.toThrow(/source_materials_revision_positive/);

      const clientRequestId = randomUUID();
      await insertRaw({ clientRequestId });
      await expect(insertRaw({ clientRequestId })).rejects.toThrow(/source_materials_client_request_id_unique/);
    });

    it("rejects a deck reference to a missing source", async () => {
      await expect(insertDeck({ title: "Sierota", sourceId: randomUUID() })).rejects.toThrow(/decks_source_material_id_source_materials_id_fk/);
    });
  });

  describe("tworzenie lekcji ze źródła", () => {
    const CHAPTER_TEXT = [
      "Zagadnienie 1: Ubrania",
      "coat, boots, dress, skirt, t-shirt",
      "Zagadnienie 2: Pogoda",
      "It's raining. It's snowing. What's the weather like?",
    ].join("\n");
    const SCHOOL_TEXT = [
      "Zagadnienie 1: Fotosynteza",
      "Wyjaśnienie: Fotosynteza to proces, w którym roślina z wody i dwutlenku węgla, przy udziale światła, wytwarza cukry. Cukry są pokarmem rośliny.",
    ].join("\n");

    const chapterCommand = (sourceMaterialId: string, overrides: Partial<{ clientRequestId: string; topicTitlePl: string }> = {}) => ({
      subjectId: "english_chapter",
      topicTitlePl: "Unit 1",
      sourceMaterialId,
      poolSize: 40,
      clientRequestId: randomUUID(),
      ...overrides,
    });
    const schoolCommand = (sourceMaterialId: string, overrides: Partial<{ clientRequestId: string }> = {}) => ({
      subjectTitlePl: "Przyroda",
      topicTitlePl: "Materiał",
      sourceMaterialId,
      poolSize: 40,
      clientRequestId: randomUUID(),
      ...overrides,
    });

    async function seedSource(body = CHAPTER_TEXT, title = "Rozdział 4: Pogoda"): Promise<string> {
      return (await createSourceMaterial(services, { clientRequestId: randomUUID(), title, body })).id;
    }

    interface StoredLesson {
      deck: { source_material_id: string | null; source_material_revision: number | null };
      material: string;
      runMaterial: string;
    }

    async function storedLesson(deckId: string): Promise<StoredLesson> {
      const [deck] = await query<StoredLesson["deck"]>(
        "select source_material_id, source_material_revision from learning_app.decks where id = $1", [deckId],
      );
      const [version] = await query<{ lesson_context: { material: string } }>(
        "select lesson_context from learning_app.deck_versions where deck_id = $1", [deckId],
      );
      const [run] = await query<{ input: { material: string } }>(
        `select r.input from learning_app.generation_runs r
           join learning_app.deck_versions v on v.id = r.deck_version_id where v.deck_id = $1`, [deckId],
      );
      return { deck: deck!, material: version!.lesson_context.material, runMaterial: run!.input.material };
    }

    /** Czeka, aż zapytanie pasujące do wzorca stanie na blokadzie wiersza/tabeli innej transakcji. */
    async function waitUntilBlocked(pattern: RegExp, timeoutMs = 10_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      let waiting: string[] = [];
      while (Date.now() < deadline) {
        const rows = await query<{ query: string }>(
          "select query from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()",
        );
        if (rows.some((row) => pattern.test(row.query))) return;
        waiting = rows.map((row) => row.query);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`zapytanie ${String(pattern)} nie czeka na blokadzie; czekają: ${JSON.stringify(waiting)}`);
    }

    type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
    function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
      return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    }

    it("lekcja rozdziału: kopiuje tekst i rewizję źródła do kontekstu, runu i zestawu", async () => {
      const sourceId = await seedSource();
      await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body: `${CHAPTER_TEXT}\nIt's sunny.` });

      const { deckId } = await createLessonFromMaterial(services, chapterCommand(sourceId));

      const stored = await storedLesson(deckId);
      expect(stored.material).toBe(`${CHAPTER_TEXT}\nIt's sunny.`);
      expect(stored.runMaterial).toBe(stored.material);
      expect(stored.deck).toEqual({ source_material_id: sourceId, source_material_revision: 2 });
      expect((await readLessonDeck(services, deckId)).source).toEqual({
        id: sourceId, title: "Rozdział 4: Pogoda", copiedRevision: 2, currentRevision: 2,
      });
      const source = await getSourceMaterial(services, sourceId);
      expect(source.decks).toMatchObject([{ deckId, kind: "lesson", copiedRevision: 2, stale: false }]);
    });

    it("lekcja szkolna: kopiuje tekst i rewizję źródła, a nazwę przedmiotu bierze od rodzica", async () => {
      const sourceId = await seedSource(SCHOOL_TEXT, "Przyroda, dział 2");

      const { deckId } = await createSchoolLesson(services, schoolCommand(sourceId));

      const stored = await storedLesson(deckId);
      expect(stored.material).toBe(SCHOOL_TEXT);
      expect(stored.runMaterial).toBe(SCHOOL_TEXT);
      expect(stored.deck).toEqual({ source_material_id: sourceId, source_material_revision: 1 });
      const [version] = await query<{ lesson_context: { subjectId: string; subjectTitlePl: string } }>(
        "select lesson_context from learning_app.deck_versions where deck_id = $1", [deckId],
      );
      expect(version!.lesson_context).toMatchObject({ subjectId: "school", subjectTitlePl: "Przyroda" });
      expect((await readLessonDeck(services, deckId)).source).toMatchObject({ id: sourceId, copiedRevision: 1, currentRevision: 1 });
    });

    it("lekcja z wklejonym tekstem nie ma odnośnika do źródła ani pola source w DTO", async () => {
      const { deckId } = await createLessonFromMaterial(services, {
        subjectId: "english_chapter", topicTitlePl: "Unit 1", material: CHAPTER_TEXT, poolSize: 40, clientRequestId: randomUUID(),
      });

      expect((await storedLesson(deckId)).deck).toEqual({ source_material_id: null, source_material_revision: null });
      expect(await readLessonDeck(services, deckId)).not.toHaveProperty("source");
    });

    it("edycja źródła po utworzeniu nie zmienia materiału lekcji, a DTO pokazuje nowszą rewizję", async () => {
      const sourceId = await seedSource();
      const { deckId } = await createLessonFromMaterial(services, chapterCommand(sourceId));

      await updateSourceMaterial(services, sourceId, { expectedRevision: 1, title: "Po zmianie", body: "Zupełnie inny tekst." });
      await updateSourceMaterial(services, sourceId, { expectedRevision: 2, body: "I jeszcze inny." });

      const stored = await storedLesson(deckId);
      expect(stored.material).toBe(CHAPTER_TEXT);
      expect(stored.runMaterial).toBe(CHAPTER_TEXT);
      expect(stored.deck.source_material_revision).toBe(1);
      expect((await readLessonDeck(services, deckId)).source).toEqual({
        id: sourceId, title: "Po zmianie", copiedRevision: 1, currentRevision: 3,
      });
      expect((await getSourceMaterial(services, sourceId)).decks).toMatchObject([{ deckId, copiedRevision: 1, stale: true }]);
    });

    it("usunięcie źródła: DTO bez source, a generowanie i dogenerowanie używają kopii", async () => {
      const fakes = await fakeGeneration();
      try {
        const world = createServices({ db: testDatabase().db, clock, media: fakes.settings, generation: fakes.deps });
        const sourceId = await seedSource();
        const { runId, deckId } = await createLessonFromMaterial(world, chapterCommand(sourceId));
        await updateSourceMaterial(world, sourceId, { expectedRevision: 1, body: "Tekst po edycji, którego lekcja nie ma znać." });
        await deleteSourceMaterial(world, sourceId);

        expect(await readLessonDeck(world, deckId)).not.toHaveProperty("source");
        expect((await storedLesson(deckId)).deck.source_material_id).toBeNull();

        await executeLessonGeneration(world, runId);
        expect((await readGeneration(world, runId)).state).toBe("succeeded");
        expect(fakes.llm.objectiveRequests.map((request) => request.material)).toEqual([CHAPTER_TEXT]);
        const draft = (await readLessonDeck(world, deckId)).draft!;
        expect(draft.exercises.length).toBeGreaterThan(0);

        const regeneration = await regenerateObjective(world, {
          deckId,
          objectiveId: draft.objectiveIds[0]!,
          count: 4,
          expectedEditNumber: draft.editNumber,
          clientRequestId: randomUUID(),
        });
        await executeLessonGeneration(world, regeneration.runId);
        expect((await readGeneration(world, regeneration.runId)).state).toBe("succeeded");
        expect(fakes.llm.lessonRequests.at(-1)!.material).toBe(CHAPTER_TEXT);
        expect(await readLessonDeck(world, deckId)).not.toHaveProperty("source");
      } finally {
        await fakes.dispose();
      }
    });

    it("nieistniejące źródło kończy się not_found i niczego nie zapisuje", async () => {
      const missing = randomUUID();

      await expect(createLessonFromMaterial(services, chapterCommand(missing))).rejects.toMatchObject({ code: "not_found" });
      await expect(createSchoolLesson(services, schoolCommand(missing))).rejects.toMatchObject({ code: "not_found" });

      expect(await count("decks")).toBe(0);
      expect(await count("deck_versions")).toBe(0);
      expect(await count("generation_runs")).toBe(0);
    });

    it("oba źródła tekstu albo żadne to błąd walidacji, bez zapisu", async () => {
      const sourceId = await seedSource();
      const base = { subjectId: "english_chapter", topicTitlePl: "Unit 1", poolSize: 40, clientRequestId: randomUUID() };

      await expect(createLessonFromMaterial(services, { ...base, material: CHAPTER_TEXT, sourceMaterialId: sourceId })).rejects.toMatchObject({ name: "ZodError" });
      await expect(createLessonFromMaterial(services, base as never)).rejects.toMatchObject({ name: "ZodError" });
      await expect(createSchoolLesson(services, { ...schoolCommand(sourceId), material: SCHOOL_TEXT })).rejects.toMatchObject({ name: "ZodError" });

      expect(await count("decks")).toBe(0);
      expect(await count("generation_runs")).toBe(0);
    });

    it("ponowienie z tym samym clientRequestId zwraca ten sam zestaw, także po usunięciu źródła", async () => {
      const sourceId = await seedSource();
      const request = chapterCommand(sourceId);

      const first = await createLessonFromMaterial(services, request);
      await expect(createLessonFromMaterial(services, request)).resolves.toEqual(first);
      await deleteSourceMaterial(services, sourceId);
      await expect(createLessonFromMaterial(services, request)).resolves.toEqual(first);

      expect(await count("decks")).toBe(1);
      expect(await count("generation_runs")).toBe(1);
    });

    it("równoległe żądania z tym samym clientRequestId dają jeden zestaw", async () => {
      const sourceId = await seedSource();
      const request = chapterCommand(sourceId);

      const [a, b] = await Promise.all([createLessonFromMaterial(services, request), createLessonFromMaterial(services, request)]);

      expect(a).toEqual(b);
      expect(await count("decks")).toBe(1);
    });

    describe("usunięcie źródła w trakcie tworzenia", () => {
      it("usunięcie czeka na tworzenie i potem zeruje odnośnik, a lekcja zostaje z kopią tekstu", async () => {
        const sourceId = await seedSource();
        // Blokada tabeli wersji zatrzymuje tworzenie PO zablokowaniu źródła: wstawienie
        // zestawu (klucz obcy do wersji) czeka, a źródło jest już zablokowane `FOR KEY SHARE`.
        const blocker = await pool.connect();
        try {
          await blocker.query("begin");
          await blocker.query("lock table learning_app.deck_versions in access exclusive mode");
          const creating = settle(createLessonFromMaterial(services, chapterCommand(sourceId)));
          await waitUntilBlocked(/insert into "learning_app"\."decks"/i);

          const deleting = settle(deleteSourceMaterial(services, sourceId));
          await waitUntilBlocked(/delete from "learning_app"\."source_materials"/i);
          // Źródło wciąż istnieje: usuwanie czeka na blokadę trzymaną przez tworzenie.
          expect(await count("source_materials")).toBe(1);

          await blocker.query("commit");
          const created = await creating;
          expect(await deleting).toEqual({ ok: true, value: undefined });

          expect(created.ok).toBe(true);
          const { deckId } = (created as { ok: true; value: { deckId: string } }).value;
          const stored = await storedLesson(deckId);
          expect(stored.material).toBe(CHAPTER_TEXT);
          expect(stored.runMaterial).toBe(CHAPTER_TEXT);
          expect(stored.deck.source_material_id).toBeNull();
          expect(await count("source_materials")).toBe(0);
          expect(await readLessonDeck(services, deckId)).not.toHaveProperty("source");
        } finally {
          await blocker.query("rollback").catch(() => undefined);
          blocker.release();
        }
      });

      it("tworzenie czekające na trwające usunięcie kończy się not_found, nie błędem klucza obcego", async () => {
        const sourceId = await seedSource();
        const deleter = await pool.connect();
        try {
          await deleter.query("begin");
          await deleter.query("delete from learning_app.source_materials where id = $1", [sourceId]);
          const creating = settle(createLessonFromMaterial(services, chapterCommand(sourceId)));
          await waitUntilBlocked(/for key share/i);

          await deleter.query("commit");
          const created = await creating;

          expect(created).toMatchObject({ ok: false, error: { code: "not_found" } });
          expect(await count("decks")).toBe(0);
          expect(await count("generation_runs")).toBe(0);
        } finally {
          await deleter.query("rollback").catch(() => undefined);
          deleter.release();
        }
      });

      it("tworzenie czekające na trwającą edycję kopiuje nową treść razem z nową rewizją", async () => {
        const sourceId = await seedSource();
        const editor = await pool.connect();
        try {
          await editor.query("begin");
          // Tak samo jak updateSourceMaterial: najpierw FOR UPDATE, potem zapis.
          await editor.query("select id from learning_app.source_materials where id = $1 for update", [sourceId]);
          await editor.query("update learning_app.source_materials set body = $2, revision = 2 where id = $1", [sourceId, "Nowa treść po edycji."]);
          const creating = settle(createSchoolLesson(services, schoolCommand(sourceId)));
          await waitUntilBlocked(/for key share/i);

          await editor.query("commit");
          const created = await creating;

          expect(created.ok).toBe(true);
          const { deckId } = (created as { ok: true; value: { deckId: string } }).value;
          const stored = await storedLesson(deckId);
          expect(stored.material).toBe("Nowa treść po edycji.");
          expect(stored.deck).toEqual({ source_material_id: sourceId, source_material_revision: 2 });
        } finally {
          await editor.query("rollback").catch(() => undefined);
          editor.release();
        }
      });

      it("wyścig tworzenia z usunięciem daje zawsze not_found albo zestaw z kopią, nigdy innego błędu", async () => {
        const outcomes = { created: 0, notFound: 0 };
        for (let round = 0; round < 12; round += 1) {
          const sourceId = await seedSource(`${CHAPTER_TEXT}\nRunda ${round}.`, `Źródło ${round}`);
          const [created, deleted] = await Promise.all([
            settle(createLessonFromMaterial(services, chapterCommand(sourceId))),
            settle(deleteSourceMaterial(services, sourceId)),
          ]);

          expect(deleted.ok, `usunięcie w rundzie ${round}`).toBe(true);
          if (created.ok) {
            outcomes.created += 1;
            const stored = await storedLesson(created.value.deckId);
            expect(stored.material).toBe(`${CHAPTER_TEXT}\nRunda ${round}.`);
            expect(stored.deck.source_material_id).toBeNull();
          } else {
            outcomes.notFound += 1;
            expect(created.error, `tworzenie w rundzie ${round}`).toMatchObject({ code: "not_found" });
          }
        }
        expect(outcomes.created + outcomes.notFound).toBe(12);
        expect(await count("source_materials")).toBe(0);
        expect(await count("decks")).toBe(outcomes.created);
      });
    });
  });
});
