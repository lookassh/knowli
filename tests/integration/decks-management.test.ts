import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AppError,
  archiveDeck,
  createChild,
  createDraft,
  createDraftFromPublished,
  createServices,
  editDraft,
  enqueueDeckGeneration,
  getProgress,
  listDecks,
  omitRevisionAsset,
  publishDraft,
  readDeck,
  removeAssignment,
  runDueGenerationWork,
  upsertAssignment,
  type Services,
} from "@learning/server";
import type { VocabularyItemInput } from "@learning/contracts";
import { ManualClock, openQuietDatabase, testDatabase, testDatabaseUrl, truncateCoreTables } from "./helpers";
import { fakeGeneration, type FakeGeneration } from "./fakes";

const { pool } = testDatabase();

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`oczekiwano błędu ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

const LOCALES = { source: "pl-PL", target: "en-GB" };

function item(overrides: Partial<VocabularyItemInput> = {}): VocabularyItemInput {
  return {
    source: "czwartek",
    target: "Thursday",
    acceptedAnswers: [],
    locales: LOCALES,
    visualType: "none",
    ...overrides,
  };
}

function mediaServices(fakes: FakeGeneration): Services {
  const { db } = testDatabase();
  return createServices({ db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
}

async function childId(name: string): Promise<string> {
  const { db } = testDatabase();
  const services = createServices({ db, clock: new ManualClock() });
  return (await createChild(services, { displayName: name, avatarKey: "cat" })).id;
}

/** Opublikowany zestaw jednowyrazowy: audio celu generowane fake providerem. */
async function publishedDeck(services: Services): Promise<{ deckId: string; versionId: string }> {
  const dto = await createDraft(services, { title: "Dni", items: [item()] });
  await editDraft(services, dto.id, { title: "Dni", expectedEditNumber: dto.editNumber });
  await runDueGenerationWork(services);
  await runDueGenerationWork(services);
  await publishDraft(services, dto.id, dto.editNumber + 1);
  return { deckId: dto.deckId, versionId: dto.id };
}

describe("zarządzanie zestawami i przypisaniami (integracja)", () => {
  const disposers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.generation_runs, learning_app.revision_assets, learning_app.media_assets,
              learning_app.item_revision_skills, learning_app.item_revisions, learning_app.skill_versions,
              learning_app.learning_items, learning_app.deck_versions, learning_app.decks,
              learning_app.assignments cascade`,
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

  it("upsertAssignment tworzy i aktualizuje przypisania z terminami", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const ala = await childId("Ala");
    const bartek = await childId("Bartek");
    const { deckId } = await publishedDeck(services);

    await upsertAssignment(services, ala, deckId, "2026-10-14");
    await upsertAssignment(services, bartek, deckId, null);
    await upsertAssignment(services, ala, deckId, "2026-10-21");

    const rows = await query<{ child_id: string; test_date: string | null; active: boolean }>(
      `select child_id, test_date::text, active from learning_app.assignments`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.child_id === ala)).toMatchObject({
      test_date: "2026-10-21",
      active: true,
    });
    expect(rows.find((r) => r.child_id === bartek)).toMatchObject({
      test_date: null,
      active: true,
    });
  });

  it("removeAssignment usuwa fizycznie wiersz bez sesji, soft-deaktywuje wiersz z sesjami i odrzuca brak", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const ala = await childId("Ala");
    const bartek = await childId("Bartek");
    const { deckId, versionId } = await publishedDeck(services);

    await upsertAssignment(services, ala, deckId, "2026-10-14");
    await upsertAssignment(services, bartek, deckId, "2026-10-25");
    expect((await getProgress(services, bartek, deckId)).testDate).toBe("2026-10-25");

    // 1. Usunięcie nieistniejącego przypisania rzuca not_found
    await expectAppError(
      removeAssignment(services, randomUUID(), deckId),
      "not_found",
    );

    // 2. Usunięcie przypisania bez sesji (Ala) -> fizyczne usunięcie rekordu
    await removeAssignment(services, ala, deckId);
    const rowsAfterAla = await query<{ child_id: string }>(
      `select child_id from learning_app.assignments where child_id = $1 and deck_id = $2`,
      [ala, deckId],
    );
    expect(rowsAfterAla).toHaveLength(0);

    // 3. Przypisanie z sesją (Bartek) -> soft-delete (active = false)
    const bartekAssignment = (
      await query<{ id: string }>(
        `select id from learning_app.assignments where child_id = $1 and deck_id = $2`,
        [bartek, deckId],
      )
    )[0]!;
    await pool.query(
      `insert into learning_app.learning_policies(id, config) values ('default', '{}') on conflict do nothing`,
    );
    await pool.query(
      `insert into learning_app.learning_sessions
        (id, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled, state, ended_at, task_budget)
        values ($1, $2, $3, $4, $5, 'default', false, 'ended', now(), 10)`,
      [randomUUID(), bartek, bartekAssignment.id, deckId, versionId],
    );

    await removeAssignment(services, bartek, deckId);

    const rowsAfterBartek = await query<{ child_id: string; active: boolean }>(
      `select child_id, active from learning_app.assignments where child_id = $1 and deck_id = $2`,
      [bartek, deckId],
    );
    expect(rowsAfterBartek).toHaveLength(1);
    expect(rowsAfterBartek[0]?.active).toBe(false);

    // 4. readDeck, listDecks i getProgress nie zwracają nieaktywnych przypisań / dat
    const deckDto = await readDeck(services, deckId);
    expect(deckDto.assignments).toHaveLength(0);

    const decksList = await listDecks(services);
    const summary = decksList.find((d) => d.deckId === deckId);
    expect(summary?.assignedChildren).toEqual([]);

    expect((await getProgress(services, bartek, deckId)).testDate).toBeNull();

    // 5. Reaktywacja przez upsertAssignment
    await upsertAssignment(services, bartek, deckId, "2026-11-01");
    const reactivatedRows = await query<{ child_id: string; test_date: string | null; active: boolean }>(
      `select child_id, test_date::text, active from learning_app.assignments where child_id = $1 and deck_id = $2`,
      [bartek, deckId],
    );
    expect(reactivatedRows[0]).toMatchObject({
      test_date: "2026-11-01",
      active: true,
    });
    const reactivatedDeckDto = await readDeck(services, deckId);
    expect(reactivatedDeckDto.assignments).toHaveLength(1);
    expect(reactivatedDeckDto.assignments[0]?.childId).toBe(bartek);
  });

  it("upsertAssignment odrzuca nieznane dziecko, nieopublikowany i zarchiwizowany zestaw", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const ala = await childId("Ala");

    const draft = await createDraft(services, { title: "Szkic", items: [item()] });
    await expectAppError(
      upsertAssignment(services, ala, draft.deckId, "2026-10-14"),
      "validation",
    );

    const { deckId } = await publishedDeck(services);
    await expectAppError(
      upsertAssignment(services, "00000000-0000-0000-0000-000000000000", deckId, null),
      "not_found",
    );

    await archiveDeck(services, deckId);
    await expectAppError(upsertAssignment(services, ala, deckId, "2026-10-14"), "conflict");
  });

  it("archiveDeck wycofuje zestaw idempotentnie, a listDecks pokazuje archiwum", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const { deckId } = await publishedDeck(services);

    await expectAppError(archiveDeck(services, "00000000-0000-0000-0000-000000000000"), "not_found");

    await archiveDeck(services, deckId);
    await archiveDeck(services, deckId);
    const row = (
      await query<{ archived_at: string | null }>(
        `select archived_at from learning_app.decks where id = $1`,
        [deckId],
      )
    )[0]!;
    expect(row.archived_at).not.toBeNull();
    expect((await listDecks(services))[0]).toMatchObject({ deckId, state: "archived" });
  });

  it("listDecks podaje opcjonalne meta: liczbę pozycji i aktywne przypisania", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);

    const deck = await publishedDeck(services);
    const ala = await childId("Ala");
    const ola = await childId("Ola");
    await upsertAssignment(services, ala, deck.deckId, "2026-10-24");
    await upsertAssignment(services, ola, deck.deckId, null);

    const summary = (await listDecks(services)).find((d) => d.deckId === deck.deckId)!;
    expect(summary.itemCount).toBe(1);
    expect([...summary.assignedChildren ?? []].sort((a, b) => a.displayName.localeCompare(b.displayName))).toEqual([
      { childId: ala, displayName: "Ala", testDate: "2026-10-24" },
      { childId: ola, displayName: "Ola", testDate: null },
    ]);

    // szkic bez przypisań liczy pozycje wersji edytowalnej, reprezentatywnej dla stanu
    const manual = await createDraft(services, { title: "Szkicowy", items: [item(), item({ source: "piątek", target: "Friday" })] });
    const draftSummary = (await listDecks(services)).find((d) => d.deckId === manual.deckId)!;
    expect(draftSummary.itemCount).toBe(2);
    expect(draftSummary.assignedChildren).toEqual([]);
  });

  it("listDecks/readDeck prowadzą zestaw przez draft → review → published", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);

    const manual = await createDraft(services, { title: "Ręczny", items: [item()] });
    const generated = await enqueueDeckGeneration(services, {
      prompt: "dni tygodnia po angielsku",
      idempotencyKey: "list-decks-1",
    });

    let list = await listDecks(services);
    expect(list.map((d) => [d.title, d.state]).sort()).toEqual([
      ["Ręczny", "draft"],
      ["dni tygodnia po angielsku", "draft"],
    ]);

    // generacja kończy się stanem review; audio dojrzewa w kolejnych przelotach
    for (let pass = 0; pass < 10; pass++) {
      await runDueGenerationWork(services);
    }
    list = await listDecks(services);
    const generatedSummary = list.find((d) => d.deckId === generated.deckId)!;
    expect(generatedSummary.state).toBe("review");
    expect(generatedSummary.editableVersionId).not.toBeNull();

    const beforePublish = await readDeck(services, generated.deckId);
    expect(beforePublish.draft?.status).toBe("review");
    expect(beforePublish.generation?.state).toBe("succeeded");
    expect(beforePublish.draft?.items.length).toBe(7);

    await publishDraft(services, generatedSummary.editableVersionId!, beforePublish.draft!.editNumber);
    list = await listDecks(services);
    expect(list.find((d) => d.deckId === generated.deckId)).toMatchObject({
      state: "published",
      editableVersionId: null,
    });
    const afterPublish = await readDeck(services, generated.deckId);
    expect(afterPublish.draft).toBeNull();
    expect(afterPublish.published?.status).toBe("published");
  });

  it("readDeck pokazuje projekcję stanu zasobów po wykonaniu runów", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);

    const generated = await enqueueDeckGeneration(services, {
      prompt: "dni tygodnia po angielsku",
      idempotencyKey: "assets-view-1",
    });
    const pending = await readDeck(services, generated.deckId);
    expect(pending.generation?.state).toBe("queued");
    // wersja szkicu istnieje od razu, ale czeka na wynik LLM
    expect(pending.draft?.items).toEqual([]);
    expect(pending.draft?.assets).toEqual([]);

    for (let pass = 0; pass < 12; pass++) {
      await runDueGenerationWork(services);
    }
    const ready = await readDeck(services, generated.deckId);
    const assets = ready.draft!.assets;
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.state).toBe("approved");
      expect(asset.assetId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("readDeck nie łączy pustego szkicu ze stanem succeeded z nowszej migawki", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const isolated = openQuietDatabase(testDatabaseUrl());
    const services = createServices({ db: isolated.db, clock: new ManualClock(), media: fakes.settings, generation: fakes.deps });
    const generated = await enqueueDeckGeneration(services, {
      prompt: "dni tygodnia po angielsku",
      idempotencyKey: "read-deck-repeatable-snapshot",
    });

    let signalRead!: () => void;
    let releaseRead!: () => void;
    const readingItems = new Promise<void>((resolve) => { signalRead = resolve; });
    const resumeRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const originalConnect = isolated.pool.connect.bind(isolated.pool);
    let paused = false;
    const wrapClient = (client: unknown) => {
      const pgClient = client as { query: (...values: unknown[]) => unknown };
      const originalClientQuery = pgClient.query.bind(pgClient);
      const shouldPause = (queryArgs: unknown[]) => {
        const queryText = typeof queryArgs[0] === "string" ? queryArgs[0] : (queryArgs[0] as { text?: string })?.text ?? "";
        if (!paused && queryText.includes('from "learning_app"."item_revisions"')) {
          paused = true;
          signalRead();
          return true;
        }
        return false;
      };
      pgClient.query = ((...queryArgs: unknown[]) => {
        const callbackIndex = queryArgs.findIndex((value) => typeof value === "function");
        if (callbackIndex >= 0) {
          const callback = queryArgs[callbackIndex] as (...values: unknown[]) => void;
          const wrappedArgs = [...queryArgs];
          wrappedArgs[callbackIndex] = (...values: unknown[]) => {
            if (shouldPause(queryArgs)) void resumeRead.then(() => callback(...values));
            else callback(...values);
          };
          return originalClientQuery(...wrappedArgs);
        }
        return (originalClientQuery(...queryArgs) as Promise<unknown>).then(async (result) => {
          if (shouldPause(queryArgs)) await resumeRead;
          return result;
        });
      }) as typeof pgClient.query;
      return client;
    };
    isolated.pool.connect = ((...args: unknown[]) => {
      const callbackIndex = args.findIndex((value) => typeof value === "function");
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex] as (...values: unknown[]) => void;
        const wrappedArgs = [...args];
        wrappedArgs[callbackIndex] = (error: unknown, client: unknown, release: unknown) => {
          callback(error, client ? wrapClient(client) : client, release);
        };
        return (originalConnect as (...values: unknown[]) => unknown)(...wrappedArgs);
      }
      return (originalConnect as (...values: unknown[]) => Promise<unknown>)(...args).then(wrapClient);
    }) as typeof isolated.pool.connect;

    const pendingRead = readDeck(services, generated.deckId);
    try {
      await readingItems;
      await runDueGenerationWork(services);
      const completed = await readDeck(services, generated.deckId);
      expect(completed.generation?.state).toBe("succeeded");
      expect(completed.draft?.items).toHaveLength(7);
      releaseRead();

      const snapshot = await pendingRead;
      expect(snapshot.generation?.state).toBe("queued");
      expect(snapshot.draft?.items).toEqual([]);
    } finally {
      releaseRead();
      isolated.pool.connect = originalConnect as typeof isolated.pool.connect;
      await isolated.pool.end();
    }
  });

  it("omitRevisionAsset pozwala świadomie pominąć obraz i publikować bez niego", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const dto = await createDraft(services, {
      title: "Obrazki",
      items: [item({ source: "środa", target: "Wednesday", visualType: "image" })],
    });
    await editDraft(services, dto.id, { title: "Obrazki", expectedEditNumber: dto.editNumber });
    for (let pass = 0; pass < 4; pass++) {
      await runDueGenerationWork(services);
    }

    await omitRevisionAsset(services, { draftId: dto.id, itemRevisionId: dto.items[0]!.revisionId });

    // pominięcie trwa przy edycji, która nie zmienia fingerprintu obrazu
    const edited = await editDraft(services, dto.id, {
      title: "Obrazki 2",
      expectedEditNumber: dto.editNumber + 1,
    });
    const illustration = edited.assets.find((a) => a.role === "illustration")!;
    expect(illustration.state).toBe("omitted");

    await publishDraft(services, dto.id, edited.editNumber);

    // element bez obrazu nie ma czego pomijać
    const plain = await createDraft(services, { title: "Bez obrazu", items: [item()] });
    await editDraft(services, plain.id, { title: "Bez obrazu", expectedEditNumber: plain.editNumber });
    await expectAppError(
      omitRevisionAsset(services, { draftId: plain.id, itemRevisionId: plain.items[0]!.revisionId }),
      "validation",
    );
  });

  it("odrzuca element bez wizualizacji w zestawie obrazkowym przy tworzeniu i edycji", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    await expectAppError(
      createDraft(services, { title: "Bez czytania", vocabularyFormat: "picture", items: [item()] }),
      "validation",
    );
    const dto = await createDraft(services, {
      title: "Bez czytania",
      vocabularyFormat: "picture",
      items: [item({ target: "red", visualType: "color", visualData: { color: "#ff0000" } })],
    });
    await expectAppError(editDraft(services, dto.id, {
      title: "Bez czytania",
      items: [item()],
      expectedEditNumber: dto.editNumber,
    }), "validation");
  });

  it("nie pozwala pominąć wymaganej ilustracji ani opublikować zestawu obrazkowego bez gotowego obrazu", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const dto = await createDraft(services, {
      title: "Zwierzęta",
      vocabularyFormat: "picture",
      items: [item({ source: "kot", target: "cat", visualType: "image" })],
    });
    await editDraft(services, dto.id, { title: dto.title, expectedEditNumber: dto.editNumber });
    await expectAppError(omitRevisionAsset(services, {
      draftId: dto.id,
      itemRevisionId: dto.items[0]!.revisionId,
    }), "validation");
    await expectAppError(publishDraft(services, dto.id, dto.editNumber + 1), "validation");
  });

  it("pozwala publikować kolory i liczby bez ilustracji po wygenerowaniu audio", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const dto = await createDraft(services, {
      title: "Kolory i liczby",
      vocabularyFormat: "picture",
      items: [
        item({ source: "czerwony", target: "red", visualType: "color", visualData: { color: "#ff0000" } }),
        item({ source: "dwa", target: "two", visualType: "number", visualData: { count: 2 } }),
      ],
    });
    await editDraft(services, dto.id, { title: dto.title, expectedEditNumber: dto.editNumber });
    for (let pass = 0; pass < 6; pass++) await runDueGenerationWork(services);
    await expect(publishDraft(services, dto.id, dto.editNumber + 1)).resolves.toMatchObject({ deckVersionId: dto.id });
  });

  it("publikuje element obrazkowy dopiero z gotową, zatwierdzoną ilustracją i audio", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const dto = await createDraft(services, {
      title: "Zwierzęta obrazkowe",
      vocabularyFormat: "picture",
      items: [item({ source: "kot", target: "cat", visualType: "image" })],
    });
    await editDraft(services, dto.id, { title: dto.title, expectedEditNumber: dto.editNumber });
    for (let pass = 0; pass < 6; pass++) await runDueGenerationWork(services);
    const ready = await readDeck(services, dto.deckId);
    expect(ready.draft?.assets.filter((asset) => ["target_audio", "illustration"].includes(asset.role)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "target_audio", state: "approved", assetId: expect.any(String) }),
        expect.objectContaining({ role: "illustration", state: "approved", assetId: expect.any(String) }),
      ]));
    await expect(publishDraft(services, dto.id, dto.editNumber + 1)).resolves.toMatchObject({ deckVersionId: dto.id });
  });

  it("readDeck zwraca przypisania z nazwami dzieci", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const ala = await childId("Ala");
    const { deckId } = await publishedDeck(services);
    await upsertAssignment(services, ala, deckId, "2026-10-14");

    const deck = await readDeck(services, deckId);
    expect(deck.assignments).toEqual([
      { childId: ala, displayName: "Ala", testDate: "2026-10-14", active: true, testGoals: null, mockTestTaskCount: 10 },
    ]);
  });

  it("szkic v2 po zmianie znaczenia publikuje się, zachowując zgodne media", async () => {
    const fakes = await fakeGeneration();
    disposers.push(fakes.dispose);
    const services = mediaServices(fakes);
    const v1 = await createDraft(services, {
      title: "Dni",
      items: [
        item({ example: "I go to school on monday.", visualType: "image" }),
        item({ source: "wtorek", target: "tuesday", example: "See you on tuesday.", visualType: "image" }),
      ],
    });
    await editDraft(services, v1.id, { title: "Dni", expectedEditNumber: v1.editNumber });
    for (let pass = 0; pass < 6; pass++) {
      await runDueGenerationWork(services);
    }
    await omitRevisionAsset(services, { draftId: v1.id, itemRevisionId: v1.items[1]!.revisionId });
    await publishDraft(services, v1.id, v1.editNumber + 1);

    const v2 = await createDraftFromPublished(services, v1.deckId);
    const edited = await editDraft(services, v2.id, {
      items: v2.items.map((card, index) =>
        index === 0 ? { ...card, source: "poniedziałek (dzień)" } : card,
      ),
      expectedEditNumber: v2.editNumber,
    });
    // nowa ilustracja dla zmienionego znaczenia; audio celu bez regeneracji
    const pendingIllustration = edited.assets.find(
      (a) => a.role === "illustration" && a.itemRevisionId === v2.items[0]!.revisionId,
    );
    expect(pendingIllustration?.state).toBe("pending");
    for (let pass = 0; pass < 6; pass++) {
      await runDueGenerationWork(services);
    }

    await publishDraft(services, v2.id, edited.editNumber);

    const deck = await readDeck(services, v1.deckId);
    expect(deck.published?.id).toBe(v2.id);
    // media niezmienionych elementów są współdzielone: jeden nowy zasób (ilustracja)
    const counts = await query<{ kind: string; count: number }>(
      `select kind, count(*)::int as count from learning_app.media_assets group by kind`,
    );
    expect(counts.find((c) => c.kind === "tts")).toMatchObject({ count: 4 });
    expect(counts.find((c) => c.kind === "illustration")).toMatchObject({ count: 3 });
  });
});
