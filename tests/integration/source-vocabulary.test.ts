import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSourceMaterial,
  deleteSourceMaterial,
  enqueueDeckGeneration,
  getSourceMaterial,
  readDeck,
  readGeneration,
  updateSourceMaterial,
  type Services,
} from "@learning/server";
import type { GenerationCommand } from "@learning/contracts";
import { markRunSucceeded } from "../../packages/server/src/modules/materials/generation-runs";
import { buildTestServices, ManualClock, testDatabase } from "./helpers";

/**
 * Słówka ze źródła (design 2026-10-30 „Angielski — rozdział”, §6.2) na
 * PostgreSQL: tworzenie zestawu słówek z kopią tekstu zapisanego źródła
 * (pochodzenie w `decks`, tekst w niezmiennym inpucie runu), kontrola rewizji
 * treści z podglądu rodzica, idempotentne ponowienie po edycji i usunięciu
 * źródła, odnośnik `source` w `DeckDto` oraz liczba odrzuceń w runie
 * (`rejected_count`, `GenerationDto.rejectedCount`). Samo generowanie z tekstu
 * (worker, prompt, walidacja per element) dopisuje Etap 4, Task 3.
 * Teksty są fikcyjne — materiał z podręcznika nie trafia do repozytorium.
 */

const { pool } = testDatabase();

afterAll(async () => {
  await pool.end();
});

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function count(table: string): Promise<number> {
  const rows = await query<{ count: number }>(`select count(*)::int as count from learning_app.${table}`);
  return rows[0]!.count;
}

const CHAPTER_TEXT = [
  "What's the weather like? It's sunny. It's raining.",
  "I'm wearing a coat and boots. She is wearing a pink T-shirt.",
].join("\n");
const SOURCE_TITLE = "Rozdział 4: Pogoda i ubrania";
const SOURCE_CHANGED = { code: "conflict", details: { reason: "source_changed" } };

interface StoredVocabularyDeck {
  deck: { title: string; kind: string; source_material_id: string | null; source_material_revision: number | null };
  version: {
    id: string;
    title: string;
    state: string;
    source_locale: string;
    target_locale: string;
    vocabulary_format: string;
    generation_prompt: string | null;
    lesson_context: unknown;
  };
  run: { id: string; kind: string; state: string; dedupe_key: string; input: Record<string, unknown>; rejected_count: number | null };
}

async function storedVocabularyDeck(deckId: string): Promise<StoredVocabularyDeck> {
  const [deck] = await query<StoredVocabularyDeck["deck"]>(
    "select title, kind, source_material_id, source_material_revision from learning_app.decks where id = $1", [deckId],
  );
  const [version] = await query<StoredVocabularyDeck["version"]>(
    `select id, title, state, source_locale, target_locale, vocabulary_format, generation_prompt, lesson_context
       from learning_app.deck_versions where deck_id = $1`, [deckId],
  );
  const [run] = await query<StoredVocabularyDeck["run"]>(
    `select r.id, r.kind, r.state, r.dedupe_key, r.input, r.rejected_count from learning_app.generation_runs r
       join learning_app.deck_versions v on v.id = r.deck_version_id where v.deck_id = $1`, [deckId],
  );
  return { deck: deck!, version: version!, run: run! };
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

describe("słówka ze źródła — tworzenie zestawu (integracja)", () => {
  let services: Services;
  let clock: ManualClock;

  beforeEach(async () => {
    await pool.query("truncate learning_app.generation_runs, learning_app.decks, learning_app.source_materials cascade");
    ({ services, clock } = buildTestServices("2026-10-31T10:00:00.000Z"));
  });

  async function seedSource(body = CHAPTER_TEXT, title = SOURCE_TITLE): Promise<string> {
    return (await createSourceMaterial(services, { clientRequestId: randomUUID(), title, body })).id;
  }

  // `expectedSourceRevision` — rewizja treści z podglądu rodzica; świeże źródło ma 1.
  const sourceCommand = (sourceMaterialId: string, overrides: Partial<GenerationCommand> = {}): GenerationCommand => ({
    sourceMaterialId,
    expectedSourceRevision: 1,
    idempotencyKey: `source-vocabulary-${randomUUID()}`,
    ...overrides,
  });

  it("kopiuje bieżący tekst i rewizję treści źródła do zestawu i runu; tytuł z tytułu źródła", async () => {
    const sourceId = await seedSource();
    const body = `${CHAPTER_TEXT}\nIt's snowing.`;
    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body });

    // podgląd rodzica pokazał rewizję treści 2 — to ją serwer kopiuje
    const command = sourceCommand(sourceId, { expectedSourceRevision: 2, instruction: "tylko pogoda", maxItems: 20, vocabularyFormat: "picture" });
    const { runId, deckId } = await enqueueDeckGeneration(services, command);

    const stored = await storedVocabularyDeck(deckId);
    expect(stored.deck).toEqual({ title: SOURCE_TITLE, kind: "vocabulary", source_material_id: sourceId, source_material_revision: 2 });
    expect(stored.version).toMatchObject({
      title: SOURCE_TITLE,
      state: "draft",
      source_locale: "pl-PL",
      target_locale: "en-GB",
      vocabulary_format: "picture",
      generation_prompt: null,
      lesson_context: null,
    });
    expect(stored.run).toMatchObject({ id: runId, kind: "deck", state: "queued", dedupe_key: `deck:${command.idempotencyKey}`, rejected_count: null });
    // niezmienny input runu: kopia tekstu, bez `prompt`; para języków stała
    expect(stored.run.input).toEqual({
      mode: "material",
      material: body,
      instruction: "tylko pogoda",
      deckId,
      deckVersionId: stored.version.id,
      locales: { source: "pl-PL", target: "en-GB" },
      maxItems: 20,
      vocabularyFormat: "picture",
    });
    expect(await readGeneration(services, runId)).toEqual({
      id: runId,
      deckId,
      deckVersionId: stored.version.id,
      state: "queued",
      attempts: 0,
      errorCode: null,
      rejectedCount: null,
    });
  });

  it("podany tytuł wygrywa z tytułem źródła; domyślnie 50 pozycji i format standard", async () => {
    const sourceId = await seedSource();

    const { deckId } = await enqueueDeckGeneration(services, sourceCommand(sourceId, { title: "Pogoda — słówka" }));

    const stored = await storedVocabularyDeck(deckId);
    expect(stored.deck.title).toBe("Pogoda — słówka");
    expect(stored.version.title).toBe("Pogoda — słówka");
    expect(stored.version.vocabulary_format).toBe("standard");
    expect(stored.run.input).toMatchObject({ mode: "material", material: CHAPTER_TEXT, maxItems: 50, vocabularyFormat: "standard" });
    expect(stored.run.input).not.toHaveProperty("instruction");
    expect(stored.run.input).not.toHaveProperty("prompt");
  });

  it("zawężenie jest przycinane, a samo białe znaki go nie dają", async () => {
    const sourceId = await seedSource();

    const trimmed = await enqueueDeckGeneration(services, sourceCommand(sourceId, { instruction: "  tylko pogoda \n" }));
    const blank = await enqueueDeckGeneration(services, sourceCommand(sourceId, { instruction: " \n\t " }));

    expect((await storedVocabularyDeck(trimmed.deckId)).run.input).toMatchObject({ instruction: "tylko pogoda" });
    expect((await storedVocabularyDeck(blank.deckId)).run.input).not.toHaveProperty("instruction");
  });

  it("podgląd sprzed zmiany tekstu źródła: konflikt source_changed i żadnego zapisu; rewizja z przyszłości też", async () => {
    const sourceId = await seedSource();
    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body: "Tekst zmieniony w innym oknie." });

    await expect(enqueueDeckGeneration(services, sourceCommand(sourceId))).rejects.toMatchObject(SOURCE_CHANGED);
    await expect(enqueueDeckGeneration(services, sourceCommand(sourceId, { expectedSourceRevision: 3 }))).rejects.toMatchObject(SOURCE_CHANGED);

    expect(await count("decks")).toBe(0);
    expect(await count("deck_versions")).toBe(0);
    expect(await count("generation_runs")).toBe(0);
  });

  it("zmiana samego tytułu źródła nie blokuje tworzenia, a zestaw dostaje nowy tytuł", async () => {
    const sourceId = await seedSource();
    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, title: "Nowy tytuł rozdziału" });

    const { deckId } = await enqueueDeckGeneration(services, sourceCommand(sourceId));

    expect((await storedVocabularyDeck(deckId)).deck).toMatchObject({ title: "Nowy tytuł rozdziału", source_material_revision: 1 });
  });

  it("nieistniejące źródło kończy się not_found bez zapisu", async () => {
    await expect(enqueueDeckGeneration(services, sourceCommand(randomUUID()))).rejects.toMatchObject({ code: "not_found" });

    expect(await count("decks")).toBe(0);
    expect(await count("generation_runs")).toBe(0);
  });

  it("odrzuca polecenia łączące tryby albo nadpisujące parę języków, bez zapisu", async () => {
    const sourceId = await seedSource();

    await expect(enqueueDeckGeneration(services, sourceCommand(sourceId, { prompt: "pogoda" }))).rejects.toMatchObject({ name: "ZodError" });
    await expect(enqueueDeckGeneration(services, sourceCommand(sourceId, { locales: { source: "pl-PL", target: "de-DE" } })))
      .rejects.toMatchObject({ name: "ZodError" });
    await expect(enqueueDeckGeneration(services, sourceCommand(sourceId, { expectedSourceRevision: undefined })))
      .rejects.toMatchObject({ name: "ZodError" });
    await expect(enqueueDeckGeneration(services, { prompt: "pogoda", instruction: "tylko deszcz", idempotencyKey: "prompt-with-instruction" }))
      .rejects.toMatchObject({ name: "ZodError" });

    expect(await count("decks")).toBe(0);
    expect(await count("generation_runs")).toBe(0);
  });

  it("ponowienie z tym samym kluczem zwraca ten sam zestaw, także po edycji i usunięciu źródła", async () => {
    const sourceId = await seedSource();
    const request = sourceCommand(sourceId);

    const first = await enqueueDeckGeneration(services, request);
    await expect(enqueueDeckGeneration(services, request)).resolves.toEqual(first);
    // klucz idempotencji jest sprawdzany przed odczytem źródła: nowsza rewizja treści nie daje 409
    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body: "Tekst po utworzeniu zestawu." });
    await expect(enqueueDeckGeneration(services, request)).resolves.toEqual(first);
    expect((await storedVocabularyDeck(first.deckId)).run.input).toMatchObject({ material: CHAPTER_TEXT });
    await deleteSourceMaterial(services, sourceId);
    await expect(enqueueDeckGeneration(services, request)).resolves.toEqual(first);

    expect(await count("decks")).toBe(1);
    expect(await count("generation_runs")).toBe(1);
  });

  it("równoległe żądania z tym samym kluczem dają jeden zestaw", async () => {
    const sourceId = await seedSource();
    const request = sourceCommand(sourceId);

    const [a, b] = await Promise.all([enqueueDeckGeneration(services, request), enqueueDeckGeneration(services, request)]);

    expect(a).toEqual(b);
    expect(await count("decks")).toBe(1);
    expect(await count("generation_runs")).toBe(1);
  });

  // Niepewny zapis ponowiony po usunięciu lub edycji źródła (plan Etapu 4, Review Focus 4):
  // ponowienie zatrzymane między sprawdzeniem klucza idempotencji (jeszcze bez runu) a własną
  // transakcją; w tym czasie pierwsze żądanie zapisuje zestaw, a źródło znika albo dostaje nową
  // rewizję treści, zanim ponowienie je zablokuje — jego odczyt źródła kończy się not_found albo
  // konfliktem, a odpowiedzią jest zestaw pierwszego żądania.
  it.each([
    ["równoległym usunięciu", (sourceId: string) => deleteSourceMaterial(services, sourceId)],
    ["równoległej zmianie tekstu", async (sourceId: string) => {
      await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body: "Tekst zmieniony po pierwszym żądaniu." });
    }],
  ] as const)("ponowienie po %s źródła zwraca zestaw zatwierdzony przez pierwsze żądanie", async (_label, changeSource) => {
    const sourceId = await seedSource();
    const request = sourceCommand(sourceId);
    let markWaiting!: () => void;
    const waiting = new Promise<void>((resolve) => { markWaiting = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const db = services.db;
    const gatedDb = new Proxy(db, {
      get(target, property) {
        if (property === "transaction") {
          return async (...args: unknown[]) => {
            markWaiting();
            await gate;
            return (target.transaction as (...transactionArgs: unknown[]) => Promise<unknown>).apply(target, args);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (value as (...valueArgs: unknown[]) => unknown).bind(target) : value;
      },
    });
    let retry: Promise<Outcome<Awaited<ReturnType<typeof enqueueDeckGeneration>>>> | undefined;
    try {
      retry = settle(enqueueDeckGeneration({ ...services, db: gatedDb }, request));
      await waiting;
      const first = await enqueueDeckGeneration(services, request);
      await changeSource(sourceId);
      release();

      expect(await retry).toEqual({ ok: true, value: first });
      expect(await count("decks")).toBe(1);
      expect(await count("generation_runs")).toBe(1);
      expect((await storedVocabularyDeck(first.deckId)).run.input).toMatchObject({ material: CHAPTER_TEXT });
    } finally {
      release();
      await Promise.allSettled([retry]);
    }
  });

  it("readDeck pokazuje źródło z bieżącą rewizją treści i tytułem, a po usunięciu źródła pole znika", async () => {
    const sourceId = await seedSource();
    const { deckId } = await enqueueDeckGeneration(services, sourceCommand(sourceId));

    expect((await readDeck(services, deckId)).source).toEqual({ id: sourceId, title: SOURCE_TITLE, copiedRevision: 1, currentRevision: 1 });

    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, title: "Pogoda (poprawiony)", body: "Nowy tekst rozdziału." });
    expect((await readDeck(services, deckId)).source).toEqual({ id: sourceId, title: "Pogoda (poprawiony)", copiedRevision: 1, currentRevision: 2 });
    // kopia w runie się nie zmienia
    expect((await storedVocabularyDeck(deckId)).run.input).toMatchObject({ material: CHAPTER_TEXT });

    await deleteSourceMaterial(services, sourceId);
    const afterDelete = await readDeck(services, deckId);
    expect(afterDelete).not.toHaveProperty("source");
    expect((await storedVocabularyDeck(deckId)).deck).toMatchObject({ source_material_id: null, source_material_revision: 1 });
    expect(afterDelete.generation).toMatchObject({ state: "queued", rejectedCount: null });
  });

  it("strona źródła wymienia zestaw słówek ze stanem i znacznikiem nieaktualności", async () => {
    const sourceId = await seedSource();
    const { deckId } = await enqueueDeckGeneration(services, sourceCommand(sourceId, { title: "Słówka z rozdziału" }));

    expect((await getSourceMaterial(services, sourceId)).decks).toEqual([
      { deckId, title: "Słówka z rozdziału", kind: "vocabulary", state: "draft", copiedRevision: 1, stale: false },
    ]);
    expect((await getSourceMaterial(services, sourceId)).deckCount).toBe(1);

    await updateSourceMaterial(services, sourceId, { expectedRevision: 1, body: "Tekst po zmianie." });
    expect((await getSourceMaterial(services, sourceId)).decks).toEqual([
      expect.objectContaining({ deckId, kind: "vocabulary", copiedRevision: 1, stale: true }),
    ]);
  });

  it("zestaw z opisu nie ma źródła, a jego run — liczby odrzuceń", async () => {
    const { runId, deckId } = await enqueueDeckGeneration(services, {
      prompt: "Dni tygodnia po angielsku dla 8-letniego dziecka.",
      idempotencyKey: "description-mode-1",
    });

    const stored = await storedVocabularyDeck(deckId);
    expect(stored.deck).toMatchObject({ source_material_id: null, source_material_revision: null });
    expect(stored.version.generation_prompt).toBe("Dni tygodnia po angielsku dla 8-letniego dziecka.");
    expect(stored.run.input).not.toHaveProperty("mode");
    expect(stored.run.input).toMatchObject({ prompt: "Dni tygodnia po angielsku dla 8-letniego dziecka." });
    expect((await readGeneration(services, runId)).rejectedCount).toBeNull();
    const deck = await readDeck(services, deckId);
    expect(deck).not.toHaveProperty("source");
    expect(deck.generation).toMatchObject({ id: runId, rejectedCount: null });
  });

  it("markRunSucceeded zapisuje sukces z liczbą odrzuceń widoczną w GenerationDto", async () => {
    const sourceId = await seedSource();
    const { runId, deckId } = await enqueueDeckGeneration(services, sourceCommand(sourceId));
    await pool.query("update learning_app.generation_runs set state = 'running', attempts = 1, error_code = 'stale' where id = $1", [runId]);
    clock.advanceMs(5 * 60_000);

    await services.db.transaction((tx) => markRunSucceeded(tx, services.clock, runId, 3));

    expect(await readGeneration(services, runId)).toMatchObject({ state: "succeeded", attempts: 1, errorCode: null, rejectedCount: 3 });
    expect((await readDeck(services, deckId)).generation).toMatchObject({ id: runId, state: "succeeded", rejectedCount: 3 });
    const [row] = await query<{ finished_at: Date; next_attempt_at: Date | null }>(
      "select finished_at, next_attempt_at from learning_app.generation_runs where id = $1", [runId],
    );
    expect(row!.finished_at.toISOString()).toBe("2026-10-31T10:05:00.000Z");
    expect(row!.next_attempt_at).toBeNull();

    // tryb opisu oznacza sukces bez liczby odrzuceń
    await markRunSucceeded(services.db, services.clock, runId, null);
    expect((await readGeneration(services, runId)).rejectedCount).toBeNull();
  });

  it("kolumna rejected_count przyjmuje null i zero, a CHECK odrzuca liczbę ujemną", async () => {
    const sourceId = await seedSource();
    const { runId } = await enqueueDeckGeneration(services, sourceCommand(sourceId));

    await pool.query("update learning_app.generation_runs set rejected_count = 0 where id = $1", [runId]);
    expect((await readGeneration(services, runId)).rejectedCount).toBe(0);
    await expect(pool.query("update learning_app.generation_runs set rejected_count = -1 where id = $1", [runId]))
      .rejects.toMatchObject({ code: "23514", constraint: "generation_runs_rejected_count_nonnegative" });
    expect((await readGeneration(services, runId)).rejectedCount).toBe(0);
  });
});
