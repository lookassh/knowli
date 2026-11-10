import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  LESSON_AUTHORING_MAX_EXERCISES,
  LESSON_AUTHORING_MAX_REQUEST_BYTES,
  LESSON_AUTHORING_WRITES_PER_HOUR,
  LessonCatalogInputSchema,
  LessonDraftAppendInputSchema,
  LessonDraftCreateInputSchema,
  LessonDraftGetInputSchema,
  LessonDraftReplaceInputSchema,
  LessonValidateInputSchema,
  type AuthoringExposureLeak,
  type CoverageGapDto,
  type LessonAuthoringDraftDto,
  type LessonCatalogDto,
  type LessonDraftAppendResult,
  type LessonDraftDto,
  type LessonDraftReplaceInput,
  type LessonDraftWriteResult,
  type LessonExerciseInput,
  type LessonValidateResult,
} from "@learning/contracts";
import type { Services } from "../../../config";
import type { Executor, Tx } from "../../../db/client";
import { deckVersions, decks, generationRuns } from "../../../db/schema";
import { AppError } from "../../../errors";
import { LESSONS_WRITE_SCOPE, requireIntegrationScope } from "../../family";
import { EXAMPLES_PLACEHOLDER } from "../../../domain/lessons/card";
import { cardExposureSources } from "../../../domain/lessons/card-exposure-sources";
import { findExposureLeaks } from "../../../domain/lessons/exposure-leaks";
import { lessonCoverageGaps, lessonPoolMinimums } from "../../../domain/lessons/lesson-coverage";
import { DEFAULT_LESSON_POLICY } from "../../../domain/lessons/lesson-policy";
import { materialCreationMode } from "../../../domain/lessons/material-creation";
import { lessonRuleBook, ruleBookContextFor } from "../../../domain/lessons/rules/rule-book";
import { outsideStagePath, STAGE_BY_TYPE } from "../../../domain/lessons/stages";
import { LESSON_STORY_LIMITS, solvedSentencesOf, validateLessonStory, type LessonStory } from "../../../domain/lessons/story";
import type { LearningObjective, LessonExerciseDraft, LessonTopic, SubjectModule } from "../../../domain/lessons/types";
import { lessonPoolRunFilter } from "../generation-runs";
import { reconcileDraftAssetsTx } from "../media-reconciliation";
import { copyRevisionsSkillsAssets } from "../decks";
import { createVersionFromPublished, lockVersion } from "../version-ops";
import { applyLessonExercises, lessonTitle, listenChoiceAvailable, mergeExamples, toExerciseDraft, type LessonContext } from "./lesson-drafts";
import {
  editLessonDraftTx,
  lessonPoolIssues,
  readLessonContext,
  readLessonDraftDto,
  requireSubject,
  requireTopic,
  withoutRedundantInputVariants,
} from "./lesson-api";

/**
 * Lekcje pisane przez agenta (narzędzia MCP, token `lessons:write`, `docs/architecture.md` §19.18):
 * katalog zasad pisania, walidacja na sucho, szkic bez generatora, odczyt, poprawka i dopisanie zadań.
 * Utworzenie od zera tylko dla przedmiotów katalogowych; istniejącą lekcję (także z materiału rodzica,
 * z tematem z `lesson_context.dynamicTopic`) narzędzia czytają, walidują i zapisują po `deckId`.
 * Walidacja odpowiada generatorowi: reguły puli (`lessonPoolIssues`), pokrycie i ujawnienia z kartami
 * (`cardExposureSources`), historyjka. Zapisy w jednej transakcji z ponownym sprawdzeniem tokenu,
 * zapisem i uzgodnieniem mediów; publikację, przypisania i generowanie robi wyłącznie rodzic.
 */

/** Zasady kolejności planisty, których nie widać w regułach zadań. */
const ORDERING_RULES = [
  "Exercises keep the array order: within one objective and stage the first exercise in the array is the first one shown, so put the easiest exercises of every stage first.",
  "Objectives are introduced in the order of objectiveIds, at most maxNewObjectivesPerSession new objectives per session; cards of an objective come first.",
  "An objective moves to the next stage (guided, then productive, then independent) after advanceAfterCorrect correct answers in a row at its stage; types in outsideStagePath are extras outside that path.",
  "An independent exercise whose solved sentence the child has already seen (a card sentence, examples[objectiveId] or an earlier exercise) is not an independent check: it is reported in exposureLeaks and does not count for coverage.",
  "Publishing (done by the parent) needs at least poolMinimums exercises per objective and stage, counted without leaked independent exercises.",
];

/** Lekcja przed walidacją: temat zawężony do wybranych zagadnień. */
interface AuthoredLesson {
  readonly subject: SubjectModule;
  readonly topic: LessonTopic;
  readonly objectiveIds: readonly string[];
  readonly material: string;
  readonly examples: Readonly<Record<string, readonly string[]>>;
  readonly story?: LessonStory;
  readonly exercises: readonly LessonExerciseInput[];
}

function invalid(message: string, details?: unknown): AppError {
  return new AppError("validation", { message, ...(details === undefined ? {} : { details }) });
}

/** Utworzenie od zera: tylko przedmioty z katalogu tematów; przedmioty z materiału rodzica → `validation`. */
function catalogSubject(services: Services, subjectId: string): SubjectModule {
  const subject = requireSubject(services, subjectId);
  if (materialCreationMode(subject) !== undefined) throw invalid(`subject builds lessons from parent material: ${subjectId}`);
  return subject;
}

function latestTopic(services: Services, subject: SubjectModule, topicId: string): LessonTopic {
  const topic = services.subjects.getLatestTopic(subject.id, topicId);
  if (!topic) throw invalid(`unknown topic: ${subject.id}/${topicId}`);
  return topic;
}

/** Temat z samymi wybranymi zagadnieniami: zadanie innego zagadnienia łamie `exercise.unknown_objective`. */
function scopedTopic(topic: LessonTopic, objectiveIds: readonly string[]): LessonTopic {
  const known = new Set(topic.objectives.map((objective) => objective.id));
  const unknown = objectiveIds.filter((id) => !known.has(id));
  if (unknown.length > 0) throw invalid(`unknown objectives: ${unknown.join(", ")}`);
  return { ...topic, objectives: objectiveIds.map((id) => topic.objectives.find((objective) => objective.id === id)!) };
}

/**
 * Sprawdzenia strukturalne wejścia (przed regułami zadań): przykłady kart, historyjka, `id` zadań
 * i flaga `parentAdded` cytatu. Flaga wyłącza sprawdzenie cytatu w materiale, więc agent może ją
 * tylko zachować na cytacie zapisanego zadania, który już ją ma (nadaje ją rodzic w panelu).
 */
function assertLessonInput(lesson: AuthoredLesson, stored: readonly StoredExercise[]): void {
  const knownExerciseIds = new Set(stored.map((exercise) => exercise.id));
  const parentQuotes = new Map(stored.map((exercise) => [
    exercise.id,
    new Set((exercise.sourceRefs ?? []).filter((ref) => ref.parentAdded === true).map((ref) => ref.quote)),
  ]));
  const forged = lesson.exercises.flatMap((exercise, index) =>
    (exercise.sourceRefs ?? []).some((ref) => ref.parentAdded === true && !(exercise.id !== undefined && parentQuotes.get(exercise.id)?.has(ref.quote)))
      ? [index]
      : []);
  if (forged.length > 0) {
    throw invalid("sourceRefs[].parentAdded marks a quote the parent added in the panel; keep it only on a stored quote that already has it", { parentAdded: forged });
  }
  const missing = lesson.topic.objectives
    .filter((objective) => objective.cards.some((card) => card.body.includes(EXAMPLES_PLACEHOLDER)))
    .filter((objective) => (lesson.examples[objective.id] ?? []).length === 0)
    .map((objective) => objective.id);
  const unknown = Object.keys(lesson.examples).filter((id) => !lesson.objectiveIds.includes(id));
  if (missing.length > 0 || unknown.length > 0) {
    throw invalid("examples must cover every objective with a {{examples}} card and only the lesson objectives", { examples: { missing, unknown } });
  }
  if (lesson.story !== undefined && lesson.subject.lessonStory !== true) throw invalid(`subject has no lesson story: ${lesson.subject.id}`);
  const ids = lesson.exercises.flatMap((exercise) => (exercise.id === undefined ? [] : [exercise.id]));
  const unknownIds = ids.filter((id) => !knownExerciseIds.has(id));
  if (unknownIds.length > 0 || new Set(ids).size !== ids.length) {
    throw invalid("exercise ids must be unique ids from lesson_draft_get; leave id out for a new exercise", { unknownIds });
  }
}

/** Ujawnienia i pokrycie jak w generatorze: zdania z kart liczą się razem z `examples`. */
function findings(
  subject: SubjectModule,
  topic: LessonTopic,
  drafts: readonly LessonExerciseDraft[],
  examples: Readonly<Record<string, readonly string[]>>,
  objectiveIds: readonly string[],
): { coverage: CoverageGapDto[]; exposureLeaks: AuthoringExposureLeak[] } {
  const sources = mergeExamples(cardExposureSources(subject, topic), examples);
  const coverage = lessonCoverageGaps({ subject, exercises: drafts, examples: sources, objectiveIds });
  const exposureLeaks = findExposureLeaks({
    exercises: drafts,
    examples: sources,
    objectiveOrder: objectiveIds,
    subject,
    mode: "coverage",
    familyRepeatsAllowed: true,
  }).map((leak): AuthoringExposureLeak => ({
    index: leak.index,
    kind: leak.kind,
    source: leak.source.kind === "card_example"
      ? { kind: "card_example", objectiveId: leak.source.objectiveId }
      : { kind: "exercise", index: leak.source.index },
  }));
  return { coverage, exposureLeaks };
}

/** Ćwiczenia jak przy edycji rodzica: bez wariantów równych odpowiedzi kanonicznej. */
function draftsOf(exercises: readonly LessonExerciseInput[]): LessonExerciseDraft[] {
  return exercises.map((exercise) => toExerciseDraft(withoutRedundantInputVariants(exercise)));
}

/** Walidacja na sucho: błędy zadań (struktura `LessonRuleIssue`), historyjka, pokrycie, ujawnienia. */
function checkLesson(lesson: AuthoredLesson): LessonValidateResult {
  const drafts = draftsOf(lesson.exercises);
  const exercises = lessonPoolIssues(lesson.subject, lesson.topic, lesson.material, drafts).map(({ index, issues }) => ({
    index,
    issues: issues.map((issue) => ({
      rule: issue.rule,
      field: issue.field,
      pl: issue.pl,
      ...(issue.found === undefined ? {} : { found: issue.found }),
    })),
  }));
  const story = lesson.story === undefined
    ? []
    : validateLessonStory(lesson.story, { normalizer: lesson.subject.normalizer, solvedSentences: solvedSentencesOf(drafts) });
  return {
    ok: exercises.length === 0 && story.length === 0,
    exercises,
    story,
    ...findings(lesson.subject, lesson.topic, drafts, lesson.examples, lesson.objectiveIds),
  };
}

/** Zapis tylko poprawnej lekcji: błędy → `validation` z `details.exercises` / `details.story`. */
function assertLessonValid(lesson: AuthoredLesson): void {
  const result = checkLesson(lesson);
  if (result.exercises.length > 0) throw invalid("exercises break lesson rules", { exercises: result.exercises });
  if (result.story.length > 0) throw invalid("story breaks lesson rules", { story: result.story });
}

/** Aktywny zestaw-lekcja albo `validation`; nieznany → `not_found`. */
async function authorableDeck(db: Executor, deckId: string) {
  const deck = (await db.select().from(decks).where(eq(decks.id, deckId)))[0];
  if (!deck) throw new AppError("not_found");
  if (deck.kind !== "lesson" || deck.archivedAt) throw invalid("deck is not an active lesson");
  return deck;
}

async function editableVersionId(db: Executor, deckId: string): Promise<string | undefined> {
  const [row] = await db.select({ id: deckVersions.id }).from(deckVersions)
    .where(and(eq(deckVersions.deckId, deckId), inArray(deckVersions.state, ["draft", "review"])));
  return row?.id;
}

/** Szkic, a bez szkicu wersja opublikowana. */
async function currentVersionId(db: Executor, deck: { id: string; publishedVersionId: string | null }): Promise<string> {
  const id = (await editableVersionId(db, deck.id)) ?? deck.publishedVersionId;
  if (!id) throw new AppError("not_found");
  return id;
}

/** Przedmiot i temat przypięte w wersji (katalogowy albo złożony z materiału rodzica), zawężone do jej zagadnień. */
function versionLesson(services: Services, context: ReturnType<typeof readLessonContext>) {
  const subject = requireSubject(services, context.subjectId);
  return { subject, topic: scopedTopic(requireTopic(services, context), context.objectiveIds) };
}

/** Bieżąca wersja aktywnej lekcji (szkic, a bez szkicu opublikowana) z kontekstem. */
async function currentVersion(db: Executor, deckId: string) {
  const versionId = await currentVersionId(db, await authorableDeck(db, deckId));
  const version = (await db.select().from(deckVersions).where(eq(deckVersions.id, versionId)))[0]!;
  return { versionId, context: readLessonContext(version.lessonContext) };
}

type StoredExercise = LessonAuthoringDraftDto["exercises"][number];

/** Zapisane zadania wersji w kolejności puli, w kształcie wejścia narzędzi. */
async function storedExercises(db: Executor, services: Services, versionId: string): Promise<StoredExercise[]> {
  return (await readLessonDraftDto(db, services, versionId)).exercises.map(authoringExercise);
}

/** Typy zadań puli dozwolone w zagadnieniu: jak `buildPoolInput`, wybór ze słuchu tylko tam, gdzie przedmiot nagrywa zdania; karta nie jest zadaniem puli. */
function authorableTypes(subject: SubjectModule, objective: LearningObjective) {
  const listenChoice = listenChoiceAvailable(subject, objective);
  return { listenChoice, types: objective.exerciseTypes.filter((type) => type !== "lesson_card" && (listenChoice || type !== "lesson_listen_choice")) };
}

/** Pokrycie i ujawnienia zapisanej wersji (indeksy = kolejność `exercises` w `lesson_draft_get`). */
function draftFindings(services: Services, dto: LessonDraftDto) {
  const { subject, topic } = versionLesson(services, readLessonContext({ ...dto }));
  return findings(subject, topic, dto.exercises.map((exercise) => toExerciseDraft(exercise)), dto.examples, dto.objectiveIds);
}

function writeResult(services: Services, dto: LessonDraftDto): LessonDraftWriteResult {
  return { deckId: dto.deckId, draftId: dto.id, editNumber: dto.editNumber, ...draftFindings(services, dto) };
}

/**
 * Katalog zasad pisania: te same opisy reguł, profil promptu i limity, które dostaje generator paczek.
 * Dla tematu katalogowego (`subjectId` + `topicId`) albo istniejącej lekcji (`deckId`): temat przypięty
 * w jej wersji, także złożony z materiału rodzica, zawężony do jej zagadnień.
 */
export async function lessonAuthoringCatalog(services: Services, rawToken: string, input: unknown): Promise<LessonCatalogDto> {
  const { subjectId, topicId, deckId, objectiveIds } = LessonCatalogInputSchema.parse(input);
  const only = (topic: LessonTopic) => (objectiveIds === undefined ? topic : scopedTopic(topic, objectiveIds));
  if (deckId === undefined) {
    if (subjectId === undefined || topicId === undefined) throw invalid("subjectId and topicId, or deckId, are required");
    const subject = catalogSubject(services, subjectId);
    return catalogDto(subject, only(latestTopic(services, subject, topicId)));
  }
  if (subjectId !== undefined || topicId !== undefined) throw invalid("with deckId leave subjectId and topicId out");
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, LESSONS_WRITE_SCOPE);
    const { subject, topic } = versionLesson(services, (await currentVersion(tx, deckId)).context);
    return catalogDto(subject, only(topic));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

function catalogDto(subject: SubjectModule, topic: LessonTopic): LessonCatalogDto {
  const { avoidSentencesMax: _generatorOnly, ...storyLimits } = LESSON_STORY_LIMITS;
  const typeRules = Object.entries(subject.prompts.typeRules ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return {
    subjectId: subject.id,
    subjectTitlePl: subject.titlePl,
    answerLocale: subject.answerLocale,
    promptLocale: subject.promptLocale,
    topicId: topic.id,
    topicVersion: topic.version,
    topicTitlePl: topic.titlePl,
    generationRole: subject.prompts.generationRole,
    ...(subject.prompts.fieldRules === undefined ? {} : { fieldRules: subject.prompts.fieldRules }),
    ...(typeRules.length === 0 ? {} : { typeRules: Object.fromEntries(typeRules) }),
    story: {
      enabled: subject.lessonStory === true,
      ...(subject.lessonStory === true && subject.prompts.storyRules !== undefined ? { rules: subject.prompts.storyRules } : {}),
      limits: storyLimits,
    },
    stageByType: Object.fromEntries(subject.exerciseTypes.map((type) => [type, STAGE_BY_TYPE[type]])),
    outsideStagePath: subject.exerciseTypes.filter(outsideStagePath),
    advanceAfterCorrect: DEFAULT_LESSON_POLICY.advanceAfterCorrect,
    maxNewObjectivesPerSession: DEFAULT_LESSON_POLICY.maxNewObjectivesPerSession,
    poolMinimums: { ...lessonPoolMinimums(subject) },
    transforms: topic.transforms.map((transform) => ({ id: transform.id, instructionPl: transform.instructionPl })),
    orderingRules: ORDERING_RULES,
    limits: {
      maxExercises: LESSON_AUTHORING_MAX_EXERCISES,
      maxRequestBytes: LESSON_AUTHORING_MAX_REQUEST_BYTES,
      writesPerHour: LESSON_AUTHORING_WRITES_PER_HOUR,
    },
    objectives: topic.objectives.map((objective) => {
      const { listenChoice, types } = authorableTypes(subject, objective);
      const ruleBook = lessonRuleBook(subject, ruleBookContextFor(subject, topic.id, objective.id, types, listenChoice));
      return {
        id: objective.id,
        titlePl: objective.titlePl,
        descriptionEn: objective.descriptionEn,
        ...(objective.generationNotesEn === undefined ? {} : { generationNotesEn: objective.generationNotesEn }),
        cards: objective.cards.map((card) => ({ title: card.title, body: card.body })),
        examplesRequired: objective.cards.some((card) => card.body.includes(EXAMPLES_PLACEHOLDER)),
        exerciseTypes: types,
        rules: {
          general: ruleBook.general.map((line) => ({ ...line })),
          types: ruleBook.types.map((block) => ({ ...block, rules: block.rules.map((line) => ({ ...line })) })),
        },
      };
    }),
  };
}

/** Walidacja na sucho: bez zapisu, mediów i kosztów. */
export async function validateAuthoredLesson(services: Services, rawToken: string, input: unknown): Promise<LessonValidateResult> {
  const valid = LessonValidateInputSchema.parse(input);
  if (valid.deckId === undefined) {
    const { subjectId, topicId, objectiveIds, examples } = valid;
    if (subjectId === undefined || topicId === undefined || objectiveIds === undefined || examples === undefined) {
      throw invalid("without deckId subjectId, topicId, objectiveIds and examples are required");
    }
    const subject = catalogSubject(services, subjectId);
    const lesson: AuthoredLesson = {
      subject,
      topic: scopedTopic(latestTopic(services, subject, topicId), objectiveIds),
      objectiveIds,
      material: valid.material ?? "",
      examples,
      ...(valid.story == null ? {} : { story: valid.story }),
      exercises: valid.exercises,
    };
    if (valid.append === true) throw invalid("append needs deckId");
    assertLessonInput(lesson, []);
    return checkLesson(lesson);
  }
  const deckId = valid.deckId;
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, LESSONS_WRITE_SCOPE);
    const { versionId, context } = await currentVersion(tx, deckId);
    if ((valid.subjectId !== undefined && valid.subjectId !== context.subjectId) ||
      (valid.topicId !== undefined && valid.topicId !== context.topicId) ||
      (valid.objectiveIds !== undefined && valid.objectiveIds.join("\n") !== context.objectiveIds.join("\n"))) {
      throw invalid("subjectId, topicId and objectiveIds must match the lesson; leave them out with deckId");
    }
    const stored = await storedExercises(tx, services, versionId);
    const story = valid.story === undefined ? context.story : valid.story ?? undefined;
    const lesson: AuthoredLesson = {
      ...versionLesson(services, context),
      objectiveIds: context.objectiveIds,
      material: context.material,
      examples: valid.examples ?? context.examples,
      ...(story === undefined ? {} : { story }),
      exercises: valid.append === true ? appended(stored, valid.exercises) : valid.exercises,
    };
    assertLessonInput(lesson, stored);
    return { ...checkLesson(lesson), ...(valid.append === true ? { firstNewIndex: stored.length } : {}) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * Szkic bez generatora: `deckId = clientRequestId` (powtórka zwraca ten sam zestaw), wersja w stanie
 * `review`, `poolSize` = liczba zadań, bez `generation_runs`; nagrania zlecone w tej samej transakcji.
 */
export async function createAuthoredLesson(services: Services, rawToken: string, input: unknown): Promise<LessonDraftWriteResult> {
  const valid = LessonDraftCreateInputSchema.parse(input);
  const subject = catalogSubject(services, valid.subjectId);
  const topic = latestTopic(services, subject, valid.topicId);
  const lesson: AuthoredLesson = {
    subject,
    topic: scopedTopic(topic, valid.objectiveIds),
    objectiveIds: valid.objectiveIds,
    material: valid.material,
    examples: valid.examples,
    ...(valid.story === undefined ? {} : { story: valid.story }),
    exercises: valid.exercises,
  };
  assertLessonInput(lesson, []);
  assertLessonValid(lesson);
  const deckId = valid.clientRequestId;
  const title = valid.title ?? lessonTitle(subject, topic);
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, LESSONS_WRITE_SCOPE);
    const inserted = await tx.insert(decks).values({ id: deckId, title, kind: "lesson" }).onConflictDoNothing({ target: decks.id }).returning({ id: decks.id });
    if (inserted.length === 0) {
      // Powtórka tego samego `clientRequestId`: ten sam zestaw, o ile to lekcja.
      const existing = (await tx.select().from(decks).where(eq(decks.id, deckId)))[0];
      if (!existing || existing.kind !== "lesson") throw new AppError("conflict", { message: "clientRequestId belongs to another deck" });
      return writeResult(services, await readLessonDraftDto(tx, services, await currentVersionId(tx, existing)));
    }
    const versionId = randomUUID();
    const context: LessonContext = {
      subjectId: subject.id,
      topicId: topic.id,
      topicVersion: topic.version,
      objectiveIds: [...valid.objectiveIds],
      poolSize: valid.exercises.length,
      material: valid.material,
      examples: valid.examples,
      rejectedCount: 0,
      ...(valid.story === undefined ? {} : { story: valid.story }),
    };
    await tx.insert(deckVersions).values({
      id: versionId,
      deckId,
      versionNumber: 1,
      editNumber: 1,
      state: "review",
      title,
      sourceLocale: subject.promptLocale,
      targetLocale: subject.answerLocale,
      lessonContext: context as unknown as Record<string, unknown>,
    });
    await applyLessonExercises(tx, { id: versionId, deckId }, subject, topic.version, draftsOf(valid.exercises));
    await reconcileDraftAssetsTx(tx, services, { id: versionId, state: "review", deckId });
    return writeResult(services, await readLessonDraftDto(tx, services, versionId));
  });
}

/** Stan zestawu dla agenta: szkic albo wersja opublikowana z zagadnieniami i materiałem, bez danych dzieci, tematów zdań i mediów. */
export async function getAuthoredLesson(services: Services, rawToken: string, input: unknown): Promise<LessonAuthoringDraftDto> {
  const { deckId } = LessonDraftGetInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    await requireIntegrationScope(tx, rawToken, LESSONS_WRITE_SCOPE);
    const { versionId, context } = await currentVersion(tx, deckId);
    const { subject, topic } = versionLesson(services, context);
    const dto = await readLessonDraftDto(tx, services, versionId);
    return {
      deckId: dto.deckId,
      draftId: dto.id,
      status: dto.status,
      editNumber: dto.editNumber,
      title: dto.title,
      subjectId: dto.subjectId,
      topicId: dto.topicId,
      topicVersion: dto.topicVersion,
      objectiveIds: dto.objectiveIds,
      ...(context.subjectTitlePl === undefined ? {} : { subjectTitlePl: context.subjectTitlePl }),
      objectives: topic.objectives.map((objective) => ({
        id: objective.id,
        titlePl: objective.titlePl,
        cards: objective.cards.map((card) => ({ title: card.title, body: card.body })),
        exerciseTypes: authorableTypes(subject, objective).types,
      })),
      material: context.material,
      examples: dto.examples,
      ...(dto.story === undefined ? {} : { story: dto.story }),
      exercises: dto.exercises.map(authoringExercise),
      ...draftFindings(services, dto),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Pola zadania z kontraktu wejścia (lista dozwolonych), bez rewizji i stanów nagrań. */
function authoringExercise(exercise: LessonDraftDto["exercises"][number]): LessonAuthoringDraftDto["exercises"][number] {
  const { id, exerciseType, objectiveId, answer, acceptedAnswers, focus } = exercise;
  const optional = Object.fromEntries(AUTHORING_OPTIONAL_FIELDS.flatMap((key) => (exercise[key] === undefined ? [] : [[key, exercise[key]]])));
  return { ...optional, id: id!, exerciseType, objectiveId, answer, acceptedAnswers, focus };
}

const AUTHORING_OPTIONAL_FIELDS = [
  "instructionPl", "stem", "statement", "prompt", "hint", "transformId", "visualSubject", "noticeSegments", "options",
  "correctOption", "items", "questionType", "requiredElements", "supplementaryElements", "commonErrors", "expectedForm",
  "familyId", "sourceRefs", "calculation", "keywordOptions", "keyOptionIds", "pairs", "extraRight", "groups", "groupItems",
  "clozeText", "gapAnswers", "extraWords", "voiceTone", "explanationPl",
] as const satisfies readonly (keyof LessonExerciseInput)[];

/** Pola opcjonalne zadania (poza `id`) brakujące na liście; nowe pole kontraktu bez wpisu nie skompiluje się. */
type UnlistedOptionalField = Exclude<
  { [K in keyof LessonExerciseInput]-?: undefined extends LessonExerciseInput[K] ? K : never }[keyof LessonExerciseInput],
  "id" | (typeof AUTHORING_OPTIONAL_FIELDS)[number]
>;
type AssertNone<T extends never> = T;
export type AuthoringOptionalFieldsComplete = AssertNone<UnlistedOptionalField>;

/**
 * Run generowania puli ćwiczeń w toku: narzędzie nie przerywa pracy rodzica (edycja
 * zamknęłaby run przez `supersedeLessonRuns`). Run historyjki nie blokuje, jak przy
 * edycji rodzica: nie zależy od numeru edycji i przeżywa edycję ćwiczeń, a poprawka
 * z polem `story` unieważnia go w `editLessonDraftTx`.
 */
async function hasActiveLessonPoolRun(tx: Tx, versionId: string): Promise<boolean> {
  const [row] = await tx.select({ id: generationRuns.id }).from(generationRuns)
    .where(and(eq(generationRuns.kind, "lesson"), eq(generationRuns.deckVersionId, versionId), inArray(generationRuns.state, ["queued", "running"]), lessonPoolRunFilter()))
    .limit(1);
  return row !== undefined;
}

/** Pula po dopisaniu: zapisane zadania z `id`, potem nowe; ponad limit zapisu → `validation`. */
function appended(stored: readonly StoredExercise[], added: readonly LessonExerciseInput[]): LessonExerciseInput[] {
  if (added.some((exercise) => exercise.id !== undefined)) throw invalid("appended exercises are new: leave id out");
  if (stored.length + added.length > LESSON_AUTHORING_MAX_EXERCISES) {
    throw invalid(`the lesson would have ${stored.length + added.length} exercises; the limit is ${LESSON_AUTHORING_MAX_EXERCISES}`);
  }
  return [...stored, ...added];
}

type ExercisesWrite = Omit<LessonDraftReplaceInput, "exercises"> & { exercises: LessonExerciseInput[] };

/**
 * Zapis zadań szkicu w transakcji wołającego: pełna lista albo (`append`) dopisanie na koniec puli.
 * Bez szkicu `expectedEditNumber` dotyczy wersji opublikowanej, a kopia szkicu i edycja dzieją się
 * w tej transakcji (błąd → brak szkicu). Zwraca stan po zapisie i liczbę zadań sprzed zapisu.
 */
async function writeExercisesTx(tx: Tx, services: Services, rawToken: string, valid: ExercisesWrite, append: boolean) {
  await requireIntegrationScope(tx, rawToken, LESSONS_WRITE_SCOPE);
  const deck = await authorableDeck(tx, valid.deckId);
  let versionId = await editableVersionId(tx, deck.id);
  let expectedEditNumber = valid.expectedEditNumber;
  if (versionId === undefined) {
    if (!deck.publishedVersionId) throw new AppError("conflict");
    const published = await lockVersion(tx, deck.publishedVersionId);
    if (published.editNumber !== expectedEditNumber) throw new AppError("conflict");
    versionId = await createVersionFromPublished(tx, deck.id, (innerTx, { source, newVersionId }) =>
      copyRevisionsSkillsAssets(innerTx, { sourceVersionId: source.id, newVersionId, deckId: deck.id }),
    );
    expectedEditNumber = 1;
  } else {
    const version = await lockVersion(tx, versionId);
    if (version.editNumber !== expectedEditNumber) throw new AppError("conflict");
    if (await hasActiveLessonPoolRun(tx, versionId)) throw new AppError("conflict", { message: "an exercise generation run of this draft is in progress" });
  }
  const version = await lockVersion(tx, versionId);
  const context = readLessonContext(version.lessonContext);
  const stored = await storedExercises(tx, services, versionId);
  const exercises = append ? appended(stored, valid.exercises) : valid.exercises;
  const story = valid.story === undefined ? context.story : valid.story ?? undefined;
  const lesson: AuthoredLesson = {
    ...versionLesson(services, context),
    objectiveIds: context.objectiveIds,
    material: context.material,
    examples: valid.examples ?? context.examples,
    ...(story === undefined ? {} : { story }),
    exercises,
  };
  assertLessonInput(lesson, stored);
  assertLessonValid(lesson);
  const dto = await editLessonDraftTx(tx, services, versionId, {
    expectedEditNumber,
    exercises,
    ...(valid.examples === undefined ? {} : { examples: valid.examples }),
    ...(valid.story === undefined ? {} : { story: valid.story }),
    ...(valid.title === undefined ? {} : { title: valid.title }),
  });
  return { dto, storedCount: stored.length };
}

/** Poprawka szkicu pełną listą zadań: zadanie z `id` zachowuje element i historię, bez `id` jest nowe, pominięte znika. */
export async function replaceAuthoredLesson(services: Services, rawToken: string, input: unknown): Promise<LessonDraftWriteResult> {
  const valid = LessonDraftReplaceInputSchema.parse(input);
  return services.db.transaction(async (tx) => writeResult(services, (await writeExercisesTx(tx, services, rawToken, valid, false)).dto));
}

/** Dopisanie nowych zadań na koniec puli: zapisane zadania zachowują `id` i historię, walidowana jest cała pula. */
export async function appendAuthoredLesson(services: Services, rawToken: string, input: unknown): Promise<LessonDraftAppendResult> {
  const valid = LessonDraftAppendInputSchema.parse(input);
  return services.db.transaction(async (tx) => {
    const { dto, storedCount } = await writeExercisesTx(tx, services, rawToken, valid, true);
    return { ...writeResult(services, dto), exerciseIds: dto.exercises.slice(storedCount).map((exercise) => exercise.id!) };
  });
}
