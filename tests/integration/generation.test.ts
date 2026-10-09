import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  createServices,
  editDraft,
  enqueueDeckGeneration,
  executeGeneration,
  readGeneration,
  retryGeneration,
  runDueGenerationWork,
  type Services,
} from "@learning/server";
import { countRows, testDatabase, testDatabaseUrl, truncateCoreTables } from "./helpers";
import { ManualClock } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

function generationServices(fakes: FakeGeneration, clock = new ManualClock()): Services {
  const { db } = testDatabase();
  return createServices({ db, clock, media: fakes.settings, generation: fakes.deps });
}

const COMMAND = {
  prompt: "Dni tygodnia po angielsku dla 8-letniego dziecka, proste słowa.",
  idempotencyKey: "generation-key-1",
};

describe("trwałe generowanie zestawu (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  afterEach(async () => {
    for (const dispose of disposers.splice(0)) {
      await dispose();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("powtórzone żądanie o tym samym kluczu idempotencji nie tworzy drugiego zestawu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    const first = await enqueueDeckGeneration(services, COMMAND);
    const second = await enqueueDeckGeneration(services, COMMAND);

    expect(second).toEqual(first);
    expect(first.runId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.deckId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await countRows("decks")).toBe(1);
    expect(await countRows("generation_runs")).toBe(1);

    const dto = await readGeneration(services, first.runId);
    expect(dto.state).toBe("queued");
    expect(dto.deckId).toBe(first.deckId);
    expect(dto.deckVersionId).toBeTruthy();
  });

  it("zapisuje dane liczby z wyniku LLM po walidacji kontraktu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({
      items: [{
        source: "jedenascie",
        target: "Eleven",
        acceptedAnswers: [],
        visualType: "number",
        visualData: { count: 11 },
      }],
    });
    const { runId } = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "visual-data-1" });
    await executeGeneration(services, runId);

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("succeeded");
    const [revision] = await query<{ payload: { visualType: string; visualData: { count: number } } }>(
      "select payload from learning_app.item_revisions where deck_version_id = $1",
      [dto.deckVersionId!],
    );
    expect(revision!.payload).toMatchObject({ visualType: "number", visualData: { count: 11 } });
  });

  it("odrzuca wygenerowaną pozycję dnia tygodnia sprzeczną ze słowem", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({
      items: [{
        source: "poniedziałek",
        target: "Monday",
        acceptedAnswers: [],
        visualType: "sequence",
        visualData: { position: 2, total: 7, sequenceStart: "Monday" },
      }],
    });
    const { runId } = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "wrong-weekday-sequence-1" });
    await executeGeneration(services, runId);

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("failed");
    expect(dto.errorCode).toBe("validation");
  });

  it("niepoprawny wynik LLM kończy run porażką walidacji i nie zmienia szkicu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({ items: [{ source: "czwartek", target: "", acceptedAnswers: [] }] });
    const broken = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "broken-json-1" });
    await executeGeneration(services, broken.runId);

    let dto = await readGeneration(services, broken.runId);
    expect(dto.state).toBe("failed");
    expect(dto.errorCode).toBe("validation");
    expect(fakes.llm.requests).toHaveLength(1);

    // duplikaty celu również są porażką walidacji, bez ponawiania
    fakes.llm.queue({
      items: [
        { source: "czwartek", target: "Thursday", acceptedAnswers: [], visualType: "none" },
        { source: "czwartek", target: "Thursday", acceptedAnswers: [], visualType: "none" },
      ],
    });
    const dupes = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "duplication-1" });
    await executeGeneration(services, dupes.runId);
    dto = await readGeneration(services, dupes.runId);
    expect(dto.state).toBe("failed");
    expect(dto.errorCode).toBe("validation");

    for (const runId of [broken.runId, dupes.runId]) {
      const versionId = (await readGeneration(services, runId)).deckVersionId!;
      const version = (
        await query<{ state: string; edit_number: number }>(
          "select state, edit_number from learning_app.deck_versions where id = $1",
          [versionId],
        )
      )[0]!;
      expect(version.state).toBe("draft");
      const items = await query<{ count: number }>(
        "select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1",
        [versionId],
      );
      expect(items[0]!.count).toBe(0);
    }
  });

  it("wykonanie generacji zapisuje elementy, przechodzi w review i zleca media", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({
      items: [
        { source: "czwartek", target: "Thursday", acceptedAnswers: [], visualType: "image" },
        { source: "piątek", target: "Friday", acceptedAnswers: [], visualType: "image" },
      ],
    });
    const { runId, deckId } = await enqueueDeckGeneration(services, COMMAND);
    await executeGeneration(services, runId);

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("succeeded");
    expect(dto.attempts).toBe(1);
    expect(dto.errorCode).toBeNull();

    const version = (
      await query<{ state: string; generation_prompt: string }>(
        "select state, generation_prompt from learning_app.deck_versions where id = $1",
        [dto.deckVersionId!],
      )
    )[0]!;
    expect(version.state).toBe("review");
    expect(version.generation_prompt).toBe(COMMAND.prompt);

    const items = await query<{ count: number; deck_id: string }>(
      "select count(*)::int as count, min(deck_id::text) as deck_id from learning_app.item_revisions where deck_version_id = $1",
      [dto.deckVersionId!],
    );
    expect(items[0]!.count).toBe(2);
    expect(items[0]!.deck_id).toBe(deckId);

    // 2×TTS + 2×ilustracja: zasoby pending z runami kolejkowanymi w tej samej transakcji
    expect(await countRows("media_assets")).toBe(4);
    expect(await countRows("generation_runs")).toBe(5);
    const pendingAssets = await query<{ state: string }>("select state from learning_app.media_assets");
    expect(pendingAssets.every((a) => a.state === "pending")).toBe(true);
  });

  it("wynik generacji ze starym edit_number nie nadpisuje zmienionego szkicu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({
      items: [{ source: "sobota", target: "Saturday", acceptedAnswers: [], visualType: "none" }],
    });
    const { runId } = await enqueueDeckGeneration(services, COMMAND);
    const deckVersionId = (await readGeneration(services, runId)).deckVersionId!;

    // rodzic edytuje pusty szkic, zanim worker zapisze wynik LLM
    await editDraft(services, deckVersionId, {
      items: [
        {
          source: "niedziela",
          target: "Sunday",
          acceptedAnswers: [],
          locales: { source: "pl-PL", target: "en-GB" },
          visualType: "none",
        },
      ],
      expectedEditNumber: 1,
    });

    await executeGeneration(services, runId);

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("superseded");

    const version = (
      await query<{ state: string; edit_number: number }>(
        "select state, edit_number from learning_app.deck_versions where id = $1",
        [deckVersionId],
      )
    )[0]!;
    expect(version.state).toBe("draft");
    expect(version.edit_number).toBe(2);

    const targets = await query<{ payload: { target: string } }>(
      "select payload from learning_app.item_revisions where deck_version_id = $1",
      [deckVersionId],
    );
    expect(targets.map((t) => t.payload.target)).toEqual(["Sunday"]);
  });

  it("maksymalnie trzy automatyczne próby; ręczne ponowienie przywraca zadanie", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({ error: "llm timeout", retryable: true });
    const { runId } = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "flaky-key-1" });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await executeGeneration(services, runId);
      const dto = await readGeneration(services, runId);
      expect(dto.state).toBe("queued");
      expect(dto.attempts).toBe(attempt);
    }

    // trzecia, ostatnia automatyczna próba wyczerpuje budżet
    await executeGeneration(services, runId);
    const exhausted = await readGeneration(services, runId);
    expect(exhausted.state).toBe("failed");
    expect(exhausted.errorCode).toBe("attempts_exhausted");
    expect(fakes.llm.requests).toHaveLength(3);

    const retried = await retryGeneration(services, runId);
    expect(retried.runId).toBe(runId);
    fakes.llm.queue({
      items: [{ source: "czwartek", target: "Thursday", acceptedAnswers: [], visualType: "none" }],
    });
    await executeGeneration(services, runId);
    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("succeeded");
    expect(dto.attempts).toBe(1);
  });

  it("restart procesu workera nie gubi zleconych zadań", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = generationServices(fakes);

    fakes.llm.queue({
      items: [{ source: "czwartek", target: "Thursday", acceptedAnswers: [], visualType: "image" }],
    });
    const { runId } = await enqueueDeckGeneration(services, { ...COMMAND, idempotencyKey: "restart-1" });
    expect((await readGeneration(services, runId)).state).toBe("queued");

    // "restart": nowy proces, nowa pula, ta sama baza i te same zależności
    const restarted = createDatabase(testDatabaseUrl());
    const restartedServices = createServices({
      db: restarted.db,
      clock: new ManualClock(),
      media: fakes.settings,
      generation: fakes.deps,
    });
    try {
      await runDueGenerationWork(restartedServices);
    } finally {
      await restarted.pool.end();
    }

    const dto = await readGeneration(services, runId);
    expect(dto.state).toBe("succeeded");

    const version = (
      await query<{ state: string }>("select state from learning_app.deck_versions where id = $1", [
        dto.deckVersionId!,
      ])
    )[0]!;
    expect(version.state).toBe("review");

    const assets = await query<{ state: string; storage_key: string; content_sha256: string }>(
      "select state, storage_key, content_sha256 from learning_app.media_assets",
    );
    expect(assets).toHaveLength(2);
    expect(assets.every((a) => a.state === "ready" && a.storage_key && a.content_sha256)).toBe(true);

    for (const asset of assets) {
      const blob = await fakes.store.get(asset.storage_key);
      expect(blob).not.toBeNull();
      expect(blob!.bytes.byteLength).toBeGreaterThan(0);
    }
  });
});
