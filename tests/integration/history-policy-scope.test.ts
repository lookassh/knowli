import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createChild, createDraft, ensureLearningPolicy, listKidDecks } from "@learning/server";
import { readLearningSnapshot } from "../../packages/server/src/modules/learning/learning-snapshot";
import { LEARNING_V1_POLICY } from "../../packages/server/src/policies/learning-v1";
import { recordSkillIssued } from "../../packages/server/src/modules/learning/skill-projections";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();

afterAll(async () => {
  await pool.end();
});

describe("izolacja projekcji historii per polityka", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(
      `truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
              learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
              learning_app.deck_versions, learning_app.decks cascade`,
    );
  });

  it("nie dziedziczy projekcji innej polityki, gdy bieżąca polityka nie ma dowodów", async () => {
    const { services, clock } = buildTestServices();
    await ensureLearningPolicy(services.db);
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const draft = await createDraft(services, {
      title: "Historia polityk",
      items: [{
        source: "poniedziałek",
        target: "Monday",
        acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "none",
      }],
    });
    const revision = (await pool.query<{ id: string; skill_version_id: string }>(
      `select irs.item_revision_id as id, irs.skill_version_id
         from learning_app.item_revision_skills irs
         join learning_app.item_revisions ir on ir.id = irs.item_revision_id
        where ir.deck_version_id = $1 and irs.skill = 'recall'`,
      [draft.id],
    )).rows[0]!;

    // Reprezentuje wiarygodny postęp przypięty do learning-v2; czytnik dla
    // learning-v1 bez własnej historii nie może traktować go jako swojego.
    await pool.query(
      `insert into learning_app.child_skill_progress
         (child_id, skill_version_id, policy_id, status, independent_success_streak,
          last_reviewed_at, next_review_at, delayed_confirmation_at, projection_version)
       values ($1,$2,'learning-v2','mastered',3,$3,$3,null,'proj-2')`,
      [child.id, revision.skill_version_id, new Date(clock.now().getTime() - 86_400_000)],
    );

    const [snapshot] = await readLearningSnapshot(services.db, {
      childId: child.id,
      revisionIds: [revision.id],
      policy: LEARNING_V1_POLICY,
      now: clock.now().toISOString(),
    });

    expect(snapshot?.progress.recall).toBeUndefined();
  });

  it("zachowuje najwcześniejsze wydanie przy równoległych zapisach", async () => {
    const { services, clock } = buildTestServices();
    await ensureLearningPolicy(services.db);
    const child = await createChild(services, { displayName: "Jan", avatarKey: "cat" });
    const draft = await createDraft(services, { title: "MIN wydania", items: [{
      source: "wtorek", target: "Tuesday", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
    }] });
    const scopeRow = (await pool.query<{ skill_version_id: string }>(
      `select skill_version_id from learning_app.item_revision_skills s join learning_app.item_revisions r on r.id=s.item_revision_id
       where r.deck_version_id=$1 and s.skill='recall'`, [draft.id],
    )).rows[0]!;
    const scope = { childId: child.id, skillVersionId: scopeRow.skill_version_id, skill: "recall" as const };
    const earlier = new Date(clock.now().getTime() - 60_000);
    const later = new Date(clock.now().getTime());
    await Promise.all([later, earlier].map(issuedAt => services.db.transaction(tx =>
      recordSkillIssued(tx, scope, "learning-v2", issuedAt),
    )));
    const row = (await pool.query<{ first_issued_at: Date }>(
      `select first_issued_at from learning_app.child_skill_progress where child_id=$1 and skill_version_id=$2 and policy_id='learning-v2'`,
      [child.id, scope.skillVersionId],
    )).rows[0]!;
    expect(row.first_issued_at.toISOString()).toBe(earlier.toISOString());
  });

  it("nie interpretuje brakującego backfillu jako braku postępu", async () => {
    const { services } = buildTestServices();
    const child = await createChild(services, { displayName: "Ewa", avatarKey: "owl" });
    await pool.query(`update learning_app.child_profiles set learning_projection_version=null where id=$1`, [child.id]);
    await expect(listKidDecks(services, child.id)).rejects.toMatchObject({ code: "conflict" });
  });
});
