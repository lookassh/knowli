import { randomUUID } from "node:crypto";
import {
  createChild,
  createDraft,
  createServices,
  ensureLearningPolicy,
  publishDraft,
  ttsFingerprint,
  upsertAssignment,
  CURRENT_POLICY_ID,
  type Services,
} from "@learning/server";
import { defaultMediaSettings } from "../../packages/server/src/config";
import { buildTestServices, testDatabase } from "../integration/helpers";

const DECK_COUNT = 10;
const ITEMS_PER_DECK = 50;
const BASE_ROUNDS_PER_CHILD_DECK = 10;
const EVENTS_PER_TASK = 5;

export interface ProfileNavigationWorld {
  services: Services;
  childIds: [string, string];
  deckIds: string[];
  revisionIds: string[];
  assessmentCount: number;
  eventCount: number;
  historyMultiplier: 1 | 10;
}

export interface ProfileNavigationWorldOptions {
  historyMultiplier: 1 | 10;
  deckCount?: number;
  itemsPerDeck?: number;
  roundsPerChildDeck?: number;
}

/**
 * Seeds a synthetic, published vocabulary world and its immutable history.
 * History is written in bulk through the same processing -> assessments ->
 * completed sequence enforced by the production database triggers.
 */
export async function seedProfileNavigationWorld(
  options: ProfileNavigationWorldOptions,
): Promise<ProfileNavigationWorld> {
  const historyMultiplier = options.historyMultiplier;
  const deckCount = options.deckCount ?? DECK_COUNT;
  const itemsPerDeck = options.itemsPerDeck ?? ITEMS_PER_DECK;
  const rounds = options.roundsPerChildDeck ?? BASE_ROUNDS_PER_CHILD_DECK * historyMultiplier;
  const { pool, db } = testDatabase();
  await pool.query("TRUNCATE learning_app.child_profiles, learning_app.decks CASCADE");

  const services = createServices({ db, clock: buildTestServices().clock, media: defaultMediaSettings });
  await ensureLearningPolicy(db);
  const first = await createChild(services, { displayName: "Benchmark A", avatarKey: "fox" });
  const second = await createChild(services, { displayName: "Benchmark B", avatarKey: "owl" });
  const childIds: [string, string] = [first.id, second.id];
  const deckIds: string[] = [];
  const versionIds: string[] = [];

  for (let deckIndex = 0; deckIndex < deckCount; deckIndex += 1) {
    const items = Array.from({ length: itemsPerDeck }, (_, itemIndex) => {
      const key = `d${deckIndex}-i${itemIndex}`;
      return {
        source: `źródło ${key}`,
        target: `target ${key}`,
        acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "color" as const,
        visualData: { color: `#${((deckIndex * itemsPerDeck + itemIndex + 1) * 9973 % 0xffffff).toString(16).padStart(6, "0")}` },
      };
    });
    const draft = await createDraft(services, { title: `Benchmark ${deckIndex + 1}`, items });
    const revisions = (await pool.query<{ id: string; target: string }>(
      `select id, payload->>'target' as target
         from learning_app.item_revisions where deck_version_id=$1 order by position`,
      [draft.id],
    )).rows;
    const assets = revisions.map((revision) => {
      const assetId = randomUUID();
      const fingerprint = ttsFingerprint({
        text: revision.target,
        locale: "en-GB",
        provider: defaultMediaSettings.tts.provider,
        model: defaultMediaSettings.tts.model,
        voice: defaultMediaSettings.tts.voice,
        format: defaultMediaSettings.tts.format,
      });
      return {
        id: assetId,
        fingerprint,
        storage_key: `benchmark/${assetId}`,
        sha256: `sha-${assetId}`,
        revision_id: revision.id,
      };
    });
    await pool.query(
      `insert into learning_app.media_assets
        (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model)
       select id,'tts',fingerprint,1,'ready',storage_key,sha256,'audio/mpeg',128,$2,$3
         from jsonb_to_recordset($1::jsonb) as x(id uuid,fingerprint text,storage_key text,sha256 text)
       on conflict (fingerprint,generation_number) do nothing`,
      [JSON.stringify(assets), defaultMediaSettings.tts.provider, defaultMediaSettings.tts.model],
    );
    const persistedAssets = (await pool.query<{ id: string; fingerprint: string }>(
      "select id,fingerprint from learning_app.media_assets where fingerprint = any($1::text[]) and state='ready'",
      [assets.map((asset) => asset.fingerprint)],
    )).rows;
    const assetIdByFingerprint = new Map(persistedAssets.map((asset) => [asset.fingerprint, asset.id]));
    const linkedAssets = assets.map((asset) => ({ ...asset, id: assetIdByFingerprint.get(asset.fingerprint)! }));
    await pool.query(
      `insert into learning_app.revision_assets(item_revision_id,role,asset_id,expected_fingerprint,state)
       select revision_id,'target_audio',id,fingerprint,'approved'
         from jsonb_to_recordset($1::jsonb) as x(id uuid,fingerprint text,revision_id uuid)`,
      [JSON.stringify(linkedAssets)],
    );
    const published = await publishDraft(services, draft.id, 1);
    deckIds.push(draft.deckId);
    versionIds.push(published.deckVersionId);
    for (const childId of childIds) await upsertAssignment(services, childId, draft.deckId, null);
  }

  const assignments = (await pool.query<{ child_id: string; deck_id: string; id: string }>(
    `select child_id, deck_id, id from learning_app.assignments where child_id = any($1::uuid[])`,
    [childIds],
  )).rows;
  const assignmentByKey = new Map(assignments.map((row) => [`${row.child_id}:${row.deck_id}`, row.id]));
  const sessions = childIds.flatMap((childId) => deckIds.flatMap((deckId, deckIndex) =>
    Array.from({ length: rounds }, (_, round) => ({
      id: randomUUID(),
      child_id: childId,
      deck_id: deckId,
      assignment_id: assignmentByKey.get(`${childId}:${deckId}`)!,
      version_id: versionIds[deckIndex]!,
      round,
      started_at: new Date(Date.UTC(2026, 8, 1) + (deckIndex * rounds + round) * 60_000).toISOString(),
    })),
  ));
  await pool.query(
    `insert into learning_app.learning_sessions
      (id,child_id,assignment_id,deck_id,deck_version_id,policy_id,microphone_enabled,state,task_budget,started_at,ended_at,context)
     select id,child_id,assignment_id,deck_id,version_id,$2,true,'completed',${itemsPerDeck},started_at,started_at::timestamptz + interval '1 minute',jsonb_build_object('benchmarkRound',round)
       from jsonb_to_recordset($1::jsonb) as x(id uuid,child_id uuid,assignment_id uuid,deck_id uuid,version_id uuid,round int,started_at timestamptz)`,
    [JSON.stringify(sessions), CURRENT_POLICY_ID],
  );

  await pool.query(
    `insert into learning_app.session_tasks
      (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,context,issued_at)
     select gen_random_uuid(), s.id, s.child_id, s.deck_version_id, r.id, r.position,
       case ((r.position + (s.context->>'benchmarkRound')::int) % 5)
         when 0 then 'listening' when 1 then 'reading' when 2 then 'recall'
         when 3 then 'speech' else 'letter_completion' end,
       'answered',
       jsonb_build_object('target',r.payload->>'target','options',jsonb_build_array(jsonb_build_object('text','one'),jsonb_build_object('text','two'),jsonb_build_object('text','three'),jsonb_build_object('text','four'))),
       jsonb_build_object('target',r.payload->>'target'), s.context, s.started_at + r.position * interval '1 second'
       from learning_app.learning_sessions s
       join learning_app.item_revisions r on r.deck_version_id=s.deck_version_id`,
  );
  await pool.query(
    `insert into learning_app.attempts
      (id,child_id,task_id,item_revision_id,client_attempt_id,request_hash,attempt_number,modality,state,answer,context,policy_id,received_at)
     select gen_random_uuid(), t.child_id, t.id, t.item_revision_id, gen_random_uuid(), 'benchmark',1,
       case t.exercise_type when 'listening' then 'choice' when 'reading' then 'choice' when 'speech' then 'audio' else 'text' end,
       'processing', '{}'::jsonb, t.context, s.policy_id, t.issued_at
       from learning_app.session_tasks t join learning_app.learning_sessions s on s.id=t.session_id`,
  );
  await pool.query(
    `insert into learning_app.assessments
      (child_id,attempt_id,item_revision_id,skill,skill_version_id,outcome,independent,confirmation_eligible,details)
     select a.child_id,a.id,a.item_revision_id,skill_map.skill,irs.skill_version_id,
       case when t.ordinal % 2 = 0 then 'correct' else 'incorrect' end,
       true,false,'{}'::jsonb
       from learning_app.attempts a
       join learning_app.session_tasks t on t.id=a.task_id
       cross join lateral (select case t.exercise_type
         when 'listening' then 'listening' when 'reading' then 'reading' when 'recall' then 'recall'
         when 'speech' then 'pronunciation' else 'spelling' end as skill) skill_map
       join learning_app.item_revision_skills irs on irs.item_revision_id=t.item_revision_id and irs.skill=skill_map.skill`,
  );
  await pool.query("update learning_app.attempts set state='completed', completed_at=received_at from learning_app.session_tasks t where t.id=attempts.task_id");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into learning_app.learning_events
        (id,child_id,task_id,item_id,sealed,step_id,kind,occurred_at,context)
       select gen_random_uuid(),t.child_id,t.id,r.item_id,false,'benchmark:'||g::text,
         case when g=0 then 'audio_issued' else 'prompt_issued' end,
         t.issued_at + g * interval '1 millisecond','{}'::jsonb
         from learning_app.session_tasks t
         join learning_app.item_revisions r on r.id=t.item_revision_id
         cross join generate_series(0,${EVENTS_PER_TASK - 1}) g`,
    );
    await client.query(
      `insert into learning_app.event_exposures(child_id,event_id,target_key)
       select e.child_id,e.id,r.target_key from learning_app.learning_events e
         join learning_app.session_tasks t on t.id=e.task_id
         join learning_app.item_revisions r on r.id=t.item_revision_id`,
    );
    await client.query(
      `update learning_app.learning_events e set sealed=true
        from learning_app.session_tasks t where e.task_id=t.id and e.sealed=false`,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const revisionIds = (await pool.query<{ id: string }>(
    "select id from learning_app.item_revisions order by deck_version_id,position",
  )).rows.map((row) => row.id);
  if (deckIds.length !== deckCount || revisionIds.length !== deckCount * itemsPerDeck || childIds.length !== 2) {
    throw new Error("Profile navigation benchmark visible fixture size mismatch");
  }
  const counts = (await pool.query<{ assessments: number; events: number }>(
    `select (select count(*)::int from learning_app.assessments) as assessments,
            (select count(*)::int from learning_app.learning_events) as events`,
  )).rows[0]!;
  const expectedAssessments = deckCount * itemsPerDeck * childIds.length * rounds;
  const expectedEvents = expectedAssessments * EVENTS_PER_TASK;
  if (counts.assessments !== expectedAssessments || counts.events !== expectedEvents) {
    throw new Error("Profile navigation benchmark seed count mismatch");
  }
  return {
    services,
    childIds,
    deckIds,
    revisionIds,
    assessmentCount: counts.assessments,
    eventCount: counts.events,
    historyMultiplier,
  };
}
