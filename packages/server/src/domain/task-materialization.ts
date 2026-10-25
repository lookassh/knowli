import type { MeaningVisual, TaskPrompt, VisualType } from "@learning/contracts";
import { buildLetterFragment } from "./letter-fragment";
import type { PlannedOption, TaskPlan } from "./scheduler";

export interface PlannedItem {
  itemId: string;
  source: string;
  target: string;
  acceptedAnswers: string[];
  visualType: VisualType;
  visualData?: Record<string, unknown>;
  example?: string;
  sourceLocale: string;
  targetLocale: string;
  meaningVisual?: MeaningVisual;
  listeningVisual?: MeaningVisual;
}

export interface IdentifiedTaskOption extends PlannedOption {
  readonly id: string;
}

export interface TaskContentInput {
  readonly plan: Pick<TaskPlan, "exerciseType" | "direction" | "pictureRecall">;
  readonly item: PlannedItem;
  readonly options: readonly IdentifiedTaskOption[];
  readonly audioAssetId: string | null;
  readonly imageAssetId: string | null;
  readonly exampleAudioAssetId: string | null;
}

export interface TaskContent {
  prompt: TaskPrompt;
  answerKey: Record<string, unknown>;
}

/** Builds the immutable prompt and private answer key from fully prepared data. */
export function buildTaskContent(input: TaskContentInput): TaskContent {
  const { plan, item, options, audioAssetId, imageAssetId, exampleAudioAssetId } = input;
  const promptOptions = options.map(({ id, text }) => ({ id, text }));
  const picturePromptOptions = options.map(({ id, text, visual }) => ({ id, labelPl: text, visual: visual! }));
  const optionIds = new Map(options.map(({ text, id }) => [text, id] as const));
  const correctOption = options.find((option) => option.correct);
  const answerKey: Record<string, unknown> = {
    exerciseType: plan.exerciseType,
    target: item.target,
    acceptedAnswers: item.acceptedAnswers,
    ...(plan.direction ? { direction: plan.direction } : {}),
    ...(correctOption ? { correctOptionId: optionIds.get(correctOption.text)! } : {}),
    ...(options.length > 0
      ? { optionItemRevisionIds: Object.fromEntries(options.map((option) => [optionIds.get(option.text)!, option.itemRevisionId])) }
      : {}),
  };

  let prompt: TaskPrompt;
  switch (plan.exerciseType) {
    case "exposure":
      prompt = item.meaningVisual
        ? { kind: "picture_exposure", visual: item.meaningVisual, audioAssetId }
        : {
          kind: "exposure",
          source: item.source,
          target: item.target,
          example: item.example ?? null,
          audioAssetId,
          exampleAudioAssetId,
          imageAssetId,
          visualType: item.visualType,
          ...(item.visualType !== "image" && item.visualType !== "none" && item.visualData !== undefined
            ? { visualData: item.visualData }
            : {}),
        };
      break;
    case "listening":
      prompt = options.length > 0 && options.every((option) => option.visual !== undefined)
        ? { kind: "picture_listening", options: picturePromptOptions, audioAssetId: audioAssetId! }
        : { kind: "listening", options: promptOptions, audioAssetId: audioAssetId! };
      break;
    case "reading":
      prompt = { kind: "reading", text: item.target, options: promptOptions };
      break;
    case "reverse_recognition":
      prompt = { kind: "reverse_recognition", prompt: item.source, options: promptOptions };
      break;
    case "picture_recognition":
      // No answer audio here; replaying it before assessment would disclose the target.
      prompt = { kind: "picture_recognition", visual: item.meaningVisual ?? item.listeningVisual!, source: item.source, options: promptOptions };
      break;
    case "recall":
      prompt = plan.pictureRecall
        ? { kind: "picture_recall", visual: item.meaningVisual! }
        : { kind: "recall", prompt: item.source };
      break;
    case "spelling":
      prompt = { kind: "spelling", prompt: item.source };
      break;
    case "letter_completion":
      prompt = { kind: "letter_completion", prompt: item.source, fragment: buildLetterFragment(item.target) };
      break;
    case "speech":
      prompt = item.meaningVisual
        ? { kind: "picture_speech", visual: item.meaningVisual, audioAssetId }
        : {
          kind: "speech",
          text: item.target,
          audioAssetId,
          imageAssetId,
          visualType: item.visualType,
          ...(item.visualType !== "image" && item.visualType !== "none" && item.visualData !== undefined
            ? { visualData: item.visualData }
            : {}),
        };
      break;
  }
  return { prompt, answerKey };
}
