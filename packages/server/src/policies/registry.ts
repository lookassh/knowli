import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../db/client";
import { learningPolicies } from "../db/schema";
import { AppError } from "../errors";
import type { Policy } from "../domain/types";
import { LEARNING_V1_POLICY } from "./learning-v1";
import { LEARNING_V2_POLICY } from "./learning-v2";

/** Kształt JSON polityki w learning_policies — walidowany przy każdym odczycie. */
export const PolicyConfigSchema = z.object({
  version: z.string().min(1),
  independenceAfterSeconds: z.number().int().positive(),
  successStreakRequired: z.number().int().positive(),
  confirmationMinHours: z.number().int().positive(),
  supportAfterFailures: z.number().int().positive(),
  readingDirections: z.array(z.enum(["target_to_source", "source_to_target"])).min(1),
  pronunciationBands: z.record(
    z.string(),
    z.object({
      scaleMax: z.number(),
      correctMinScore: z.number(),
      partialMinScore: z.number(),
    }),
  ),
});

/** Identyfikator bieżącej polityki — przypinany do nowych sesji bez własnej polityki dziecka. */
export const CURRENT_POLICY_ID = LEARNING_V2_POLICY.version;

/**
 * Wstawia learning-v1 i learning-v2 idempotentnie, gdy ich jeszcze nie ma.
 * Registry jest jedynym źródłem konfiguracji: stała TS, a nie ręczny SQL
 * w migracji. v1 zostaje dla sesji przypiętych przed wprowadzeniem v2.
 */
export async function ensureLearningPolicy(exec: Executor): Promise<void> {
  for (const policy of [LEARNING_V1_POLICY, LEARNING_V2_POLICY]) {
    await exec
      .insert(learningPolicies)
      .values({ id: policy.version, config: PolicyConfigSchema.parse(policy) as unknown as Record<string, unknown> })
      .onConflictDoNothing({ target: learningPolicies.id });
  }
}

/** Odczytuje i waliduje przypiętą politykę; sesja nigdy nie działa na nieznanej wersji. */
export async function loadPolicy(exec: Executor, policyId: string): Promise<Policy> {
  const row = (await exec.select().from(learningPolicies).where(eq(learningPolicies.id, policyId)))[0];
  if (!row) {
    throw new AppError("internal", { message: `unknown learning policy: ${policyId}` });
  }
  return PolicyConfigSchema.parse(row.config) as Policy;
}
