import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createChild, createDraft, createServices, ensureLearningPolicy, migrateDatabase, publishDraft, upsertAssignment } from "@learning/server";
import { ManualClock, openQuietDatabase, testDatabaseUrl, waitForDatabaseIdle } from "./helpers";

const migrationsFolder = path.resolve("packages/server/drizzle");
const adminPool = openQuietDatabase(testDatabaseUrl()).pool;
afterAll(async () => { await adminPool.end(); });

/**
 * Migracja 0021 (spec client-reward-time): przeniesienie dorobku punktowego do
 * profili, oznaczenie legacy sesji jako wygasłych i usunięcie 10 tabel
 * nagrodowych — na prywatnej bazie migracji, bez produkcyjnego DROP.
 */

const DROPPED_TABLES = [
  "reward_activity_xbox_requests",
  "reward_activity_xbox_blocks",
  "reward_activity_segments",
  "reward_activity_pauses",
  "reward_activity_playback_authorizations",
  "reward_activity_streams",
  "reward_activity_settlements",
  "deck_reward_projection",
  "reward_day_projection",
  "child_reward_projection",
];

async function prepareLegacyDatabase(temporaryFolder: string, sliceEntries: number): Promise<string> {
  const databaseName = `session_activity_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(testDatabaseUrl());
  databaseUrl.pathname = `/${databaseName}`;
  const fullJournal = JSON.parse(await readFile(path.join(migrationsFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const legacyEntries = fullJournal.entries.slice(0, sliceEntries);
  const legacyFolder = path.join(temporaryFolder, `legacy-${databaseName}`);
  await mkdir(path.join(legacyFolder, "meta"), { recursive: true });
  await writeFile(path.join(legacyFolder, "meta/_journal.json"), JSON.stringify({ ...fullJournal, entries: legacyEntries }));
  for (const { tag } of legacyEntries) await copyFile(path.join(migrationsFolder, `${tag}.sql`), path.join(legacyFolder, `${tag}.sql`));
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  await migrateDatabase(databaseUrl.toString(), legacyFolder);
  return databaseUrl.toString();
}

async function seedLegacyRewardState(databaseUrl: string): Promise<{ childId: string }> {
  const { db, pool } = openQuietDatabase(databaseUrl);
  const clock = new ManualClock("2026-10-16T10:00:00.000Z");
  const services = createServices({ db, clock });
  try {
    await pool.query("alter table learning_app.decks add column session_task_budget integer not null default 20");
    // Bieżący kod TS wstawia także kolumny nagrodowe profili z 0021; dodajemy
    // je tylko na czas seedu i usuwamy przed pełną migracją, by 0021 przeszedł
    // dokładnie jak w produkcji.
    await pool.query("alter table learning_app.child_profiles add column reward_points integer not null default 0");
    await pool.query("alter table learning_app.child_profiles add column reward_remainder_ms integer not null default 0");
    await ensureLearningPolicy(db);
    const child = await createChild(services, { displayName: "Ola", avatarKey: "fox" });
    const draft = await createDraft(services, { title: "Migration 0021", items: [{
      source: "kot", target: "cat", acceptedAnswers: [], locales: { source: "pl-PL", target: "en-GB" }, visualType: "none",
    }] });
    const revisionId = (await pool.query("select id from learning_app.item_revisions where deck_version_id=$1", [draft.id])).rows[0].id as string;
    const assetId = randomUUID();
    const fingerprint = `migration-${randomUUID()}`;
    await pool.query(`insert into learning_app.media_assets
      (id,kind,fingerprint,generation_number,state,storage_key,content_sha256,mime_type,byte_count,provider,model,metadata)
      values ($1,'tts',$2,1,'ready',$3,$4,'audio/mpeg',100,'fake','fake','{"durationMs":20000}'::jsonb)`,
    [assetId, fingerprint, `blob/${assetId}`, `sha-${assetId}`]);
    await pool.query(`insert into learning_app.revision_assets (item_revision_id,role,asset_id,expected_fingerprint,state)
      values ($1,'target_audio',$2,$3,'approved'), ($1,'illustration',null,'omit-test','omitted')`, [revisionId, assetId, fingerprint]);
    await publishDraft(services, draft.id, 1);
    await upsertAssignment(services, child.id, draft.deckId, null);
    const assignmentId = (await pool.query("select id from learning_app.assignments where child_id=$1 and deck_id=$2", [child.id, draft.deckId])).rows[0].id as string;
    const sessionId = randomUUID();
    await pool.query(`insert into learning_app.learning_sessions
      (id,child_id,assignment_id,deck_id,deck_version_id,policy_id,microphone_enabled,mode,daily_round_date,mock_test_plan,state,task_budget,started_at,ended_at,context)
      values ($1,$2,$3,$4,$5,'learning-v2',false,'training',null,null,'ended',12,$6,$6,$7::jsonb)`,
    [sessionId, child.id, assignmentId, draft.deckId, draft.id, clock.now(), JSON.stringify({ timezone: "Europe/Warsaw", summary: { reward: { creditedSeconds: 90, pointsEarned: 1 }, sessionId, state: "ended", tasksIssued: 1, assessedTasksIssued: 1, endedAt: clock.now().toISOString(), independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [] } })]);
    const taskId = randomUUID();
    await pool.query(`insert into learning_app.session_tasks
      (id,session_id,child_id,deck_version_id,item_revision_id,ordinal,exercise_type,state,public_prompt,answer_key,context,issued_at)
      values ($1,$2,$3,$4,$5,0,'exposure','completed','{}','{}','{}',$6)`,
    [taskId, sessionId, child.id, draft.id, revisionId, clock.now()]);
    const settlementId = randomUUID();
    await pool.query(`insert into learning_app.reward_activity_settlements
      (id,child_id,session_id,task_id,completion_ref,kind,settled_at,deck_id,credited_milliseconds,awarded_points,remainder_milliseconds,timezone)
      values ($1,$2,$3,$4,$5,'attempt',$6,$7,90000,7,40000,'Europe/Warsaw')`,
    [settlementId, child.id, sessionId, taskId, randomUUID(), clock.now(), draft.deckId]);
    await pool.query(`insert into learning_app.child_reward_projection
      (child_id,earned_points,credited_milliseconds,remainder_milliseconds,qualified_packs,consumed_packs)
      values ($1,7,90000,40000,0,2)`, [child.id]);
    await pool.query(`insert into learning_app.deck_reward_projection (child_id,deck_id,earned_points) values ($1,$2,7)`, [child.id, draft.deckId]);
    await pool.query(`insert into learning_app.reward_day_projection (child_id,timezone,local_date,credited_milliseconds) values ($1,'Europe/Warsaw','2026-10-16',90000)`, [child.id]);
    await pool.query("alter table learning_app.decks drop column session_task_budget");
    await pool.query("alter table learning_app.child_profiles drop column reward_points");
    await pool.query("alter table learning_app.child_profiles drop column reward_remainder_ms");
    return { childId: child.id };
  } finally {
    await pool.end();
  }
}

async function dropDatabase(databaseUrl: string): Promise<void> {
  const name = new URL(databaseUrl).pathname.replace("/", "");
  const closer = openQuietDatabase(databaseUrl);
  await closer.pool.end();
  await waitForDatabaseIdle(adminPool, name);
  await adminPool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
}

describe("session activity migration 0021", () => {
  it("keeps earned points, marks legacy sessions expired and drops the ten reward tables", async () => {
    const temporaryFolder = await mkdtemp(path.join(tmpdir(), "knowli-session-activity-"));
    let databaseUrl: string | undefined;
    try {
      databaseUrl = await prepareLegacyDatabase(temporaryFolder, 20);
      const { childId } = await seedLegacyRewardState(databaseUrl);
      // Pełny dziennik (z 0021) na tej samej bazie.
      await migrateDatabase(databaseUrl, migrationsFolder);
      const verify = openQuietDatabase(databaseUrl);
      try {
        // Dorobek: pełne earned_points (nie saldo po Xbox — consumedPacks nie odejmuje).
        const profile = (await verify.pool.query("select reward_points, reward_remainder_ms from learning_app.child_profiles where id=$1", [childId])).rows[0]!;
        expect(profile.reward_points).toBe(7);
        expect(profile.reward_remainder_ms).toBe(40_000);
        // Pola nagrodowe usunięte z NIEchronionego context.summary (wynik wiedzy zostaje).
        const context = (await verify.pool.query("select context->'summary' as summary from learning_app.learning_sessions limit 1")).rows[0].summary;
        expect(context).not.toHaveProperty("reward");
        expect(context).toHaveProperty("independentSuccesses");
        // Legacy sesje dostają przeszły termin → nowy mechanizm ich nie rozlicza.
        const expiry = (await verify.pool.query("select activity_report_expires_at <= now() as expired from learning_app.learning_sessions")).rows[0];
        expect(expiry.expired).toBe(true);
        // 10 tabel nagrodowych nie istnieje.
        for (const table of DROPPED_TABLES) {
          const exists = (await verify.pool.query("select to_regclass($1) as reg", [`learning_app.${table}`])).rows[0].reg;
          expect(exists, table).toBeNull();
        }
      } finally {
        await verify.pool.end();
      }
    } finally {
      if (databaseUrl) await dropDatabase(databaseUrl).catch(() => undefined);
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  });

  it("aborts before dropping anything when the ledger and projection disagree", async () => {
    const temporaryFolder = await mkdtemp(path.join(tmpdir(), "knowli-session-activity-mismatch-"));
    let databaseUrl: string | undefined;
    try {
      databaseUrl = await prepareLegacyDatabase(temporaryFolder, 20);
      const { childId } = await seedLegacyRewardState(databaseUrl);
      // Rozjazd PER DZIECKO o przeciwstawnych znakach: globalne sumy się znoszą
      // (ledger 7+12 = 19 = projekcja 2+17), więc stara globalna kontrola by
      // przeszła — per-dziecko musi przerwać migrację PRZED DROP (D02).
      const tamper = openQuietDatabase(databaseUrl);
      await tamper.pool.query("update learning_app.child_reward_projection set earned_points = 2 where child_id=$1", [childId]);
      const otherChild = randomUUID();
      await tamper.pool.query("insert into learning_app.child_profiles (id, display_name, avatar_key, can_read) values ($1, 'Ewa', 'bear', true)", [otherChild]);
      // Własne przypisanie/sesja/zadanie drugiego dziecka, żeby settlement spełniał FK.
      const otherAssignment = randomUUID();
      const otherSession = randomUUID();
      const otherTask = randomUUID();
      await tamper.pool.query(`insert into learning_app.assignments (id, child_id, deck_id, test_date, mock_test_task_count, active)
        select $1, $2, deck_id, test_date, mock_test_task_count, active from learning_app.assignments where child_id=$3 limit 1`,
      [otherAssignment, otherChild, childId]);
      await tamper.pool.query(`insert into learning_app.learning_sessions
        (id, child_id, assignment_id, deck_id, deck_version_id, policy_id, microphone_enabled, mode, daily_round_date,
         mock_test_plan, state, task_budget, started_at, ended_at, context)
        select $1, $2, $3, deck_id, deck_version_id, policy_id, microphone_enabled, mode, daily_round_date,
         mock_test_plan, state, task_budget, started_at, ended_at, context
        from learning_app.learning_sessions where child_id=$4 limit 1`,
      [otherSession, otherChild, otherAssignment, childId]);
      await tamper.pool.query(`insert into learning_app.session_tasks
        (id, session_id, child_id, deck_version_id, item_revision_id, ordinal, exercise_type, state, public_prompt, answer_key, context, issued_at)
        select $1, $2, $3, deck_version_id, item_revision_id, ordinal, exercise_type, state, public_prompt, answer_key, context, issued_at
        from learning_app.session_tasks where child_id=$4 limit 1`,
      [otherTask, otherSession, otherChild, childId]);
      await tamper.pool.query(`insert into learning_app.reward_activity_settlements
        (id,child_id,session_id,task_id,completion_ref,kind,settled_at,deck_id,credited_milliseconds,awarded_points,remainder_milliseconds,timezone)
        values ($1,$2,$3,$4,$5,'attempt',now(),(select deck_id from learning_app.learning_sessions where id=$3),0,12,0,'Europe/Warsaw')`,
      [randomUUID(), otherChild, otherSession, otherTask, randomUUID()]);
      await tamper.pool.query(`insert into learning_app.child_reward_projection
        (child_id,earned_points,credited_milliseconds,remainder_milliseconds,qualified_packs,consumed_packs)
        values ($1,17,0,0,0,0)`, [otherChild]);
      await tamper.pool.end();
      await expect(migrateDatabase(databaseUrl, migrationsFolder)).rejects.toThrow(/differ from projection points/i);
      // Kontrolowany błąd PRZED DROP: tabele i dane wciąż istnieją.
      const verify = openQuietDatabase(databaseUrl);
      try {
        // Migracja wycofana w całości (jedna transakcja): tabele istnieją,
        // profil nie dostał nowych kolumn ani dorobku.
        const projection = (await verify.pool.query("select count(*)::int as count from learning_app.child_reward_projection")).rows[0].count;
        expect(projection).toBe(2);
        const columns = (await verify.pool.query("select count(*)::int as count from information_schema.columns where table_name='child_profiles' and column_name in ('reward_points','reward_remainder_ms')")).rows[0].count;
        expect(columns).toBe(0);
      } finally {
        await verify.pool.end();
      }
    } finally {
      if (databaseUrl) await dropDatabase(databaseUrl).catch(() => undefined);
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  });
});
