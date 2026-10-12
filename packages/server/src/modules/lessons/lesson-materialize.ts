import { randomUUID } from "node:crypto";
import type { TaskPrompt } from "@learning/contracts";
import { AppError } from "../../errors";
import { computeTargetKey } from "../../domain/target-key";
import { renderCard } from "../../domain/lessons/card";
import type { LearningObjective, LessonExerciseType, LessonTopic, SubjectModule } from "../../domain/lessons/types";
import type { LessonTaskPlan } from "../../domain/lessons/scheduler";

/**
 * Materializacja zadań lekcji — część CZYSTA (poza `randomUUID` i zdeterminowanym
 * tasowaniem) wyciągnięta z `lesson-sessions.ts`, by `lesson-mock-tests.ts`
 * składał prompty i klucze dokładnie tak samo jak trening (brief zadania 17:
 * reużyj przez ekstrakcję, nie kopię). Zachowanie treningu jest niezmienione —
 * `lesson-sessions.ts` reeksportuje te same funkcje.
 */

/** Payload rewizji ćwiczenia lekcji (`item_revisions.payload`, payload_version 2). */
export interface LessonExercisePayload {
  exerciseType: LessonExerciseType;
  objectiveId: string;
  instructionPl?: string;
  stem?: string;
  statement?: string;
  prompt?: string;
  hint?: string;
  transformId?: string;
  noticeSegments?: string[][];
  answer: string;
  acceptedAnswers: string[];
  focus: string[];
  options?: { id: string; text: string }[];
  correctOption?: string;
  items?: { id: string; text: string }[];
  answerLocale: string;
  promptLocale: string;
}

export interface LoadedExercise {
  revisionId: string;
  itemId: string;
  position: number;
  payload: LessonExercisePayload;
  targetKey: string;
  audioAssetId: string | null;
}

export interface MaterializedLessonTask {
  exerciseType: LessonExerciseType;
  prompt: TaskPrompt;
  answerKey: Record<string, unknown>;
  exposures: string[];
  context: Record<string, unknown>;
  itemRevisionId: string;
}

/** Tasowanie zdeterminowane ziarnem (id zadania): mulberry32 na haszu id. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Polecenie przekształcenia z tematu, gdy payload go nie niesie. */
function transformInstruction(topic: LessonTopic, payload: LessonExercisePayload): string | undefined {
  if (payload.exerciseType !== "lesson_transform" || !payload.transformId) return undefined;
  return topic.transforms.find((t) => t.id === payload.transformId)?.instructionPl;
}

/** Składa kartę (prezentacja): treść karty tematu z przykładami lekcji. */
export function materializeCard(
  plan: Extract<LessonTaskPlan, { kind: "card" }>,
  cardIndex: number,
  objective: LearningObjective,
  subject: SubjectModule,
  examples: readonly string[],
  firstExerciseRevisionId: string,
): MaterializedLessonTask {
  const rendered = renderCard(objective.cards[cardIndex]!, [...examples]);
  return {
    exerciseType: "lesson_card",
    prompt: { kind: "lesson_card", card: rendered },
    answerKey: { exerciseType: "lesson_card", objectiveId: objective.id, subjectId: subject.id, cardPurpose: plan.cardPurpose },
    // Karta ujawnia przykłady → ekspozycje kluczy przykładów (znormalizowane w answerLocale).
    exposures: examples.map((example) => computeTargetKey(example, subject.answerLocale)),
    context: { objectiveId: objective.id, cardPurpose: plan.cardPurpose, cardIndex },
    itemRevisionId: firstExerciseRevisionId,
  };
}

/** Wejście materializacji ćwiczenia: plan albo surowy opis trybu kartkówki. */
export interface MaterializeExerciseInput {
  independentCheck: boolean;
  reason: string;
}

/**
 * Składa publiczny prompt (bez odpowiedzi, wariantów, focus, celu, kategorii),
 * prywatny `answer_key` i listę ekspozycji dla ćwiczenia. Czysta poza
 * `randomUUID` (nieznaczące id opcji/klocków/segmentów) i zdeterminowanym
 * tasowaniem na ziarnie `taskId`. `mockTest` wycina podpowiedź luki (bez
 * ujawnienia odpowiedzi w kartkówce).
 */
export function materializeExercise(
  plan: MaterializeExerciseInput,
  taskId: string,
  exercise: LoadedExercise,
  topic: LessonTopic,
  subject: SubjectModule,
  options: { mockTest?: boolean } = {},
): MaterializedLessonTask {
  const payload = exercise.payload;
  const objective = topic.objectives.find((o) => o.id === payload.objectiveId);
  const instructionPl = payload.instructionPl ?? transformInstruction(topic, payload) ?? objective?.titlePl ?? "";
  const mockTest = options.mockTest ?? false;

  const baseKey: Record<string, unknown> = {
    exerciseType: payload.exerciseType,
    objectiveId: payload.objectiveId,
    subjectId: subject.id,
    targetKey: exercise.targetKey,
    answer: payload.answer,
    acceptedAnswers: payload.acceptedAnswers,
    focus: payload.focus,
    independentCheck: plan.independentCheck,
    reason: plan.reason,
  };
  const taskContext: Record<string, unknown> = { reason: plan.reason, objectiveId: payload.objectiveId, independentCheck: plan.independentCheck };
  const common = { exerciseType: payload.exerciseType, itemRevisionId: exercise.revisionId, context: taskContext } as const;

  switch (payload.exerciseType) {
    case "lesson_notice": {
      const segments = (payload.noticeSegments ?? []).map((sentence) => sentence.map((text) => ({ id: randomUUID(), text })));
      const flat = segments.flat();
      const correct = flat.find((s) => s.text === payload.correctOption);
      const prompt: TaskPrompt = {
        kind: "lesson_notice",
        instructionPl,
        segments,
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), segmentValues: Object.fromEntries(flat.map((s) => [s.id, s.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_choice": {
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.text === payload.correctOption })), taskId);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_choice",
        instructionPl,
        stem: payload.stem ?? "",
        options: options.map((o) => ({ id: o.id, text: o.text })),
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_short_answer": {
      const options = seededShuffle((payload.options ?? []).map((o) => ({ id: randomUUID(), text: o.text, correct: o.text === payload.correctOption })), taskId);
      const correct = options.find((o) => o.correct);
      const prompt: TaskPrompt = {
        kind: "lesson_short_answer",
        question: payload.prompt ?? payload.stem ?? instructionPl,
        options: options.map((o) => ({ id: o.id, text: o.text })),
        ...(exercise.audioAssetId ? { audioAssetId: exercise.audioAssetId } : {}),
      };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, ...(correct ? { correctOptionId: correct.id } : {}), optionValues: Object.fromEntries(options.map((o) => [o.id, o.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_order": {
      const canonical = (payload.items ?? []).map((item) => ({ id: randomUUID(), text: item.text }));
      const shuffled = seededShuffle(canonical, taskId);
      const prompt: TaskPrompt = { kind: "lesson_order", instructionPl, items: shuffled.map((item) => ({ id: item.id, text: item.text })) };
      return {
        ...common,
        prompt,
        answerKey: { ...baseKey, itemIds: canonical.map((item) => item.id), itemValues: Object.fromEntries(canonical.map((item) => [item.id, item.text])) },
        exposures: [exercise.targetKey],
      };
    }
    case "lesson_gap": {
      // Kartkówka: żadnej podpowiedzi (ujawniałaby odpowiedź); trening zachowuje hint.
      const prompt: TaskPrompt = { kind: "lesson_gap", instructionPl, stemWithGap: payload.stem ?? "", ...(!mockTest && payload.hint ? { hint: payload.hint } : {}) };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_error_fix": {
      const prompt: TaskPrompt = { kind: "lesson_error_fix", instructionPl, statement: payload.statement ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_transform": {
      const prompt: TaskPrompt = { kind: "lesson_transform", instructionPl, statement: payload.statement ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    case "lesson_open_answer": {
      const prompt: TaskPrompt = { kind: "lesson_open_answer", instructionPl, prompt: payload.prompt ?? "" };
      return { ...common, prompt, answerKey: baseKey, exposures: [] };
    }
    default:
      throw new AppError("internal", { message: `cannot materialize lesson type ${payload.exerciseType}` });
  }
}
