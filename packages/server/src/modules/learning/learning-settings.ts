import { eq, like, sql } from "drizzle-orm";
import {
  PronunciationBandsInputSchema,
  PronunciationSettingsDtoSchema,
  type PronunciationSettingsDto,
} from "@learning/contracts";
import { childProfiles, learningPolicies } from "../../db/schema";
import { AppError } from "../../errors";
import type { Services } from "../../config";
import { CURRENT_POLICY_ID, ensureLearningPolicy, loadPolicy, PolicyConfigSchema } from "../../policies/registry";

/**
 * Ustawienia nauki dziecka, które żyją w polityce nauki, a nie w tożsamości
 * profilu (moduł `profiles.ts` odpowiada wyłącznie za CRUD profilu).
 * `updatePronunciationBands` tworzy nową, niezmienną wersję polityki i przypina
 * ją do profilu w jednej transakcji — semantyczna własność polityki należy do
 * obszaru nauki, choć pole `policyId` znajduje się w wierszu profilu.
 */

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
