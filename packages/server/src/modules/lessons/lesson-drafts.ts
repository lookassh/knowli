import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { LessonCommandSchema, type LessonCommand } from "@learning/contracts";
import type { Clock, Services } from "../../config";
import type { Tx } from "../../db/client";
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
import { validatePool } from "../../domain/lessons/pool-validation";
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
  errorCodeOf,
  markRun,
  requireGeneration,
} from "../generation";
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
  regenerate?: { objectiveId: string; count: number; existingAnswers: string[] };
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
    ...(existingAnswers.length > 0 ? { existingAnswers: [...existingAnswers] } : {}),
  };
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

export async function executeLessonGeneration(services: Services, runId: string): Promise<void> {
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

  const attempts = await claimQueuedRun(services.db, runId);
  if (attempts === null) {
    return;
  }
  if (attempts > MAX_AUTOMATIC_ATTEMPTS) {
    await markRun(services.db, services.clock, runId, "failed", "attempts_exhausted");
    return;
  }

  const input = run.input as unknown as LessonRunInput;
  const subject = services.subjects.getSubject(input.subjectId);
  const topic = services.subjects.getTopic(input.subjectId, input.topicId, input.topicVersion);
  if (!subject || !topic) {
    await markRun(services.db, services.clock, runId, "failed", "validation");
    return;
  }
  const graderAvailable = services.speech !== undefined || services.generation !== undefined;

  // Partie per cel: albo dogenerowanie jednego celu, albo pełna pula.
  const batches: { objectiveId: string; count: number; existingAnswers: string[] }[] = input.regenerate
    ? [
        {
          objectiveId: input.regenerate.objectiveId,
          count: input.regenerate.count,
          existingAnswers: input.regenerate.existingAnswers,
        },
      ]
    : input.objectiveIds.map((objectiveId) => ({
        objectiveId,
        count: countPerObjective(input.poolSize, input.objectiveIds.length),
        existingAnswers: [],
      }));

  const rawExercises: unknown[] = [];
  const examples: Record<string, string[]> = {};
  try {
    for (const batch of batches) {
      const poolInput = buildPoolInput(
        subject,
        topic,
        batch.objectiveId,
        batch.count,
        input.material,
        input.instruction,
        graderAvailable,
        batch.existingAnswers,
      );
      const result = await deps.llm.generateLessonPool(poolInput);
      for (const ex of result.exercises) {
        rawExercises.push(ex);
      }
      for (const [objectiveId, list] of Object.entries(result.examples)) {
        examples[objectiveId] = list;
      }
    }
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "validation") {
      await markRun(services.db, services.clock, runId, "failed", "validation");
    } else if (attempts >= MAX_AUTOMATIC_ATTEMPTS) {
      await markRun(services.db, services.clock, runId, "failed", "attempts_exhausted");
    } else {
      await markRun(services.db, services.clock, runId, "queued", null);
    }
    return;
  }

  // Walidacja puli w domenie: pojedyncze reguły + duplikaty, także wobec
  // odpowiedzi już w szkicu (existingAnswers z partii dogenerowania).
  const drafts = rawExercises.map(toExerciseDraft);
  const { valid, rejected } = validatePool(drafts, subject, topic);
  // Duplikaty wobec odpowiedzi już w puli: odrzucamy valid, których odpowiedź
  // równa się istniejącej (dogenerowanie nie powiela odpowiedzi szkicu).
  const existingSet = new Set(batches.flatMap((b) => b.existingAnswers));
  const uniqueValid: LessonExerciseDraft[] = [];
  let dupAgainstExisting = 0;
  for (const ex of valid) {
    const clash = [...existingSet].some((a) => sameAnswer(a, ex.answer, subject));
    if (clash) {
      dupAgainstExisting += 1;
    } else {
      uniqueValid.push(ex);
    }
  }
  const rejectedCount = rejected.length + dupAgainstExisting;

  if (uniqueValid.length === 0) {
    await markRun(services.db, services.clock, runId, "failed", "validation");
    return;
  }

  await services.db.transaction(async (tx) => {
    const version = (
      await tx.select().from(deckVersions).where(eq(deckVersions.id, run.deckVersionId!)).for("update")
    )[0];
    if (!version) {
      await markRun(tx, services.clock, runId, "failed", "deck_version_gone");
      return;
    }
    if (version.state === "published" || version.editNumber !== run.expectedEditNumber) {
      await markRun(tx, services.clock, runId, "superseded", null);
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
    if (version.state !== "review") {
      await tx.update(deckVersions).set({ state: "review" }).where(eq(deckVersions.id, version.id));
    }
    await markRun(tx, services.clock, runId, "succeeded", null);
  });
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
      )[0];
      if (!version) {
        throw new AppError("not_found");
      }
      if (version.state === "published") {
        throw new AppError("immutable");
      }
      if (version.editNumber !== args.expectedEditNumber) {
        throw new AppError("conflict");
      }
      const context = (version.lessonContext ?? {}) as unknown as LessonContext;
      if (!context.subjectId || !context.objectiveIds?.includes(args.objectiveId)) {
        throw new AppError("validation", { message: "objective not in lesson" });
      }
      const existingAnswers = await existingAnswersOf(tx, version.id);
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
        regenerate: { objectiveId: args.objectiveId, count: args.count, existingAnswers },
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
