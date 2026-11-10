export interface LessonGenerationPolicy {
  requestTimeoutMs: number;
  runTimeoutMs: number;
  cancelPollMs: number;
}

export const DEFAULT_LESSON_GENERATION_POLICY: LessonGenerationPolicy = {
  requestTimeoutMs: 90_000,
  runTimeoutMs: 600_000,
  cancelPollMs: 1_000,
};

/** Zapas ponad termin runu, po którym próbę w `running` uznajemy za utkniętą (zegar bazy kontra zegar procesu, zapis końcowy). */
export const LESSON_RUN_STALL_MARGIN_MS = 120_000;

/**
 * Po ilu ms od przejęcia run puli w `running` jest utknięty: termin runu z polityki procesu plus margines.
 * Worker ma politykę w zależnościach generacji, web — z własnego env (`Services.lessonExecution`); obie
 * wartości muszą pochodzić z tej samej konfiguracji (`UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS`).
 */
export function lessonRunStallAfterMs(source: {
  generation?: { lessonExecution?: LessonGenerationPolicy } | undefined;
  lessonExecution?: LessonGenerationPolicy | undefined;
}): number {
  const policy = source.generation?.lessonExecution ?? source.lessonExecution ?? DEFAULT_LESSON_GENERATION_POLICY;
  return policy.runTimeoutMs + LESSON_RUN_STALL_MARGIN_MS;
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

export function lessonGenerationPolicyFromEnv(env: Record<string, string | undefined>): LessonGenerationPolicy {
  const policy = {
    requestTimeoutMs: positiveInteger(env.UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS, DEFAULT_LESSON_GENERATION_POLICY.requestTimeoutMs, "UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS"),
    runTimeoutMs: positiveInteger(env.UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS, DEFAULT_LESSON_GENERATION_POLICY.runTimeoutMs, "UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS"),
    cancelPollMs: positiveInteger(env.UMIEM_LESSON_GENERATION_CANCEL_POLL_MS, DEFAULT_LESSON_GENERATION_POLICY.cancelPollMs, "UMIEM_LESSON_GENERATION_CANCEL_POLL_MS"),
  };
  if (policy.requestTimeoutMs > policy.runTimeoutMs) {
    throw new Error("UMIEM_LESSON_GENERATION_REQUEST_TIMEOUT_MS must not exceed UMIEM_LESSON_GENERATION_RUN_TIMEOUT_MS");
  }
  return policy;
}
