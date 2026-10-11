import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  REPORT_SKILLS,
  UuidSchema,
  type ActivitySummaryDto,
  type ConfusionDto,
  type HistoryEntryDto,
  type ItemSkillStatus,
  type ProgressDto,
  type ProgressItemDto,
  type PronunciationScoreDto,
  type ReportSkill,
  type SkillReportDto,
} from "@learning/contracts";
import type { Services } from "../config";
import {
  assignments,
  childProfiles,
  childSkillProgress,
  decks,
  deckVersions,
  itemRevisions,
  itemRevisionSkills,
  skillVersions,
} from "../db/schema";
import { AppError } from "../errors";
import { SESSION_TIME_LIMIT_MS } from "./sessions";

/**
 * Panel postępów rodzica (SPEC §25). Zwięzłe zapytania odczytują projekcję
 * child_skill_progress (cache aktualnego wyniku) oraz oceny i próby dziecka
 * w obrębie jednego zestawu. Nie przepisujemy historii: raport jest widokiem.
 */

/** Mapowanie statusów bazy na wartości raportu (zgodne z projekcją zadań 5–8). */
function reportStatus(dbStatus: string): ItemSkillStatus {
  switch (dbStatus) {
    case "mastered":
    case "needs_confirmation":
    case "needs_reconfirmation":
    case "practicing":
      return dbStatus;
    default:
      return "not_assessed";
  }
}

interface RevisionRow {
  id: string;
  itemId: string;
  position: number;
  payload: Record<string, unknown>;
}

function wordsOf(payload: Record<string, unknown>): { source: string; target: string } {
  return {
    source: typeof payload.source === "string" ? payload.source : "",
    target: typeof payload.target === "string" ? payload.target : "",
  };
}

/** Statusy wszystkich rewizji zestawu (także starszych wersji). */
async function deckRevisionIds(services: Services, deckId: string): Promise<string[]> {
  const rows = await services.db
    .select({ id: itemRevisions.id })
    .from(itemRevisions)
    .innerJoin(deckVersions, eq(deckVersions.id, itemRevisions.deckVersionId))
    .where(eq(deckVersions.deckId, deckId));
  return rows.map((row) => row.id);
}

export async function getProgress(services: Services, childId: string, deckId: string): Promise<ProgressDto> {
  const child = UuidSchema.parse(childId);
  const deck = UuidSchema.parse(deckId);

  const profile = (
    await services.db
      .select({ id: childProfiles.id, displayName: childProfiles.displayName })
      .from(childProfiles)
      .where(eq(childProfiles.id, child))
  )[0];
  const deckRow = (await services.db.select().from(decks).where(eq(decks.id, deck)))[0];
  if (!profile || !deckRow || !deckRow.publishedVersionId) {
    throw new AppError("not_found");
  }
  const version = (
    await services.db.select({ title: deckVersions.title }).from(deckVersions).where(eq(deckVersions.id, deckRow.publishedVersionId))
  )[0];

  // elementy opublikowanej wersji w kolejności zestawu
  const revisions = (await services.db
    .select({
      id: itemRevisions.id,
      itemId: itemRevisions.itemId,
      position: itemRevisions.position,
      payload: itemRevisions.payload,
    })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, deckRow.publishedVersionId))
    .orderBy(asc(itemRevisions.position))) as RevisionRow[];

  // klucze umiejętności bieżącej wersji + wszystkie wersje kluczy elementów
  const revisionIds = revisions.map((r) => r.id);
  const skillLinks = revisionIds.length
    ? await services.db
        .select({
          itemRevisionId: itemRevisionSkills.itemRevisionId,
          skill: itemRevisionSkills.skill,
          skillVersionId: itemRevisionSkills.skillVersionId,
        })
        .from(itemRevisionSkills)
        .where(inArray(itemRevisionSkills.itemRevisionId, revisionIds))
    : [];
  const versionByRevision = new Map(skillLinks.map((l) => [`${l.itemRevisionId}:${l.skill}`, l.skillVersionId]));

  const itemIds = [...new Set(revisions.map((r) => r.itemId))];
  const versions = itemIds.length
    ? await services.db
        .select({ id: skillVersions.id, predecessorId: skillVersions.predecessorId })
        .from(skillVersions)
        .where(inArray(skillVersions.itemId, itemIds))
    : [];
  const predecessorOf = new Map(versions.map((v) => [v.id, v.predecessorId]));

  const progressRows = await services.db
    .select({ skillVersionId: childSkillProgress.skillVersionId, status: childSkillProgress.status })
    .from(childSkillProgress)
    .where(eq(childSkillProgress.childId, child));
  const statusOfVersion = new Map(progressRows.map((p) => [p.skillVersionId, reportStatus(p.status)]));

  /**
   * Status umiejętności elementu: projekcja bieżącego klucza; bez własnych ocen
   * — jeżeli poprzednia wersja klucza (łańcuch predecessorów) miała wynik,
   * zmiana materiału wymaga ponownego sprawdzenia (SPEC §90–91), bez kasowania
   * historii i bez zaliczania nowego klucza jako opanowanego.
   */
  const statusFor = (skillVersionId: string): { status: ItemSkillStatus; changed: boolean } => {
    const own = statusOfVersion.get(skillVersionId);
    if (own && own !== "not_assessed") {
      return { status: own, changed: false };
    }
    let ancestor = predecessorOf.get(skillVersionId) ?? null;
    while (ancestor !== null) {
      const ancestorStatus = statusOfVersion.get(ancestor);
      if (ancestorStatus && ancestorStatus !== "not_assessed") {
        return { status: "needs_confirmation", changed: true };
      }
      ancestor = predecessorOf.get(ancestor) ?? null;
    }
    return { status: "not_assessed", changed: false };
  };

  const items: ProgressItemDto[] = revisions.map((revision) => {
    const skills = {} as Record<ReportSkill, ItemSkillStatus>;
    let meaningChanged = false;
    for (const skill of REPORT_SKILLS) {
      const skillVersionId = versionByRevision.get(`${revision.id}:${skill}`);
      const resolved = skillVersionId ? statusFor(skillVersionId) : { status: "not_assessed" as const, changed: false };
      skills[skill] = resolved.status;
      meaningChanged ||= resolved.changed;
    }
    return {
      itemId: revision.itemId,
      position: revision.position,
      ...wordsOf(revision.payload),
      skills,
      meaningChanged,
    };
  });

  const counters: Record<ItemSkillStatus, number> = {
    mastered: 0,
    needs_confirmation: 0,
    needs_reconfirmation: 0,
    practicing: 0,
    not_assessed: 0,
  };
  const summary: SkillReportDto[] = REPORT_SKILLS.map((skill) => {
    for (const status of Object.keys(counters) as ItemSkillStatus[]) {
      counters[status] = 0;
    }
    for (const item of items) {
      counters[item.skills[skill]] += 1;
    }
    return {
      skill,
      totalItems: items.length,
      mastered: counters.mastered,
      needsConfirmation: counters.needs_confirmation,
      needsReconfirmation: counters.needs_reconfirmation,
      practicing: counters.practicing,
      notAssessed: counters.not_assessed,
    };
  });

  const assignment = (
    await services.db
      .select({ testDate: assignments.testDate })
      .from(assignments)
      .where(and(eq(assignments.childId, child), eq(assignments.deckId, deck)))
  )[0];

  const allRevisionIds = await deckRevisionIds(services, deck);
  const { confusions, pronunciationScores, history } = allRevisionIds.length
    ? await readChildEvidence(services, child, allRevisionIds)
    : { confusions: [] as ConfusionDto[], pronunciationScores: [] as PronunciationScoreDto[], history: [] as HistoryEntryDto[] };

  return {
    childId: child,
    childName: profile.displayName,
    deckId: deck,
    deckTitle: version?.title ?? deckRow.title,
    testDate: assignment?.testDate ?? null,
    totalItems: items.length,
    skills: summary,
    items,
    confusions,
    pronunciation: {
      assessed: pronunciationScores.length > 0,
      latestScores: pronunciationScores,
    },
    history,
    activity: await readActivitySummary(services, child),
  };
}

/** Okno karty aktywności (SPEC §25) i bufor nad obcięciem czasu sesji. */
const ACTIVITY_WINDOW_DAYS = 7;
const ACTIVITY_SESSION_CAP_MS = SESSION_TIME_LIMIT_MS + 60_000;

/** Dni kalendarzowe aktywności liczymy w strefie czasowej rodziny. */
const ACTIVITY_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// MVP: jedna polska rodzina. Docelowo strefa z family_settings.timezone
// (helper readTimezone w sessions.ts) przy pierwszej rodzinie spoza Polski.

type ActivitySessionRow = {
  deckId: string;
  deckTitle: string;
  startedAt: Date;
  lastActivity: Date;
};

/**
 * Karta aktywności: okno 7 dni od teraz wg zegara usług. Czas nauki sesji
 * to started_at → ostatnia aktywność (zadania, zdarzenia, próby) obcięty
 * do limitu sesji, więc późne zamknięcie porzuconej sesji nie zawyża czasu.
 * Interakcje liczą zdarzenia serwera i obserwacje klienta; rejestr kontaktu
 * (`contact`) nie jest działaniem dziecka.
 */
async function readActivitySummary(services: Services, childId: string): Promise<ActivitySummaryDto> {
  const since = new Date(services.clock.now().getTime() - ACTIVITY_WINDOW_DAYS * 24 * 3_600_000);

  const sessions = (
    await services.db.execute<ActivitySessionRow>(sql`
      with window_sessions as (
        select s.id, s.deck_id, coalesce(v.title, d.title) as title, s.started_at
          from learning_app.learning_sessions s
          join learning_app.decks d on d.id = s.deck_id
          left join learning_app.deck_versions v on v.id = d.published_version_id
         where s.child_id = ${childId}
           and s.started_at >= ${since}
      ), last_touch as (
        select session_id, max(at) as last_at from (
          select t.session_id, t.issued_at as at
            from learning_app.session_tasks t
           where t.session_id in (select id from window_sessions)
          union all
          select st.session_id, e.occurred_at as at
            from learning_app.learning_events e
            join learning_app.session_tasks st on st.id = e.task_id
           where st.session_id in (select id from window_sessions)
          union all
          select st.session_id, a.received_at as at
            from learning_app.attempts a
            join learning_app.session_tasks st on st.id = a.task_id
           where st.session_id in (select id from window_sessions)
        ) marks
        group by session_id
      )
      select ws.deck_id as "deckId",
             ws.title as "deckTitle",
             ws.started_at as "startedAt",
             coalesce(lt.last_at, ws.started_at) as "lastActivity"
        from window_sessions ws
        left join last_touch lt on lt.session_id = ws.id
    `)
  ).rows;

  const activeMs = sessions.reduce((total, row) => {
    const duration = Math.min(
      new Date(row.lastActivity).getTime() - new Date(row.startedAt).getTime(),
      ACTIVITY_SESSION_CAP_MS,
    );
    return total + Math.max(0, duration);
  }, 0);

  const deckTotals = new Map<string, { deckTitle: string; sessions: number }>();
  for (const row of sessions) {
    const current = deckTotals.get(row.deckId) ?? { deckTitle: row.deckTitle, sessions: 0 };
    current.sessions += 1;
    deckTotals.set(row.deckId, current);
  }

  const answers = (
    await services.db.execute<{ count: number }>(sql`
      select count(*)::int as count
        from learning_app.attempts
       where child_id = ${childId} and received_at >= ${since}
    `)
  ).rows[0]!.count;

  const interactions = (
    await services.db.execute<{ count: number }>(sql`
      select count(*)::int as count
        from learning_app.learning_events
       where child_id = ${childId} and occurred_at >= ${since} and kind <> 'contact'
    `)
  ).rows[0]!.count;

  return {
    days: ACTIVITY_WINDOW_DAYS,
    activeSeconds: Math.round(activeMs / 1000),
    activeDays: new Set(sessions.map((row) => ACTIVITY_DAY_FORMAT.format(new Date(row.startedAt)))).size,
    sessions: sessions.length,
    answers,
    interactions,
    decks: [...deckTotals.entries()]
      .map(([deckId, stat]) => ({ deckId, deckTitle: stat.deckTitle, sessions: stat.sessions }))
      .sort((a, b) => b.sessions - a.sessions || a.deckTitle.localeCompare(b.deckTitle, "pl")),
  };
}

/** Pomyłki, wyniki wymowy i historia prób dziecka w obrębie rewizji zestawu. */
async function readChildEvidence(
  services: Services,
  childId: string,
  revisionIds: string[],
): Promise<{ confusions: ConfusionDto[]; pronunciationScores: PronunciationScoreDto[]; history: HistoryEntryDto[] }> {
  const confusions = (await services.db.execute<ConfusionDto>(sql`
    select n.details->'confusion'->>'expected' as expected,
           n.details->'confusion'->>'answered' as answered,
           count(distinct n.attempt_id)::int as count
      from learning_app.assessments n
      join learning_app.attempts a on a.id = n.attempt_id
     where n.child_id = ${childId}
       and a.item_revision_id = any(${sql.param(revisionIds)}::uuid[])
       and n.details ? 'confusion'
     group by 1, 2
     order by count desc, expected asc, answered asc
     limit 5
  `)).rows;

  const pronunciationScores = (await services.db.execute<{
    target: string;
    provider: string;
    score: string | number;
    band: string | null;
    assessedAt: Date;
  }>(sql`
    select distinct on (ir.item_id)
           ir.payload->>'target' as target,
           n.details->'pronunciation'->>'provider' as provider,
           (n.details->'pronunciation'->>'score')::numeric as score,
           n.details->'pronunciation'->>'band' as band,
           a.received_at as "assessedAt"
      from learning_app.assessments n
      join learning_app.attempts a on a.id = n.attempt_id
      join learning_app.item_revisions ir on ir.id = a.item_revision_id
     where n.child_id = ${childId}
       and a.item_revision_id = any(${sql.param(revisionIds)}::uuid[])
       and n.skill = 'pronunciation'
       and n.details ? 'pronunciation'
     order by ir.item_id, a.received_at desc
  `)).rows.map((row) => ({
    target: row.target,
    provider: row.provider,
    score: Number(row.score),
    ...(row.band === null ? {} : { band: row.band as PronunciationScoreDto["band"] }),
    assessedAt: new Date(row.assessedAt).toISOString(),
  }));

  const history = (await services.db.execute<{
    receivedAt: Date;
    source: string;
    target: string;
    skill: ReportSkill;
    outcome: "correct" | "incorrect" | "unassessed";
    independent: boolean;
    modality: HistoryEntryDto["modality"];
  }>(sql`
    select a.received_at as "receivedAt",
           ir.payload->>'source' as source,
           ir.payload->>'target' as target,
           n.skill as skill,
           n.outcome as outcome,
           n.independent as independent,
           a.modality as modality
      from learning_app.assessments n
      join learning_app.attempts a on a.id = n.attempt_id
      join learning_app.item_revisions ir on ir.id = a.item_revision_id
     where n.child_id = ${childId}
       and a.item_revision_id = any(${sql.param(revisionIds)}::uuid[])
     order by a.received_at desc, a.id desc, n.skill asc
     limit 30
  `)).rows.map((row) => ({
    receivedAt: new Date(row.receivedAt).toISOString(),
    source: row.source,
    target: row.target,
    skill: row.skill,
    outcome: row.outcome,
    independent: row.independent,
    modality: row.modality,
  }));

  return { confusions, pronunciationScores, history };
}
