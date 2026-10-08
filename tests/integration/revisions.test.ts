import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  archiveDeck,
  createDraft,
  createDraftFromPublished,
  editDraft,
  publishDraft,
  readDeck,
  type AppError,
} from "@learning/server";
import type { VocabularyItemInput } from "@learning/contracts";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";
import type { ManualClock } from "./helpers";

const { pool } = testDatabase();

async function query<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await promise.then(
    () => {
      throw new Error(`Oczekiwano błędu ${code}, otrzymano sukces`);
    },
    (error: unknown) => {
      expect(error).toMatchObject({ code });
    },
  );
}

function vocabItem(overrides: Partial<VocabularyItemInput> = {}): VocabularyItemInput {
  return {
    source: "czwartek",
    target: "Thursday",
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    example: "See you on Thursday.",
    visualType: "image",
    ...overrides,
  };
}

interface SkillRow {
  skill: string;
  skill_version_id: string;
  revision_number: number;
  predecessor_id: string | null;
}

async function skillsOfVersion(deckVersionId: string, itemIndex = 0): Promise<Map<string, SkillRow>> {
  const rows = await query<SkillRow>(
    `select irs.skill, irs.skill_version_id, sv.revision_number, sv.predecessor_id
       from learning_app.item_revisions ir
       join learning_app.item_revision_skills irs on irs.item_revision_id = ir.id
       join learning_app.skill_versions sv on sv.id = irs.skill_version_id
      where ir.deck_version_id = $1 and ir.position = $2`,
    [deckVersionId, itemIndex],
  );
  return new Map(rows.map((r) => [r.skill, r]));
}

/** Fake-ready media: zadanie 3 wprowadza realne zasoby; tu tylko stan do publikacji. */
async function attachFakeReadyAudio(deckVersionId: string, itemIndex: number): Promise<string> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [deckVersionId, itemIndex],
    )
  )[0]!;
  const assetId = randomUUID();
  const fingerprint = `fp-${randomUUID()}`;
  await pool.query(
    `insert into learning_app.media_assets
       (id, kind, fingerprint, generation_number, state, storage_key, content_sha256,
        mime_type, byte_count, provider, model)
     values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake-tts')`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`],
  );
  await pool.query(
    `insert into learning_app.revision_assets
       (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'target_audio',$2,$3,'approved')`,
    [revision.id, assetId, fingerprint],
  );
  return revision.id;
}

async function omitIllustration(deckVersionId: string, itemIndex: number): Promise<void> {
  const revision = (
    await query<{ id: string }>(
      `select id from learning_app.item_revisions
        where deck_version_id = $1 order by position offset $2 limit 1`,
      [deckVersionId, itemIndex],
    )
  )[0]!;
  await pool.query(
    `insert into learning_app.revision_assets
       (item_revision_id, role, asset_id, expected_fingerprint, state)
     values ($1,'illustration',null,$2,'omitted')`,
    [revision.id, `fp-ill-${randomUUID()}`],
  );
}

async function versionRow(deckVersionId: string) {
  return (
    await query<{
      state: string;
      edit_number: number;
      version_number: number;
      deck_id: string;
      title: string;
    }>(`select state, edit_number, version_number, deck_id, title
           from learning_app.deck_versions where id = $1`, [deckVersionId])
  )[0];
}

describe("wersje zestawów i umiejętności (integracja)", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );  });

  afterAll(async () => {
    await pool.end();
  });

  it("createDraft tworzy deck, wersję draft i komplet kluczy umiejętności", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, {
      title: "Dni tygodnia",
      items: [vocabItem(), vocabItem({ source: "piątek", target: "Friday" })],
    });

    expect(dto.status).toBe("draft");
    expect(dto.editNumber).toBe(1);
    expect(dto.items).toHaveLength(2);

    const version = await versionRow(dto.id);
    expect(version?.state).toBe("draft");
    expect(version?.version_number).toBe(1);
    expect(version?.title).toBe("Dni tygodnia");

    const skills = await skillsOfVersion(dto.id);
    expect([...skills.keys()].sort()).toEqual([
      "listening",
      "pronunciation",
      "reading",
      "recall",
      "spelling",
    ]);
    for (const row of skills.values()) {
      expect(row.revision_number).toBe(1);
      expect(row.predecessor_id).toBeNull();
    }

    const targetKey = (
      await query<{ target_key: string }>(
        `select target_key from learning_app.item_revisions
          where deck_version_id = $1 order by position limit 1`,
        [dto.id],
      )
    )[0]!.target_key;
    expect(targetKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("zmiana wyłącznie ilustracji zachowuje te same skill_version", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });
    const before = await skillsOfVersion(dto.id);

    const edited = await editDraft(services, dto.id, {
      items: [
        {
          ...vocabItem({ visualType: "color", visualData: { color: "#4169e1" } }),
          id: dto.items[0]!.id,
        },
      ],
      expectedEditNumber: 1,
    });

    expect(edited.editNumber).toBe(2);
    const after = await skillsOfVersion(dto.id);
    for (const [skill, row] of after) {
      expect(row.skill_version_id).toBe(before.get(skill)!.skill_version_id);
    }
  });

  it("zmiana znaczenia tworzy nowe klucze listening/reading/recall i zachowuje wymowę/pisownię", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });
    const before = await skillsOfVersion(dto.id);

    await editDraft(services, dto.id, {
      items: [{ ...vocabItem({ source: "czwartek (dzień)" }), id: dto.items[0]!.id }],
      expectedEditNumber: 1,
    });

    const after = await skillsOfVersion(dto.id);
    for (const skill of ["listening", "reading", "recall"]) {
      const newRow = after.get(skill)!;
      expect(newRow.skill_version_id).not.toBe(before.get(skill)!.skill_version_id);
      expect(newRow.revision_number).toBe(2);
      expect(newRow.predecessor_id).toBe(before.get(skill)!.skill_version_id);
    }
    for (const skill of ["pronunciation", "spelling"]) {
      expect(after.get(skill)!.skill_version_id).toBe(before.get(skill)!.skill_version_id);
    }
  });

  it("zmiana target tworzy nowych pięć kluczy", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });
    const before = await skillsOfVersion(dto.id);

    await editDraft(services, dto.id, {
      items: [{ ...vocabItem({ target: "Friday", source: "piątek" }), id: dto.items[0]!.id }],
      expectedEditNumber: 1,
    });

    const after = await skillsOfVersion(dto.id);
    for (const row of after.values()) {
      expect(row.skill_version_id).not.toBe(
        before.get(row.skill)!.skill_version_id,
      );
      expect(row.revision_number).toBe(2);
    }
  });

  it("dwie konkurujące edycje: wygrywa tylko jedna z właściwym edit_number", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });

    const results = await Promise.allSettled([
      editDraft(services, dto.id, { title: "Dni tygodnia", expectedEditNumber: 1 }),
      editDraft(services, dto.id, { title: "Dni tygodnia!", expectedEditNumber: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    await expectAppError(
      editDraft(services, dto.id, { title: "Stary", expectedEditNumber: 1 }),
      "conflict",
    );
    expect((await versionRow(dto.id))?.edit_number).toBe(2);
  });

  it("edycja opublikowanej wersji kończy się błędem niezmienności", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });
    await attachFakeReadyAudio(dto.id, 0);
    await omitIllustration(dto.id, 0);
    await publishDraft(services, dto.id, 1);

    await expectAppError(
      editDraft(services, dto.id, { title: "Po publikacji", expectedEditNumber: 1 }),
      "immutable",
    );
  });

  it("szkic v2 z opublikowanej wersji kopiuje elementy, klucze umiejętności i decyzje o mediach", async () => {
    const { services } = buildTestServices();
    const v1 = await createDraft(services, {
      title: "Dni",
      items: [vocabItem(), vocabItem({ source: "piątek", target: "Friday" })],
    });
    await attachFakeReadyAudio(v1.id, 0);
    await attachFakeReadyAudio(v1.id, 1);
    await omitIllustration(v1.id, 0);
    await omitIllustration(v1.id, 1);
    await publishDraft(services, v1.id, 1);
    const v1Skills = await skillsOfVersion(v1.id);

    const v2 = await createDraftFromPublished(services, v1.deckId);

    // świeży szkic: edit_number od 1, kolejny numer wersji, te same itemy
    expect(v2.status).toBe("draft");
    expect(v2.editNumber).toBe(1);
    expect(v2.items.map((item) => [item.id, item.source, item.target])).toEqual(
      v1.items.map((item) => [item.id, item.source, item.target]),
    );
    const version = await versionRow(v2.id);
    expect(version?.version_number).toBe(2);
    expect(version?.state).toBe("draft");
    expect(version?.title).toBe("Dni");

    // nic się nie zmieniło: rewizje v2 wskazują te same skill_version co v1
    const v2Skills = await skillsOfVersion(v2.id);
    for (const [skill, row] of v2Skills) {
      expect(row.skill_version_id).toBe(v1Skills.get(skill)!.skill_version_id);
    }

    // decyzje o mediach przechodzą do szkicu: komplet powiązań v2 równy v1
    // (audio approved, obraz omitted, te same assety i fingerprinty)
    const assetsOf = (deckVersionId: string) =>
      query<{
        position: number;
        role: string;
        asset_id: string | null;
        state: string;
        expected_fingerprint: string;
      }>(
        `select ir.position, ra.role, ra.asset_id, ra.state, ra.expected_fingerprint
           from learning_app.revision_assets ra
           join learning_app.item_revisions ir on ir.id = ra.item_revision_id
          where ir.deck_version_id = $1 order by ir.position, ra.role`,
        [deckVersionId],
      );
    expect(await assetsOf(v2.id)).toEqual(await assetsOf(v1.id));

    // panel widzi jednocześnie szkic v2 i wciąż opublikowaną v1
    const deck = await readDeck(services, v1.deckId);
    expect(deck.state).toBe("draft");
    expect(deck.draft?.id).toBe(v2.id);
    expect(deck.published?.id).toBe(v1.id);
    expect((await versionRow(v1.id))?.state).toBe("published");
  });

  it("szkic v2 wymaga publikacji i tylko jeden; zmiana znaczenia i publikacja prowadzą łańcuch kluczy", async () => {
    const { services } = buildTestServices();
    const v1 = await createDraft(services, { title: "Dni", items: [vocabItem()] });
    await attachFakeReadyAudio(v1.id, 0);
    await omitIllustration(v1.id, 0);

    // nieopublikowany zestaw nie ma wersji do skopiowania
    await expectAppError(createDraftFromPublished(services, v1.deckId), "validation");
    await expectAppError(
      createDraftFromPublished(services, "00000000-0000-0000-0000-000000000000"),
      "not_found",
    );

    await publishDraft(services, v1.id, 1);
    const v2 = await createDraftFromPublished(services, v1.deckId);

    // jeden edytowalny szkic na zestaw (indeks częściowy one_editable_version_per_deck)
    await expectAppError(createDraftFromPublished(services, v1.deckId), "conflict");

    // zmiana znaczenia w v2 tworzy nowe klucze z predecessorami kluczy v1
    const before = await skillsOfVersion(v2.id);
    await editDraft(services, v2.id, {
      items: [{ ...vocabItem({ source: "czwartek (dzień)" }), id: v2.items[0]!.id }],
      expectedEditNumber: v2.editNumber,
    });
    const after = await skillsOfVersion(v2.id);
    for (const skill of ["listening", "reading", "recall"]) {
      expect(after.get(skill)!.predecessor_id).toBe(before.get(skill)!.skill_version_id);
      expect(after.get(skill)!.revision_number).toBe(2);
    }
    for (const skill of ["pronunciation", "spelling"]) {
      expect(after.get(skill)!.skill_version_id).toBe(before.get(skill)!.skill_version_id);
    }

    // publikacja v2 przekierowuje zestaw; v1 pozostaje niezmieniona w historii
    await publishDraft(services, v2.id, v2.editNumber + 1);
    const deck = (
      await query<{ published_version_id: string }>(
        "select published_version_id from learning_app.decks where id = $1",
        [v1.deckId],
      )
    )[0]!;
    expect(deck.published_version_id).toBe(v2.id);
    expect((await versionRow(v1.id))?.state).toBe("published");
    expect((await versionRow(v2.id))?.state).toBe("published");

    // po publikacji v2 można zacząć v3, ale zarchiwizowany zestaw już nie
    const v3 = await createDraftFromPublished(services, v1.deckId);
    expect((await versionRow(v3.id))?.version_number).toBe(3);
    await archiveDeck(services, v1.deckId);
    await expectAppError(createDraftFromPublished(services, v1.deckId), "conflict");
  });


  it("publikacja wymaga gotowego audio i świadomej decyzji o ilustracji", async () => {
    const { services, clock } = buildTestServices();
    const dto = await createDraft(services, { title: "Dni", items: [vocabItem()] });

    await expectAppError(publishDraft(services, dto.id, 1), "validation");

    await attachFakeReadyAudio(dto.id, 0);
    await expectAppError(publishDraft(services, dto.id, 1), "validation");

    await omitIllustration(dto.id, 0);
    const published = await publishDraft(services, dto.id, 1);
    expect(published.deckVersionId).toBe(dto.id);

    const version = await versionRow(dto.id);
    expect(version?.state).toBe("published");

    const deck = (
      await query<{ published_version_id: string | null; title: string }>(
        "select published_version_id, title from learning_app.decks where id = $1",
        [dto.deckId],
      )
    )[0]!;
    expect(deck.published_version_id).toBe(dto.id);
    expect(deck.title).toBe("Dni");

    // ponowna publikacja i publish ze starym edit_number → konflikt
    await expectAppError(publishDraft(services, dto.id, 1), "conflict");
  });

  it("usunięcie elementu w edycji znika z wersji, a publish oznacza retired_at", async () => {
    const { services } = buildTestServices();
    const dto = await createDraft(services, {
      title: "Dni",
      items: [vocabItem(), vocabItem({ source: "piątek", target: "Friday" })],
    });

    const edited = await editDraft(services, dto.id, {
      items: [{ ...vocabItem(), id: dto.items[0]!.id }],
      expectedEditNumber: 1,
    });
    expect(edited.items).toHaveLength(1);

    const count = await query<{ count: number }>(
      "select count(*)::int as count from learning_app.item_revisions where deck_version_id = $1",
      [dto.id],
    );
    expect(count[0]!.count).toBe(1);

    await attachFakeReadyAudio(dto.id, 0);
    await omitIllustration(dto.id, 0);
    await publishDraft(services, dto.id, 2);

    const retired = await query<{ id: string; retired_at: string | null }>(
      "select id, retired_at from learning_app.learning_items where deck_id = $1 and retired_at is not null",
      [dto.deckId],
    );
    expect(retired).toHaveLength(1);
  });

  it("obcy deck_version jest odrzucony przez klucz złożony (FK)", async () => {
    const { services } = buildTestServices();
    const a = await createDraft(services, { title: "A", items: [vocabItem()] });
    const b = await createDraft(services, {
      title: "B",
      items: [vocabItem({ source: "poniedziałek", target: "Monday" })],
    });

    const itemOfA = (
      await query<{ item_id: string; deck_id: string }>(
        "select item_id, deck_id from learning_app.item_revisions where deck_version_id = $1",
        [a.id],
      )
    )[0]!;

    await expect(
      pool.query(
        `insert into learning_app.item_revisions
           (id, item_id, deck_id, deck_version_id, position, payload, target_key)
         values ($1, $2, $3, $4, 5, '{}', $5)`,
        [randomUUID(), itemOfA.item_id, itemOfA.deck_id, b.id, `k-${randomUUID()}`],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
