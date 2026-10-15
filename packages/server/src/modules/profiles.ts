import { randomUUID } from "node:crypto";
import { asc, eq, like, sql } from "drizzle-orm";
import {
  ChildInputSchema,
  ChildPatchSchema,
  PronunciationBandsInputSchema,
  PronunciationSettingsDtoSchema,
  toChildDto,
  UuidSchema,
  type ChildDto,
  type ChildInput,
  type ChildPatch,
  type PronunciationSettingsDto,
} from "@learning/contracts";
import { childProfiles, learningPolicies } from "../db/schema";
import { AppError } from "../errors";
import type { Services } from "../config";
import { CURRENT_POLICY_ID, ensureLearningPolicy, loadPolicy, PolicyConfigSchema } from "../policies/registry";

export async function listChildren(services: Services): Promise<ChildDto[]> {
  const rows = await services.db
    .select()
    .from(childProfiles)
    .orderBy(asc(childProfiles.createdAt), asc(childProfiles.id));
  return rows.map(toChildDto);
}

export async function createChild(services: Services, input: ChildInput): Promise<ChildDto> {
  const valid = ChildInputSchema.parse(input);
  const [row] = await services.db
    .insert(childProfiles)
    .values({
      id: randomUUID(),
      displayName: valid.displayName,
      avatarKey: valid.avatarKey,
      birthYear: valid.birthYear ?? null,
      canRead: valid.canRead,
    })
    .returning();
  return toChildDto(row!);
}

/** Zmienia dane wyświetlane, zachowując tożsamość i historię dziecka. */
export async function updateChild(services: Services, childId: string, input: ChildPatch): Promise<ChildDto> {
  const id = UuidSchema.parse(childId);
  const valid = ChildPatchSchema.parse(input);
  const [row] = await services.db.update(childProfiles).set({
    ...(valid.displayName !== undefined ? { displayName: valid.displayName } : {}),
    ...(valid.avatarKey !== undefined ? { avatarKey: valid.avatarKey } : {}),
    ...(valid.recordingMode !== undefined ? { recordingMode: valid.recordingMode } : {}),
    ...(valid.canRead !== undefined ? { canRead: valid.canRead } : {}),
  }).where(eq(childProfiles.id, id)).returning();
  if (!row) throw new AppError("not_found");
  return toChildDto(row);
}

/**
 * Usunięcie profilu kasuje całą historię dziecka (sesje, próby, wydarzenia,
 * projekcje) przez CASCADE w bazie; wspólny materiał pozostaje.
 */
export async function deleteChild(services: Services, childId: string): Promise<void> {
  const id = UuidSchema.parse(childId);
  const deleted = await services.db
    .delete(childProfiles)
    .where(eq(childProfiles.id, id))
    .returning({ id: childProfiles.id });
  if (deleted.length === 0) {
    throw new AppError("not_found");
  }
}

/** Ustawienia wymowy dziecka: aktywne progi oraz ostatnie oceny dla rodzica. */
export async function getPronunciationSettings(services: Services, childId: string): Promise<PronunciationSettingsDto> {
  const provider = services.speech?.pronunciation.name;
  const child = (await services.db.select().from(childProfiles).where(eq(childProfiles.id, childId)))[0];
  if (!child) throw new AppError("not_found");
  if (!provider) {
    return PronunciationSettingsDtoSchema.parse({ pronunciationAvailable: false, thresholds: null, attempts: [] });
  }

  await ensureLearningPolicy(services.db);
  const policy = await loadPolicy(services.db, child.policyId ?? CURRENT_POLICY_ID);
  const bands = policy.pronunciationBands[provider];
  const attemptRows = await services.db.execute(sql`
    select st.answer_key->>'target' as word,
           a.details->'pronunciation'->>'score' as score,
           a.details->'pronunciation'->>'band' as band,
           at.received_at::text as attempted_at
      from learning_app.assessments a
      join learning_app.attempts at on at.id = a.attempt_id
      join learning_app.session_tasks st on st.id = at.task_id
     where a.child_id = ${childId}
       and a.skill = 'pronunciation'
       and a.details->'pronunciation'->>'score' is not null
     order by at.received_at desc
     limit 20`);
  return PronunciationSettingsDtoSchema.parse({
    pronunciationAvailable: true,
    thresholds: bands ? { correctMinScore: bands.correctMinScore, partialMinScore: bands.partialMinScore } : null,
    attempts: (attemptRows.rows as Array<{ word: string; score: string; band: string | null; attempted_at: string }>).map((row) => ({
      word: row.word,
      score: Number(row.score),
      band: row.band === "correct" || row.band === "partial" || row.band === "below" ? row.band : null,
      attemptedAt: row.attempted_at,
    })),
  });
}

/** Zmiana progów tworzy nową niezmienną wersję polityki i przypina ją do profilu. */
export async function updatePronunciationBands(
  services: Services,
  childId: string,
  input: { correctMinScore: number; partialMinScore: number },
): Promise<void> {
  const provider = services.speech?.pronunciation.name;
  if (!provider) throw new AppError("conflict");
  const parsed = PronunciationBandsInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("validation", { cause: parsed.error });

  await services.db.transaction(async (tx) => {
    await ensureLearningPolicy(tx);
    const child = (await tx.select().from(childProfiles).where(eq(childProfiles.id, childId)).for("update"))[0];
    if (!child) throw new AppError("not_found");
    const base = await loadPolicy(tx, child.policyId ?? CURRENT_POLICY_ID);
    const config = {
      ...base,
      pronunciationBands: {
        ...base.pronunciationBands,
        [provider]: {
          scaleMax: 100,
          correctMinScore: parsed.data.correctMinScore,
          partialMinScore: parsed.data.partialMinScore,
        },
      },
    };
    const prefix = `child-${childId}-`;
    const existing = await tx.select({ id: learningPolicies.id }).from(learningPolicies).where(like(learningPolicies.id, `${prefix}%`));
    const newId = `${prefix}${existing.length + 1}`;
    await tx.insert(learningPolicies).values({
      id: newId,
      config: PolicyConfigSchema.parse(config) as unknown as Record<string, unknown>,
    });
    await tx.update(childProfiles).set({ policyId: newId }).where(eq(childProfiles.id, childId));
  });
}
