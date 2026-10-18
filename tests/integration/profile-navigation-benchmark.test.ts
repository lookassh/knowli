import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  listKidDecks,
  rebuildProgress,
  readSkillHistories,
  skillHistoryKey,
} from "@learning/server";
import type { ExerciseType, History, Skill } from "../../packages/server/src/domain/types";
import { qualifyProjectionEvidence } from "../../packages/server/src/domain/projection-evidence";
import { childProfiles } from "../../packages/server/src/db/schema";
import { capturePoolQueries, testDatabase } from "./helpers";
import { seedProfileNavigationWorld } from "../fixtures/profile-navigation-world";

const benchmarkEnabled = process.env.UMIEM_NAV_BENCHMARK === "1";
const { pool } = testDatabase();

interface SampleSummary {
  samples: number;
  medianMs: number;
  p95Ms: number | null;
  maxMs: number;
  p95Method: "nearest-rank";
}

function summarizeMilliseconds(values: readonly number[], includeP95 = true): SampleSummary {
  if (values.length === 0) throw new Error("Cannot summarize an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  return {
    samples: sorted.length,
    medianMs: round(median),
    p95Ms: includeP95 ? round(sorted[Math.ceil(0.95 * sorted.length) - 1]!) : null,
    maxMs: round(sorted.at(-1)!),
    p95Method: "nearest-rank",
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

type Scope = { childId: string; skillVersionId: string; skill: Skill };

async function listScopes(childId: string): Promise<Scope[]> {
  const result = await pool.query<{ skill_version_id: string; skill: string }>(
    `select irs.skill_version_id,irs.skill from learning_app.item_revision_skills irs
      join learning_app.item_revisions r on r.id=irs.item_revision_id
      join learning_app.decks d on d.published_version_id=r.deck_version_id
      where d.published_version_id is not null order by r.deck_version_id,r.position,irs.skill`,
  );
  return result.rows.map((row) => ({ childId, skillVersionId: row.skill_version_id, skill: row.skill as Skill }));
}

interface LegacyHistoryRow {
  child_id: string;
  skill_version_id: string;
  skill: string;
  received_at: Date;
  policy_id: string;
  outcome: string;
  reason: string | null;
  independent: boolean;
  confirmation_eligible: boolean;
  details: Record<string, unknown>;
  attempt_id: string;
  exercise_type: string;
  public_prompt: { options?: { text?: string; labelPl?: string }[] } | null;
  task_id: string;
  audio_issued_before_answer: boolean;
}

/** Baseline query copied from git show 5356529: correlated audio EXISTS per assessment. */
interface QueryExecutor {
  query: typeof pool.query;
}

async function readLegacySkillHistories(
  scopes: readonly Scope[],
  executor: QueryExecutor = pool,
): Promise<ReadonlyMap<string, History>> {
  if (!scopes.length) return new Map();
  const values: string[] = [];
  const params: unknown[] = [];
  for (const scope of scopes) {
    const offset = params.length;
    params.push(scope.childId, scope.skillVersionId, scope.skill);
    values.push(`(a.child_id=$${offset + 1} and a.skill_version_id=$${offset + 2} and a.skill=$${offset + 3})`);
  }
  const rows = (await executor.query<LegacyHistoryRow>(
    `select a.child_id,a.skill_version_id,a.skill,at.received_at,at.policy_id,a.outcome,a.reason,
            a.independent,a.confirmation_eligible,a.details,at.id as attempt_id,st.exercise_type,
            st.public_prompt,at.task_id,
            exists (select 1 from learning_app.learning_events e
                     where e.task_id=at.task_id and e.kind='audio_issued' and e.sealed=true
                       and e.occurred_at<=at.received_at) as audio_issued_before_answer
       from learning_app.assessments a
       join learning_app.attempts at on at.id=a.attempt_id
       join learning_app.session_tasks st on st.id=at.task_id
      where ${values.join(" or ")}
      order by at.received_at,at.id`,
    params,
  )).rows;
  const histories = new Map<string, History>();
  for (const row of rows) {
    const skill = row.skill as Skill;
    const key = skillHistoryKey({ childId: row.child_id, skillVersionId: row.skill_version_id, skill });
    const entry = {
      receivedAt: row.received_at.toISOString(),
      policyVersion: row.policy_id,
      skill,
      outcome: row.outcome === "unassessed" ? "unevaluated" as const : row.outcome as "correct" | "incorrect",
      ...(row.reason === null ? {} : { reason: row.reason as NonNullable<History[number]["reason"]> }),
      independent: row.independent,
      confirmationEligible: row.confirmation_eligible,
      details: row.details,
    };
    const distinctChoiceCount = Array.isArray(row.public_prompt?.options)
      ? new Set(row.public_prompt.options.map((option) =>
          (option?.text ?? option?.labelPl ?? "").normalize("NFC").trim().toLocaleLowerCase(),
        )).size
      : null;
    const qualified = qualifyProjectionEvidence([{
      entry,
      exerciseType: row.exercise_type as ExerciseType,
      distinctChoiceCount,
      audioIssuedBeforeAnswer: row.audio_issued_before_answer,
    }])[0]!;
    histories.set(key, [...(histories.get(key) ?? []), qualified]);
  }
  return histories;
}

async function sampleLegacyWithoutIndex(scopes: readonly Scope[]): Promise<{
  status: "measured" | "timeout";
  stats: SampleSummary | null;
  queryCounts: number[];
  timeoutMs: 60_000;
}> {
  const client = await pool.connect();
  const indexQualified = "learning_app.learning_events_audio_task_occurred_idx";
  const indexBare = "learning_events_audio_task_occurred_idx";
  const times: number[] = [];
  const queryCounts: number[] = [];
  let dropped = false;
  let timedOut = false;
  try {
    await client.query(`drop index if exists ${indexQualified}`);
    dropped = true;
    for (let index = 0; index < 3; index += 1) {
      await client.query("begin");
      try {
        await client.query("set local statement_timeout = '60s'");
        const run = await timeOnce(() => readLegacySkillHistories(scopes, client));
        times.push(run.milliseconds);
        queryCounts.push(1);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        if ((error as { code?: string }).code === "57014") {
          timedOut = true;
          break;
        }
        throw error;
      }
    }
  } finally {
    try {
      if (dropped) {
        await client.query(`create index if not exists ${indexBare} on learning_app.learning_events (task_id, occurred_at) where kind = 'audio_issued' and sealed = true`);
      }
    } finally {
      client.release();
    }
  }
  return {
    status: timedOut ? "timeout" : "measured",
    stats: times.length ? summarizeMilliseconds(times, false) : null,
    queryCounts: [...new Set(queryCounts)].sort((a, b) => a - b),
    timeoutMs: 60_000,
  };
}

async function persistReports(reports: readonly unknown[]): Promise<string> {
  const runId = process.env.UMIEM_TEST_RUN_ID ?? "local";
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Unsafe benchmark run id");
  const directory = join(process.cwd(), "test-results");
  const file = join(directory, `profile-navigation-benchmark-${runId}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(reports, null, 2)}\n`, "utf8");
  return file;
}

function normalizedHistories(scopes: readonly Scope[], histories: ReadonlyMap<string, History>): unknown[] {
  return scopes.map((scope) => {
    const key = skillHistoryKey(scope);
    const entries = [...(histories.get(key) ?? [])].map((entry) => JSON.stringify(entry)).sort();
    return [key, entries];
  });
}

async function captureQueries<T>(operation: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const captured = await capturePoolQueries(pool, operation);
  return { result: captured.value, queries: captured.queries.length };
}

async function timeOnce<T>(operation: () => Promise<T>): Promise<{ milliseconds: number; queries: number; result: T }> {
  const start = performance.now();
  const captured = await captureQueries(operation);
  return { milliseconds: performance.now() - start, queries: captured.queries, result: captured.result };
}

async function sample<T>(operation: () => Promise<T>): Promise<{
  coldMs: number;
  stats: SampleSummary;
  queryCounts: number[];
}> {
  const cold = await timeOnce(operation);
  for (let index = 0; index < 5; index += 1) await operation();
  const runs: Array<{ milliseconds: number; queries: number }> = [];
  for (let index = 0; index < 30; index += 1) {
    const run = await timeOnce(operation);
    runs.push({ milliseconds: run.milliseconds, queries: run.queries });
  }
  return {
    coldMs: round(cold.milliseconds),
    stats: summarizeMilliseconds(runs.map((run) => run.milliseconds)),
    queryCounts: [...new Set(runs.map((run) => run.queries))].sort((a, b) => a - b),
  };
}

describe("profile navigation benchmark helpers", () => {
  it("przechwytuje po jednym SELECT z pool.query i transakcji oraz przywraca klienta po błędzie", async () => {
    const client = await pool.connect();
    const originalClientQuery = client.query;
    client.release();
    const originalConnect = pool.connect;
    const selects: string[] = [];
    const failure = new Error("capture cleanup fixture");
    await expect(capturePoolQueries(pool, async () => {
      await pool.query("select 1");
      await testDatabase().db.transaction((tx) => tx.select({ id: childProfiles.id }).from(childProfiles).limit(1));
      throw failure;
    }, (statement) => {
      if (/^\s*select\b/i.test(statement)) selects.push(statement);
      return true;
    })).rejects.toBe(failure);
    expect(selects).toHaveLength(2);
    expect(pool.connect).toBe(originalConnect);
    const reused = await pool.connect();
    expect(reused).toBe(client);
    expect(reused.query).toBe(originalClientQuery);
    reused.release();
  });

  it("uses median and nearest-rank p95 and omits p95 for undersized legacy samples", () => {
    expect(summarizeMilliseconds([9, 1, 5, 3, 7])).toEqual({
      samples: 5, medianMs: 5, p95Ms: 9, maxMs: 9, p95Method: "nearest-rank",
    });
    expect(summarizeMilliseconds([9, 1, 5], false)).toEqual({
      samples: 3, medianMs: 5, p95Ms: null, maxMs: 9, p95Method: "nearest-rank",
    });
  });

  it("seeds a small published world and returns the same history in both readers", async () => {
    const world = await seedProfileNavigationWorld({
      historyMultiplier: 1,
      deckCount: 1,
      itemsPerDeck: 2,
      roundsPerChildDeck: 1,
    });
    const scopes = await listScopes(world.childIds[0]);
    const current = await readSkillHistories(world.services.db, scopes);
    const legacy = await readLegacySkillHistories(scopes);
    expect(world).toMatchObject({ assessmentCount: 4, eventCount: 20 });
    expect(world.deckIds).toHaveLength(1);
    expect(world.revisionIds).toHaveLength(2);
    expect(normalizedHistories(scopes, current)).toEqual(normalizedHistories(scopes, legacy));
    const listRead = await captureQueries(() => listKidDecks(world.services, world.childIds[0]!));
    expect(listRead.result).toHaveLength(1);
    expect(listRead.queries).toBeGreaterThan(0);
  }, 180_000);

  it("rebuild naprawia dokładnie fakty projekcji i kolejny apply nie zmienia żadnego wiersza", async () => {
    const world = await seedProfileNavigationWorld({
      historyMultiplier: 1, deckCount: 1, itemsPerDeck: 5, roundsPerChildDeck: 1,
    });
    const childId = world.childIds[0]!;
    await rebuildProgress(world.services, { childId, apply: true });
    const readFacts = async () => (await pool.query<{
      has_qualifying_assessment: boolean; first_issued_at: Date | null; last_reviewed_at: Date | null;
    }>(
      `select policy_id, skill_version_id, status, independent_success_streak,
              last_reviewed_at, next_review_at, delayed_confirmation_at, first_issued_at,
              has_qualifying_assessment, projection_version
         from learning_app.child_skill_progress where child_id = $1
         order by policy_id, skill_version_id`, [childId],
    )).rows;
    const expected = await readFacts();
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some((row) => row.has_qualifying_assessment === false)).toBe(true);
    expect(expected.some((row) => row.first_issued_at !== null)).toBe(true);
    expect(expected.some((row) => row.last_reviewed_at === null)).toBe(true);
    await pool.query(`update learning_app.child_skill_progress
      set first_issued_at='2000-01-01T00:00:00Z', last_reviewed_at='2030-01-01T00:00:00Z',
          delayed_confirmation_at='2030-01-01T00:00:00Z', has_qualifying_assessment=true
      where child_id=$1`, [childId]);
    const repaired = await rebuildProgress(world.services, { childId, apply: true });
    expect(repaired.updated).toBeGreaterThan(0);
    expect(await readFacts()).toEqual(expected);
    const second = await rebuildProgress(world.services, { childId, apply: true });
    expect(second).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
  }, 180_000);
});

describe.skipIf(!benchmarkEnabled)("profile navigation opt-in benchmark", () => {
  it("measures baseline fixture (10,000 assessments, 50,000 events)", async () => {
    const world = await seedProfileNavigationWorld({ historyMultiplier: 1 });
    const pg = (await pool.query<{ version: string; jit: string }>(
      "select version() as version,current_setting('jit') as jit",
    )).rows[0]!;
    const scopes = await listScopes(world.childIds[0]);
    for (const childId of world.childIds) {
      await rebuildProgress(world.services, { childId, apply: true });
    }
    const current = await readSkillHistories(world.services.db, scopes);
    const legacy = await readLegacySkillHistories(scopes);
    expect(normalizedHistories(scopes, current)).toEqual(normalizedHistories(scopes, legacy));

    const currentReader = await sample(() => readSkillHistories(world.services.db, scopes));
    const legacyCold = await timeOnce(() => readLegacySkillHistories(scopes));
    const legacyRuns = [legacyCold, await timeOnce(() => readLegacySkillHistories(scopes)), await timeOnce(() => readLegacySkillHistories(scopes))];
    expect(normalizedHistories(scopes, legacyRuns[0]!.result)).toEqual(normalizedHistories(scopes, current));
    const list = await sample(() => listKidDecks(world.services, world.childIds[0]));
    const legacyUnindexed = await sampleLegacyWithoutIndex(scopes);

    const report = {
      historyMultiplier: 1,
      code: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      postgres: pg.version.split("\n")[0],
      jit: pg.jit,
      fixture: {
        children: world.childIds.length,
        decks: world.deckIds.length,
        revisions: world.revisionIds.length,
        assessments: world.assessmentCount,
        events: world.eventCount,
        readerScopes: scopes.length,
      },
      currentReader,
      legacyReader: {
        coldMs: round(legacyCold.milliseconds),
        stats: summarizeMilliseconds(legacyRuns.map((run) => run.milliseconds), false),
        p95OmittedReason: "3 samples; report median and maximum only",
        queryCounts: [...new Set(legacyRuns.map((run) => run.queries))].sort((a, b) => a - b),
      },
      legacyUnindexed,
      listKidDecks: list,
    };
    const reportPath = await persistReports([report]);
    process.stderr.write(`[profile-navigation-benchmark] results written to ${reportPath}\n`);
  }, 300_000);

  it("measures 10x scale fixture (100,000 assessments, 500,000 events)", async () => {
    const world = await seedProfileNavigationWorld({ historyMultiplier: 10 });
    const pg = (await pool.query<{ version: string; jit: string }>(
      "select version() as version,current_setting('jit') as jit",
    )).rows[0]!;
    const scopes = await listScopes(world.childIds[0]);
    for (const childId of world.childIds) {
      await rebuildProgress(world.services, { childId, apply: true });
    }
    const current = await readSkillHistories(world.services.db, scopes);
    const legacy = await readLegacySkillHistories(scopes);
    expect(normalizedHistories(scopes, current)).toEqual(normalizedHistories(scopes, legacy));

    const currentReader = await sample(() => readSkillHistories(world.services.db, scopes));
    const legacyCold = await timeOnce(() => readLegacySkillHistories(scopes));
    const legacyRuns = [legacyCold, await timeOnce(() => readLegacySkillHistories(scopes)), await timeOnce(() => readLegacySkillHistories(scopes))];
    expect(normalizedHistories(scopes, legacyRuns[0]!.result)).toEqual(normalizedHistories(scopes, current));
    const list = await sample(() => listKidDecks(world.services, world.childIds[0]));

    const report = {
      historyMultiplier: 10,
      code: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      postgres: pg.version.split("\n")[0],
      jit: pg.jit,
      fixture: {
        children: world.childIds.length,
        decks: world.deckIds.length,
        revisions: world.revisionIds.length,
        assessments: world.assessmentCount,
        events: world.eventCount,
        readerScopes: scopes.length,
      },
      currentReader,
      legacyReader: {
        coldMs: round(legacyCold.milliseconds),
        stats: summarizeMilliseconds(legacyRuns.map((run) => run.milliseconds), false),
        p95OmittedReason: "3 samples; report median and maximum only",
        queryCounts: [...new Set(legacyRuns.map((run) => run.queries))].sort((a, b) => a - b),
      },
      legacyUnindexed: null,
      listKidDecks: list,
    };
    const reportPath = await persistReports([report]);
    process.stderr.write(`[profile-navigation-benchmark] results written to ${reportPath}\n`);
  }, 1_800_000);
});

afterAll(async () => {
  await pool.end();
});
