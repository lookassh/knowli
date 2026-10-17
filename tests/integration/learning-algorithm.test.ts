import { startLegacyTrainingSession } from "./helpers";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  completePresentation,
  createChild,
  createDraft,
  endSession,
  nextTask,
  publishDraft,
  startSession,
  submitAttempt,
  upsertAssignment,
} from "@learning/server";
import { buildTestServices, testDatabase, truncateCoreTables } from "./helpers";

const { pool } = testDatabase();
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

afterAll(async () => { await pool.end(); });

describe("algorytm nauki — regresja wielodniowa PostgreSQL", () => {
  beforeEach(async () => {
    await truncateCoreTables();
    await pool.query(`truncate learning_app.revision_assets, learning_app.media_assets, learning_app.item_revision_skills,
      learning_app.item_revisions, learning_app.skill_versions, learning_app.learning_items,
      learning_app.deck_versions, learning_app.decks cascade`);
  });

  it("prowadzi dwa profile przez 12 słów bez mikrofonu, nie miesza ich ocen i wraca do Recall/pisowni po przerwie", async () => {
    const { services, clock } = buildTestServices("2026-10-09T16:00:00.000Z");
    const children = await Promise.all([
      createChild(services, { displayName: "Maja", avatarKey: "fox" }),
      createChild(services, { displayName: "Olek", avatarKey: "cat" }),
    ]);
    const pairs = [
      ["styczeń", "January"], ["luty", "February"], ["marzec", "March"], ["kwiecień", "April"],
      ["maj", "May"], ["czerwiec", "June"], ["lipiec", "July"], ["sierpień", "August"],
      ["wrzesień", "September"], ["październik", "October"], ["listopad", "November"], ["grudzień", "December"],
    ] as const;
    const draft = await createDraft(services, { title: "Miesiące", items: pairs.map(([source, target]) => ({
      source, target, acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none" as const,
    })) });
    const revisions = await query<{ id: string }>(
      `select id from learning_app.item_revisions where deck_version_id=$1 order by position`, [draft.id],
    );
    for (const revision of revisions) {
      const assetId = randomUUID();
      const fingerprint = `test-${randomUUID()}`;
      await pool.query(`insert into learning_app.media_assets
        (id, kind, fingerprint, generation_number, state, storage_key, content_sha256, mime_type, byte_count, provider, model)
        values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',1024,'fake','fake')`,
      [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
      await pool.query(`insert into learning_app.revision_assets
        (item_revision_id, role, asset_id, expected_fingerprint, state)
        values ($1,'target_audio',$2,$3,'approved'),($1,'illustration',null,$4,'omitted')`,
      [revision.id, assetId, fingerprint, `image-${randomUUID()}`]);
    }
    await publishDraft(services, draft.id, 1);
    for (const child of children) await upsertAssignment(services, child.id, draft.deckId, null);

    const issued: Record<string, Set<string>> = Object.fromEntries(children.map((child) => [child.id, new Set<string>()]));
    for (let day = 0; day < 14; day += 1) {
      for (const child of children) {
        const session = await startLegacyTrainingSession(services, { childId: child.id, deckId: draft.deckId, microphoneEnabled: false });
        let steps = 0;
        while (steps < 50) {
          steps += 1;
          const task = await nextTask(services, session.sessionId);
          if (!task) break;
          if (task.exerciseType === "speech") throw new Error("Speech nie może być wydane bez mikrofonu");
          issued[child.id]!.add(task.exerciseType);
          if (task.exerciseType === "exposure") {
            await completePresentation(services, { taskId: task.taskId });
            continue;
          }
          const key = (await query<{ target: string; optionId: string | null }>(
            `select answer_key->>'target' as target, answer_key->>'correctOptionId' as "optionId"
               from learning_app.session_tasks where id=$1`, [task.taskId],
          ))[0]!;
          await submitAttempt(services, key.optionId === null
            ? { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "text", text: key.target }
            : { taskId: task.taskId, clientAttemptId: randomUUID(), modality: "choice", optionId: key.optionId });
        }
        expect(steps).toBeLessThan(50);
        await endSession(services, session.sessionId);
      }
      clock.advanceHours(24);
    }

    expect(issued[children[0]!.id]).toContain("listening");
    expect(issued[children[0]!.id]).toContain("recall");
    for (const child of children) expect(issued[child.id]).not.toContain("speech");

    const independentByChild = await query<{ child_id: string; skill: string; item_id: string; count: number }>(
      `select a.child_id, a.skill, r.item_id, count(*)::int as count
         from learning_app.assessments a
         join learning_app.item_revisions r on r.id=a.item_revision_id
         join learning_app.attempts t on t.id=a.attempt_id
        where r.deck_version_id=$1 and a.outcome='correct' and a.independent=true and a.skill in ('recall','spelling')
        group by a.child_id,a.skill,r.item_id`, [draft.id],
    );
    for (const child of children) {
      for (const skill of ["recall", "spelling"]) {
        const items = independentByChild.filter((row) => row.child_id === child.id && row.skill === skill);
        expect(new Set(items.map((row) => row.item_id)).size).toBe(12);
        expect(items.every((row) => row.count >= 1)).toBe(true);
      }
    }
    const assessmentChildren = await query<{ child_id: string }>(
      `select distinct a.child_id from learning_app.assessments a
         join learning_app.item_revisions r on r.id=a.item_revision_id where r.deck_version_id=$1`, [draft.id],
    );
    expect(new Set(assessmentChildren.map((row) => row.child_id))).toEqual(new Set(children.map((child) => child.id)));
  });
});
