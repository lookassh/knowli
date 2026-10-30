import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSourceMaterial,
  deleteSourceMaterial,
  getSourceMaterial,
  listSourceMaterials,
  updateSourceMaterial,
  type Services,
} from "@learning/server";
import { buildTestServices, ManualClock, testDatabase } from "./helpers";

/**
 * Źródła (materiał źródłowy rodzica) na PostgreSQL (design 2026-10-30, §3):
 * idempotentne tworzenie, kontrola rewizji przy edycji, usunięcie z odnośnikiem
 * zestawu ustawionym na null oraz liczniki i znacznik „stale” w odczycie.
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
});
