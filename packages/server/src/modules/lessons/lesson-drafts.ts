import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { LessonCommandSchema, type LessonCommand } from "@learning/contracts";
import type { Clock, Services } from "../../config";
import type { Executor, Tx } from "../../db/client";
import {
  deckVersions,
  decks,
  generationRuns,
  itemRevisions,
  itemRevisionSkills,
  learningItems,
  skillVersions,
} from "../../db/schema";
import { AppError } from "../../errors";
import { computeTargetKey } from "../../domain/target-key";
import {
  DEFAULT_LESSON_POLICY,
  defaultPoolSize,
  type StageMix,
} from "../../domain/lessons/lesson-policy";
import { MAX_TEXT_LENGTH, validatePool } from "../../domain/lessons/pool-validation";
import {
  lessonExerciseIdentity,
  lessonExerciseStimulusRecord,
  type LessonExerciseStimulus,
} from "../../domain/lessons/exercise-identity";
import type {
  LessonExerciseDraft,
  LessonExerciseType,
  LessonTopic,
  SubjectModule,
} from "../../domain/lessons/types";
import type { LessonPoolInput, LlmLessonStageCounts } from "../../ports/ai";
import {
  MAX_AUTOMATIC_ATTEMPTS,
  claimQueuedRun,
  enqueueGenerationRun,
  requireGeneration,
  supersedeLessonRuns,
} from "../generation";
import { classifyLessonGenerationFailure, lessonRetryDelayMs } from "./lesson-generation-errors";
import { assertLessonGenerationFinalizationAllowed, LessonGenerationCancelledError, withLessonGenerationControl } from "./lesson-generation-control";
import { DEFAULT_LESSON_GENERATION_POLICY } from "./lesson-generation-policy";
import { reconcileDraftAssetsTx } from "../media-reconciliation";

/**
 * Generowanie i zapis szkicu lekcji (design „Generowanie puli (worker)”).
 * `createLesson` tworzy deck lekcji + wersję draft + run `lesson` idempotentnie
 * (wspólny `enqueueGenerationRun` ze ścieżką słówek). `executeLessonGeneration`
 * woła port `generateLessonPool` partiami per cel, waliduje pulę w domenie
 * (`validatePool`) i zapisuje poprawne ćwiczenia pod blokadą wersji, przechodząc
 * `draft → review`. Ścieżka słówek pozostaje nietknięta: ten moduł nie dotyka
 * `applyItems` ani VOCABULARY_SKILLS.
 */

/** Kontekst lekcji zapisany w `deck_versions.lesson_context`. */
interface LessonContext {
  subjectId: string;
  topicId: string;
  topicVersion: number;
  objectiveIds: string[];
  poolSize: number;
  material: string;
  instruction?: string;
  examples: Record<string, string[]>;
  /** Licznik ćwiczeń odrzuconych przy walidacji (dla panelu rodzica). */
  rejectedCount: number;
}

/** Wejście runu `lesson` zapisane w `generation_runs.input`. */
interface LessonRunInput {
  deckId: string;
  deckVersionId: string;
  subjectId: string;
  topicId: string;
  topicVersion: number;
  objectiveIds: string[];
  poolSize: number;
  material: string;
  instruction?: string;
  /** Dogenerowanie jednego celu: nowe ćwiczenia dopisujemy, nie czyścimy. */
  regenerate?: { objectiveId: string; count: number; existingAnswers: string[]; existingExercises?: LessonExerciseStimulus[] };
}

function requireSubject(services: Services, subjectId: string): SubjectModule {
  const subject = services.subjects.getSubject(subjectId);
  if (!subject) {
    throw new AppError("validation", { message: `unknown subject: ${subjectId}` });
  }
  return subject;
}

function requireLatestTopic(services: Services, subjectId: string, topicId: string): LessonTopic {
  const topic = services.subjects.getLatestTopic(subjectId, topicId);
  if (!topic) {
    throw new AppError("validation", { message: `unknown topic: ${subjectId}/${topicId}` });
  }
  return topic;
}

/** Cele ⊆ temat; inaczej 400 validation (design „Error Handling”). */
function assertObjectivesInTopic(topic: LessonTopic, objectiveIds: readonly string[]): void {
  const known = new Set(topic.objectives.map((o) => o.id));
  for (const id of objectiveIds) {
    if (!known.has(id)) {
      throw new AppError("validation", { message: `unknown objective: ${id}` });
    }
  }
}

/** Tytuł lekcji: z tematu i przedmiotu, lub z instrukcji, obcięty do 120 znaków. */
function lessonTitle(subject: SubjectModule, topic: LessonTopic, instruction?: string): string {
  const base = `${subject.titlePl}: ${topic.titlePl}`;
  const title = instruction && instruction.trim() !== "" ? instruction.trim() : base;
  return [...title].slice(0, 120).join("");
}

export async function createLesson(
  services: Services,
  cmd: LessonCommand,
): Promise<{ runId: string; deckId: string }> {
  const valid = LessonCommandSchema.parse(cmd);
  const subject = requireSubject(services, valid.subjectId);
  const topic = requireLatestTopic(services, valid.subjectId, valid.topicId);
  assertObjectivesInTopic(topic, valid.objectiveIds);

  const poolSize = valid.poolSize ?? defaultPoolSize(valid.objectiveIds.length);
  const title = lessonTitle(subject, topic, valid.instruction);

  return enqueueGenerationRun(services.db, `lesson:${valid.clientRequestId}`, async (tx) => {
      const deckId = valid.deckId ?? randomUUID();
      const versionId = randomUUID();
      const runId = randomUUID();
      const context: LessonContext = {
        subjectId: subject.id,
        topicId: topic.id,
        topicVersion: topic.version,
        objectiveIds: [...valid.objectiveIds],
        poolSize,
        material: valid.material,
        ...(valid.instruction === undefined ? {} : { instruction: valid.instruction }),
        examples: {},
        rejectedCount: 0,
      };
      await tx.insert(decks).values({ id: deckId, title, kind: "lesson" });
      await tx.insert(deckVersions).values({
        id: versionId,
        deckId,
        versionNumber: 1,
        editNumber: 1,
        state: "draft",
        title,
        sourceLocale: subject.promptLocale,
        targetLocale: subject.answerLocale,
        lessonContext: context as unknown as Record<string, unknown>,
      });
      const input: LessonRunInput = {
        deckId,
        deckVersionId: versionId,
        subjectId: subject.id,
        topicId: topic.id,
        topicVersion: topic.version,
        objectiveIds: [...valid.objectiveIds],
        poolSize,
        material: valid.material,
        ...(valid.instruction === undefined ? {} : { instruction: valid.instruction }),
      };
      await tx.insert(generationRuns).values({
        id: runId,
        deckVersionId: versionId,
        expectedEditNumber: 1,
        kind: "lesson",
        dedupeKey: `lesson:${valid.clientRequestId}`,
        state: "queued",
        input: input as unknown as Record<string, unknown>,
      });
      return { runId, deckId };
  });
}

/**
 * Rozkład liczby ćwiczeń celu na etapy wg `stageMix` (sumuje do `count`).
 * Reszta z zaokrągleń trafia do etapu produktywnego (największy udział).
 */
export function splitStages(count: number, mix: StageMix = DEFAULT_LESSON_POLICY.stageMix): LlmLessonStageCounts {
  const guided = Math.round(count * mix.guided);
  const independent = Math.round(count * mix.independent);
  const productive = Math.max(0, count - guided - independent);
  return { guided, productive, independent };
}

/** Liczba ćwiczeń per cel: ceil(poolSize / liczba celów). */
function countPerObjective(poolSize: number, objectiveCount: number): number {
  return Math.max(1, Math.ceil(poolSize / Math.max(1, objectiveCount)));
}

/** Składa `LessonPoolInput` dla jednego celu z danych rejestru (port nie zna przedmiotu). */
function buildPoolInput(
  subject: SubjectModule,
  topic: LessonTopic,
  objectiveId: string,
  count: number,
  material: string,
  instruction: string | undefined,
  graderAvailable: boolean,
  existingAnswers: readonly string[],
  existingExercises: readonly LessonExerciseStimulus[] = [],
): LessonPoolInput {
  const objective = topic.objectives.find((o) => o.id === objectiveId)!;
  return {
    subjectId: subject.id,
    subjectTitle: subject.titlePl,
    answerLocale: subject.answerLocale,
    promptLocale: subject.promptLocale,
    promptProfile: {
      generationRole: subject.prompts.generationRole,
      gradingRole: subject.prompts.gradingRole,
      almostDefinition: subject.prompts.almostDefinition,
      ...(subject.prompts.fieldRules === undefined ? {} : { fieldRules: subject.prompts.fieldRules }),
    },
    exerciseTypes: [...subject.exerciseTypes],
    transforms: topic.transforms.map((t) => ({ id: t.id, instructionPl: t.instructionPl })),
    objectives: [
      {
        id: objective.id,
        descriptionEn: objective.descriptionEn,
        exerciseTypes: [...objective.exerciseTypes],
        errorCategories: [...objective.errorCategories],
      },
    ],
    material,
    ...(instruction === undefined ? {} : { instruction }),
    countPerObjective: count,
    stageCounts: splitStages(count),
    graderAvailable,
    deduplication: subject.poolDeduplication ?? "answer",
    ...(existingAnswers.length > 0 ? { existingAnswers: [...existingAnswers] } : {}),
    ...(existingExercises.length > 0 ? { existingExercises: [...existingExercises] } : {}),
  };
}

/**
 * Schemat KSZTAŁTU surowego ćwiczenia z portu (nie semantyki). Chroni dalszą
 * walidację semantyczną (`validatePool`) przed rekordami, których tablice mają
 * zły typ elementów (np. `options=[null,{…}]`) — bez tego `validateOptions`
 * dereferencuje `null.text` i rzuca `TypeError`, wywracając cały run zamiast
 * odrzucić jeden rekord (wymóg 2.5). Sprawdzamy tylko to, co faza semantyczna
 * dereferencuje: elementy `options`/`items` muszą być `{id,text}`, a
 * `noticeSegments` musi być tablicą tablic napisów. Pozostałe pola pozostają
 * domeną `validateLessonExercise`. `passthrough` — nie odrzucamy pól dodatkowych.
 *
 * Pola opcjonalne są `nullish`, bo structured outputs (json_schema strict)
 * zwraca KAŻDE pole schematu, z `null` dla nie dotyczących typu — brak pola
 * i jawny `null` muszą przejść tak samo (`toExerciseDraft` nulla pomija).
 */
const optionShapeSchema = z.object({ id: z.string(), text: z.string() }).passthrough();
const rawExerciseShapeSchema = z
  .object({
    exerciseType: z.string(),
    objectiveId: z.string(),
    answer: z.string(),
    acceptedAnswers: z.array(z.string()).nullish(),
    focus: z.array(z.string()).nullish(),
    instructionPl: z.string().nullish(),
    stem: z.string().nullish(),
    statement: z.string().nullish(),
    prompt: z.string().nullish(),
    hint: z.string().nullish(),
    transformId: z.string().nullish(),
    correctOption: z.string().nullish(),
    options: z.array(optionShapeSchema).nullish(),
    items: z.array(optionShapeSchema).nullish(),
    noticeSegments: z.array(z.array(z.string())).nullish(),
  })
  .passthrough();

/**
 * Czy surowy obiekt ma bezpieczny KSZTAŁT do walidacji semantycznej. Rekord o
 * złym kształcie jest odrzucany (liczony do `rejectedCount`), nie rzuca. Nie
 * maskuje realnych błędów treści — sprawdza wyłącznie kształt pól tablicowych,
 * które faza semantyczna dereferencuje.
 */
export function isWellShapedRawExercise(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") {
    return false;
  }
  return rawExerciseShapeSchema.safeParse(raw).success;
}

export function collectBatchExerciseMetadata(exercises: unknown[], deduplicateByExercise: boolean): {
  answers: string[];
  exerciseRecords: LessonExerciseStimulus[];
} {
  const answers: string[] = [];
  const exerciseRecords: LessonExerciseStimulus[] = [];
  for (const exercise of exercises) {
    if (!isWellShapedRawExercise(exercise)) continue;
    const answer = (exercise as { answer?: unknown }).answer;
    if (typeof answer === "string" && answer.trim() !== "") answers.push(answer);
    if (deduplicateByExercise) {
      exerciseRecords.push(lessonExerciseStimulusRecord(toExerciseDraft(exercise)));
    }
  }
  return { answers, exerciseRecords };
}

export function filterExercisesToRequestedObjective(exercises: unknown[], objectiveId: string): {
  exercises: unknown[];
  outOfScopeCount: number;
} {
  const accepted: unknown[] = [];
  let outOfScopeCount = 0;
  for (const exercise of exercises) {
    const returnedObjective = exercise && typeof exercise === "object"
      ? (exercise as { objectiveId?: unknown }).objectiveId
      : undefined;
    if (typeof returnedObjective === "string" && returnedObjective !== objectiveId) outOfScopeCount += 1;
    else accepted.push(exercise);
  }
  return { exercises: accepted, outOfScopeCount };
}

export function summarizeLessonPoolValidation(input: {
  rawCount: number;
  shapeRejected: number;
  outOfScopeCount: number;
  rejectedExerciseCount: number;
  rejectedErrors: readonly string[];
  duplicateCount: number;
  validCount: number;
}): string {
  const ruleCounts = new Map<string, number>();
  for (const error of input.rejectedErrors) {
    const rule = /^([a-z][a-z0-9_]*):/i.exec(error)?.[1] ?? "other";
    ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + 1);
  }
  const reasons = [...ruleCounts.entries()].map(([rule, count]) => `${rule}×${count}`).join(", ") || "-";
  const rejected = input.shapeRejected + input.outOfScopeCount + input.rejectedExerciseCount + input.duplicateCount;
  return `surowe=${input.rawCount} zły_kształt=${input.shapeRejected} obcy_cel=${input.outOfScopeCount} odrzucone=${rejected} ważne=${input.validCount}; reguły: ${reasons}`;
}

/** Surowy obiekt z portu → `LessonExerciseDraft` (walidacja kształtu w domenie). */
export function toExerciseDraft(raw: unknown): LessonExerciseDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    exerciseType: r.exerciseType as LessonExerciseType,
    objectiveId: String(r.objectiveId ?? ""),
    ...(typeof r.instructionPl === "string" ? { instructionPl: r.instructionPl } : {}),
    ...(typeof r.stem === "string" ? { stem: r.stem } : {}),
    ...(typeof r.statement === "string" ? { statement: r.statement } : {}),
    ...(typeof r.prompt === "string" ? { prompt: r.prompt } : {}),
    ...(typeof r.hint === "string" ? { hint: r.hint } : {}),
    ...(typeof r.transformId === "string" ? { transformId: r.transformId } : {}),
    ...(Array.isArray(r.noticeSegments)
      ? { noticeSegments: r.noticeSegments as readonly (readonly string[])[] }
      : {}),
    answer: String(r.answer ?? ""),
    acceptedAnswers: Array.isArray(r.acceptedAnswers) ? (r.acceptedAnswers as string[]) : [],
    focus: Array.isArray(r.focus) ? (r.focus as string[]) : [],
    ...(Array.isArray(r.options)
      ? { options: r.options as readonly { id: string; text: string }[] }
      : {}),
    ...(typeof r.correctOption === "string" ? { correctOption: r.correctOption } : {}),
    ...(Array.isArray(r.items)
      ? { items: r.items as readonly { id: string; text: string }[] }
      : {}),
  };
}

/** Payload `lesson_exercise` (payload_version 2) z locale przedmiotu. */
export function buildLessonPayload(
  ex: LessonExerciseDraft,
  subject: SubjectModule,
): Record<string, unknown> {
  return {
    exerciseType: ex.exerciseType,
    objectiveId: ex.objectiveId,
    ...(ex.instructionPl === undefined ? {} : { instructionPl: ex.instructionPl }),
    ...(ex.stem === undefined ? {} : { stem: ex.stem }),
    ...(ex.statement === undefined ? {} : { statement: ex.statement }),
    ...(ex.prompt === undefined ? {} : { prompt: ex.prompt }),
    ...(ex.hint === undefined ? {} : { hint: ex.hint }),
    ...(ex.transformId === undefined ? {} : { transformId: ex.transformId }),
    ...(ex.noticeSegments === undefined ? {} : { noticeSegments: ex.noticeSegments }),
    answer: ex.answer,
    acceptedAnswers: [...ex.acceptedAnswers],
    focus: [...ex.focus],
    ...(ex.options === undefined ? {} : { options: ex.options }),
    ...(ex.correctOption === undefined ? {} : { correctOption: ex.correctOption }),
    ...(ex.items === undefined ? {} : { items: ex.items }),
    answerLocale: subject.answerLocale,
    promptLocale: subject.promptLocale,
  };
}

/** criteria dla umiejętności `objective` (design „Data Models”). */
export function buildObjectiveCriteria(
  ex: LessonExerciseDraft,
  subject: SubjectModule,
  topicVersion: number,
): { criteria: Record<string, unknown>; criteriaHash: string } {
  const acceptedAnswersHash = createHash("sha256")
    .update(JSON.stringify([...ex.acceptedAnswers].sort()))
    .digest("hex");
  const criteria = {
    kind: "objective-v1",
    subjectId: subject.id,
    objectiveId: ex.objectiveId,
    focus: [...ex.focus],
    acceptedAnswersHash,
    topicVersion,
  };
  const criteriaHash = createHash("sha256").update(JSON.stringify(criteria)).digest("hex");
  return { criteria, criteriaHash };
}

/** Następna wolna pozycja w wersji (dogenerowanie dopisuje za istniejącymi). */
async function nextPosition(tx: Tx, versionId: string): Promise<number> {
  const row = (
    await tx
      .select({ position: itemRevisions.position })
      .from(itemRevisions)
      .where(eq(itemRevisions.deckVersionId, versionId))
      .orderBy(desc(itemRevisions.position))
      .limit(1)
  )[0];
  return row === undefined ? 0 : row.position + 1;
}

/**
 * Zapis poprawnych ćwiczeń lekcji do wersji: `learning_items (lesson_exercise)`,
 * `item_revisions (payload_version 2, target_key)`, `skill_versions (objective)`
 * i `item_revision_skills`. Dopisuje za istniejącymi (nie czyści) — pasuje i do
 * pierwszej generacji, i do dogenerowania celu. Osobny od `applyItems` słówek:
 * lekcje mają jedną umiejętność (`objective`) i inny payload, więc współdzielenie
 * pętli słówek (iterującej VOCABULARY_SKILLS) zmieniłoby zachowanie słówek —
 * zapis jest celowo osobny (udokumentowane w raporcie).
 */
export async function applyLessonExercises(
  tx: Tx,
  version: { id: string; deckId: string },
  subject: SubjectModule,
  topicVersion: number,
  exercises: readonly LessonExerciseDraft[],
): Promise<void> {
  let position = await nextPosition(tx, version.id);
  for (const ex of exercises) {
    const itemId = randomUUID();
    await tx.insert(learningItems).values({ id: itemId, deckId: version.deckId, kind: "lesson_exercise" });
    const skillVersionId = randomUUID();
    const { criteria, criteriaHash } = buildObjectiveCriteria(ex, subject, topicVersion);
    await tx.insert(skillVersions).values({
      id: skillVersionId,
      itemId,
      skill: "objective",
      revisionNumber: 1,
      criteria,
      criteriaHash,
    });
    const revisionId = randomUUID();
    await tx.insert(itemRevisions).values({
      id: revisionId,
      itemId,
      deckId: version.deckId,
      deckVersionId: version.id,
      position,
      payloadVersion: 2,
      payload: buildLessonPayload(ex, subject),
      targetKey: computeTargetKey(ex.answer, subject.answerLocale),
    });
    await tx.insert(itemRevisionSkills).values({
      itemRevisionId: revisionId,
      itemId,
      skill: "objective",
      skillVersionId,
    });
    position += 1;
  }
}

/** Odpowiedzi kanoniczne już w szkicu (dla dogenerowania bez duplikatów). */
async function existingAnswersOf(tx: Tx, versionId: string): Promise<string[]> {
  const rows = await tx
    .select({ payload: itemRevisions.payload })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId));
  return rows
    .map((r) => (r.payload as { answer?: string }).answer)
    .filter((a): a is string => typeof a === "string");
}

/** Funkcjonalne bodźce ćwiczeń już zapisanych w wersji szkicu. */
async function existingExercisesOf(tx: Executor, versionId: string): Promise<LessonExerciseStimulus[]> {
  const rows = await tx
    .select({ payload: itemRevisions.payload })
    .from(itemRevisions)
    .where(eq(itemRevisions.deckVersionId, versionId));
  return rows.flatMap(({ payload }) => {
    if (!payload || typeof payload !== "object") return [];
    const value = payload as Record<string, unknown>;
    if (typeof value.objectiveId !== "string" || typeof value.exerciseType !== "string" || typeof value.answer !== "string") return [];
    const exercise = toExerciseDraft(value);
    return [lessonExerciseStimulusRecord(exercise)];
  });
}

export async function executeLessonGeneration(services: Services, runId: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const deps = requireGeneration(services);
  const run = (await services.db.select().from(generationRuns).where(eq(generationRuns.id, runId)))[0];
  if (!run) {
    throw new AppError("not_found");
  }
  if (run.kind !== "lesson") {
    throw new AppError("internal", { message: "not a lesson run" });
  }
  if (run.state !== "queued") {
    return;
  }

  const attempts = await claimQueuedRun(services.db, runId, run.expectedEditNumber!, services.clock.now());
  if (attempts === null) {
    return;
  }
  const runStartedAtMs = Date.now();
  const markCurrentRun = async (db: Executor, state: "failed" | "succeeded" | "superseded" | "queued", errorCode: string | null, nextAttemptAt: Date | null = null) => {
    const result = await db.update(generationRuns).set({ state, errorCode, nextAttemptAt, finishedAt: state === "queued" ? null : services.clock.now() })
      .where(and(eq(generationRuns.id, runId), eq(generationRuns.state, "running"), eq(generationRuns.attempts, attempts), eq(generationRuns.expectedEditNumber, run.expectedEditNumber!)));
    // Logujemy tylko realne przejście (WHERE może dopasować 0 wierszy, np. gdy
    // równoległy retry rodzica podbił expectedEditNumber).
    if ((result as { rowCount?: number }).rowCount !== 0) {
      console.log(
        `[lesson] run=${runId} ${state === "queued" ? "ponowienie" : "zakończony"}: state=${state} kod=${errorCode ?? "-"} próba=${attempts}`,
      );
    }
  };
  if (attempts > MAX_AUTOMATIC_ATTEMPTS) {
    await markCurrentRun(services.db, "failed", "attempts_exhausted");
    return;
  }

  // Do not spend an LLM request on a run invalidated by a parent edit/retry.
  // The final write still rechecks the edit number under a row lock.
  const currentVersion = (await services.db.select({ editNumber: deckVersions.editNumber, state: deckVersions.state })
    .from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!)))[0];
  if (!currentVersion || currentVersion.state === "published" || currentVersion.editNumber !== run.expectedEditNumber) {
    await markCurrentRun(services.db, "superseded", null);
    return;
  }

  const input = run.input as unknown as LessonRunInput;
  const subject = services.subjects.getSubject(input.subjectId);
  const topic = services.subjects.getTopic(input.subjectId, input.topicId, input.topicVersion);
  if (!subject || !topic) {
    await markCurrentRun(services.db, "failed", "validation");
    return;
  }
  // Czy model oceniający będzie dostępny przy odpowiedzi (proces web)? Worker nie
  // ma klucza gradera i nie potrzebuje go — wnioskuje o konfiguracji po obecności
  // `UMIEM_GRADER_BASE_URL` we WSPÓLNYM .env (web i worker czytają ten sam plik:
  // Compose przekazuje te zmienne obu procesom). To steruje tylko PREFERENCJĄ
  // typów przy generacji (closed/gap, gdy brak modelu), nie oceną.
  const graderAvailable = Boolean(process.env.UMIEM_GRADER_BASE_URL);

  // Runy dogenerowania utworzone przed wprowadzeniem polityki exercise mają
  // tylko existingAnswers. Dla gramatyki odbudowujemy bodźce z bieżącego szkicu.
  const legacyExistingExercises = subject.poolDeduplication === "exercise" && input.regenerate && input.regenerate.existingExercises === undefined
    ? await existingExercisesOf(services.db, input.deckVersionId)
    : [];

  // Partie per cel: albo dogenerowanie jednego celu, albo pełna pula.
  const batches: { objectiveId: string; count: number; existingAnswers: string[]; existingExercises: LessonExerciseStimulus[] }[] = input.regenerate
    ? [
        {
          objectiveId: input.regenerate.objectiveId,
          count: input.regenerate.count,
          existingAnswers: input.regenerate.existingAnswers,
          existingExercises: input.regenerate.existingExercises ?? legacyExistingExercises,
        },
      ]
    : input.objectiveIds.map((objectiveId) => ({
        objectiveId,
        count: countPerObjective(input.poolSize, input.objectiveIds.length),
        existingAnswers: [],
        existingExercises: [],
      }));

  const rawExercises: unknown[] = [];
  let rawExerciseCount = 0;
  let outOfScopeCount = 0;
  // Odpowiedzi kanoniczne z wcześniejszych partii tej samej generacji: późniejsze
  // cele dostają je jako `existingAnswers` ("Do NOT repeat…"), więc pełna
  // generacja wielocelowa też omija duplikaty między partiami — walidacja fazy 2
  // pozostaje egzekwatorem (advisory list z surowych odpowiedzi, deduplikowana).
  const earlierAnswers: string[] = [];
  const earlierExercises: LessonExerciseStimulus[] = [];
  const examples: Record<string, string[]> = {};
  const executionPolicy = deps.lessonExecution ?? DEFAULT_LESSON_GENERATION_POLICY;
  const runDeadlineAtMs = runStartedAtMs + executionPolicy.runTimeoutMs;
  console.log(
    `[lesson] generacja run=${runId} deck=${input.deckId} cele=${batches.length} próba=${attempts} pula=${input.poolSize} model=${deps.llm.model}`,
  );
  try {
    await withLessonGenerationControl({
      ...executionPolicy,
      signal: options.signal,
      assertCurrent: async () => {
        const [current] = await services.db.select({ state: generationRuns.state, attempts: generationRuns.attempts, expectedEditNumber: generationRuns.expectedEditNumber })
          .from(generationRuns).where(eq(generationRuns.id, runId));
        const [version] = await services.db.select({ editNumber: deckVersions.editNumber, state: deckVersions.state })
          .from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!));
        return current?.state === "running" && current.attempts === attempts &&
          current.expectedEditNumber === run.expectedEditNumber && version?.state !== "published" &&
          version?.editNumber === run.expectedEditNumber;
      },
    }, async (control) => {
    for (const batch of batches) {
      await control.assertCurrent();
      const batchStartedAtMs = Date.now();
      const poolInput = buildPoolInput(
        subject,
        topic,
        batch.objectiveId,
        batch.count,
        input.material,
        input.instruction,
        graderAvailable,
        subject.poolDeduplication === "exercise"
          ? []
          : [...new Set([...batch.existingAnswers, ...earlierAnswers])],
        subject.poolDeduplication === "exercise"
          ? [...batch.existingExercises, ...earlierExercises]
          : [],
      );
      const result = await control.call((signal) => deps.llm.generateLessonPool(poolInput, signal));
      await control.assertCurrent();
      console.log(`[lesson] run=${runId} partia=${batch.objectiveId} durationMs=${Date.now() - batchStartedAtMs}`);
      rawExerciseCount += result.exercises.length;
      const scoped = filterExercisesToRequestedObjective(result.exercises, batch.objectiveId);
      outOfScopeCount += scoped.outOfScopeCount;
      rawExercises.push(...scoped.exercises);
      const metadata = collectBatchExerciseMetadata(scoped.exercises, subject.poolDeduplication === "exercise");
      earlierAnswers.push(...metadata.answers);
      earlierExercises.push(...metadata.exerciseRecords);
      const rawExamples = result.examples;
      for (const objectiveId of [batch.objectiveId]) {
        const list = rawExamples && typeof rawExamples === "object" ? rawExamples[objectiveId] : undefined;
        if (!Array.isArray(list)) continue;
        examples[objectiveId] = list.filter((line): line is string => typeof line === "string" && line.trim().length > 0 && line.trim().length <= MAX_TEXT_LENGTH)
          .map((line) => line.trim()).slice(0, 3);
      }
    }
    });
  } catch (error) {
    if (error instanceof LessonGenerationCancelledError) {
      if (error.reason === "shutdown") await markCurrentRun(services.db, "queued", null, null);
      return;
    }
    const failure = classifyLessonGenerationFailure(error);
    console.error(`[lesson] run=${runId} błąd partii LLM: kod=${failure.errorCode} retryable=${failure.retryable} próba=${attempts}`);
    if (!failure.retryable) {
      await markCurrentRun(services.db, "failed", failure.errorCode);
    } else if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await markCurrentRun(services.db, "failed", "attempts_exhausted");
    } else {
      const delay = lessonRetryDelayMs(attempts, failure.retryAfterMs, Math.random);
      const nextAttemptAt = new Date(services.clock.now().getTime() + delay);
      console.log(`[lesson] run=${runId} retryDelayMs=${delay} nextAttemptAt=${nextAttemptAt.toISOString()}`);
      await markCurrentRun(services.db, "queued", failure.errorCode, nextAttemptAt);
    }
    return;
  }

  // Walidacja puli w domenie: pojedyncze reguły + duplikaty, także wobec
  // odpowiedzi już w szkicu (existingAnswers z partii dogenerowania). Najpierw
  // strażnik KSZTAŁTU: rekord o złym kształcie tablic (np. options=[null,…])
  // jest odrzucany pojedynczo (liczony do rejectedCount), zamiast rzucać
  // TypeError w walidacji semantycznej i wywracać cały run (wymóg 2.5).
  // Całość walidacji + zapisu w terminalnym try/catch: nawet nieprzewidziany
  // wyjątek rozlicza run (failed/validation), nie zostawia go w stanie running.
  try {
    assertLessonGenerationFinalizationAllowed(runDeadlineAtMs, options.signal);
    const wellShaped = rawExercises.filter(isWellShapedRawExercise);
    const shapeRejected = rawExercises.length - wellShaped.length;
    const drafts = wellShaped.map(toExerciseDraft);
    const { valid, rejected } = validatePool(drafts, subject, topic);
    // Duplikaty wobec odpowiedzi już w puli: odrzucamy valid, których odpowiedź
    // równa się istniejącej (dogenerowanie nie powiela odpowiedzi szkicu).
    const existingSet = new Set(batches.flatMap((b) => b.existingAnswers));
    const existingExerciseSet = new Set(batches.flatMap((b) => b.existingExercises).map((exercise) =>
      JSON.stringify([exercise.objectiveId, exercise.exerciseType, exercise.stimulus]),
    ));
    const uniqueValid: LessonExerciseDraft[] = [];
    let dupAgainstExisting = 0;
    for (const ex of valid) {
      const clash = subject.poolDeduplication === "exercise"
        ? existingExerciseSet.has(lessonExerciseIdentity(ex))
        : [...existingSet].some((a) => sameAnswer(a, ex.answer, subject));
      if (clash) {
        dupAgainstExisting += 1;
      } else {
        uniqueValid.push(ex);
      }
    }
    const rejectedCount = shapeRejected + outOfScopeCount + rejected.length + dupAgainstExisting;

    console.log(
      `[lesson] run=${runId} walidacja puli: ${summarizeLessonPoolValidation({
        rawCount: rawExerciseCount,
        shapeRejected,
        outOfScopeCount,
        rejectedExerciseCount: rejected.length,
        rejectedErrors: rejected.flatMap((item) => item.errors),
        duplicateCount: dupAgainstExisting,
        validCount: uniqueValid.length,
      })}`,
    );

    if (uniqueValid.length === 0) {
      await markCurrentRun(services.db, "failed", "validation");
      return;
    }

    await services.db.transaction(async (tx) => {
      const version = (
        await tx.select().from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!)).for("update")
      )[0];
      const current = (await tx.select().from(generationRuns).where(eq(generationRuns.id, runId)).for("update"))[0];
      if (!current || current.state !== "running" || current.attempts !== attempts || current.expectedEditNumber !== run.expectedEditNumber) return;
      assertLessonGenerationFinalizationAllowed(runDeadlineAtMs, options.signal);
      if (!version) {
        await markCurrentRun(tx, "failed", "deck_version_gone");
        return;
      }
      if (version.state === "published" || version.editNumber !== run.expectedEditNumber) {
        await markCurrentRun(tx, "superseded", null);
        return;
      }
      await applyLessonExercises(
        tx,
        { id: version.id, deckId: version.deckId },
        subject,
        input.topicVersion,
        uniqueValid,
      );
      // Uzupełnienie lesson_context: przykłady i licznik odrzuconych (sumujemy przy
      // dogenerowaniu). lesson_context jest niezmienny dopiero po publikacji.
      const prevContext = (version.lessonContext ?? {}) as unknown as LessonContext;
      const nextContext: LessonContext = {
        ...prevContext,
        examples: { ...prevContext.examples, ...examples },
        rejectedCount: (prevContext.rejectedCount ?? 0) + rejectedCount,
      };
      await tx
        .update(deckVersions)
        .set({ lessonContext: nextContext as unknown as Record<string, unknown> })
        .where(eq(deckVersions.id, version.id));
      await reconcileDraftAssetsTx(tx, services, version);
      const nextEditNumber = version.editNumber + 1;
      await tx.update(deckVersions).set({ editNumber: nextEditNumber }).where(eq(deckVersions.id, version.id));
      await supersedeLessonRuns(tx, version.id, services.clock.now(), runId);
      if (version.state !== "review") {
        await tx.update(deckVersions).set({ state: "review" }).where(eq(deckVersions.id, version.id));
      }
      await markCurrentRun(tx, "succeeded", null);
    });
    console.log(`[lesson] run=${runId} zakończony durationMs=${Date.now() - runStartedAtMs}`);
  } catch (error) {
    // Nieprzewidziany wyjątek walidacji/zapisu NIE może zostawić runu „running”.
    // Rozliczamy terminalnie: wyczerpane próby → attempts_exhausted, inaczej
    // validation (błąd kształtu/treści puli, nie błąd przejściowy providera).
    console.error(`[lesson] run=${runId} nieprzewidziany błąd walidacji/zapisu: kod=validation_or_write`);
    if (error instanceof LessonGenerationCancelledError) {
      if (error.reason === "shutdown") await markCurrentRun(services.db, "queued", null, null);
    } else if (classifyLessonGenerationFailure(error).errorCode === "provider_timeout") {
      await markCurrentRun(services.db, "failed", "provider_timeout");
    } else if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await markCurrentRun(services.db, "failed", "attempts_exhausted");
    } else {
      await markCurrentRun(services.db, "failed", "validation");
    }
    return;
  }
}

/** Czy dwie odpowiedzi są równoważne po normalizatorze przedmiotu. */
function sameAnswer(a: string, b: string, subject: SubjectModule): boolean {
  const keysB = new Set(subject.normalizer.normalize(b).map((seq) => seq.join("\u0000")));
  return subject.normalizer.normalize(a).some((seq) => keysB.has(seq.join("\u0000")));
}

/**
 * Dogenerowanie ćwiczeń jednego celu w istniejącym szkicu (design „Generowanie
 * puli”). Nowy run `lesson` z `existingAnswers` istniejących ćwiczeń szkicu;
 * dopisuje ćwiczenia, nie usuwa istniejących. Idempotentne po `clientRequestId`.
 */
export async function regenerateObjective(
  services: Services,
  args: {
    deckId: string;
    objectiveId: string;
    count: number;
    expectedEditNumber: number;
    clientRequestId: string;
  },
): Promise<{ runId: string; deckId: string }> {
  return enqueueGenerationRun(services.db, `lesson:${args.clientRequestId}`, async (tx) => {
      const version = (
        await tx
          .select()
          .from(deckVersions)
          .where(and(eq(deckVersions.deckId, args.deckId)))
          .orderBy(desc(deckVersions.versionNumber))
          .limit(1)
          .for("update")
      )[0];
      if (!version) {
        throw new AppError("not_found");
      }
      const priorRequest = (await tx.select().from(generationRuns).where(eq(generationRuns.dedupeKey, `lesson:${args.clientRequestId}`)))[0];
      if (priorRequest) return { runId: priorRequest.id, deckId: args.deckId };
      if (version.state === "published") {
        throw new AppError("immutable");
      }
      if (version.editNumber !== args.expectedEditNumber) {
        throw new AppError("conflict");
      }
      const activeRun = (await tx.select({ id: generationRuns.id }).from(generationRuns).where(and(
        eq(generationRuns.kind, "lesson"),
        eq(generationRuns.deckVersionId, version.id),
        inArray(generationRuns.state, ["queued", "running"]),
      )).limit(1))[0];
      if (activeRun) throw new AppError("conflict");
      const context = (version.lessonContext ?? {}) as unknown as LessonContext;
      if (!context.subjectId || !context.objectiveIds?.includes(args.objectiveId)) {
        throw new AppError("validation", { message: "objective not in lesson" });
      }
      const subject = services.subjects.getSubject(context.subjectId);
      if (!subject) throw new AppError("validation", { message: "unknown subject" });
      const existingAnswers = subject.poolDeduplication === "exercise" ? [] : await existingAnswersOf(tx, version.id);
      const existingExercises = subject.poolDeduplication === "exercise" ? await existingExercisesOf(tx, version.id) : [];
      const runId = randomUUID();
      const runInput: LessonRunInput = {
        deckId: args.deckId,
        deckVersionId: version.id,
        subjectId: context.subjectId,
        topicId: context.topicId,
        topicVersion: context.topicVersion,
        objectiveIds: context.objectiveIds,
        poolSize: context.poolSize,
        material: context.material,
        ...(context.instruction === undefined ? {} : { instruction: context.instruction }),
        regenerate: { objectiveId: args.objectiveId, count: args.count, existingAnswers, existingExercises },
      };
      await tx.insert(generationRuns).values({
        id: runId,
        deckVersionId: version.id,
        expectedEditNumber: version.editNumber,
        kind: "lesson",
        dedupeKey: `lesson:${args.clientRequestId}`,
        state: "queued",
        input: runInput as unknown as Record<string, unknown>,
      });
      return { runId, deckId: args.deckId };
  });
}
