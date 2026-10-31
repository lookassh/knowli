import type { FeedbackDto, KidDeckDto, TaskDto } from "@learning/contracts";
import type { Page } from "@playwright/test";
import { installKidUiFixture, type KidUiFixture } from "./kid-ui-fixture";
import { lessonAudioFixture } from "./lesson-audio";

/** Shared builders of mocked Kid UI sessions: one profile, one deck, a written recall task. */

export const childId = "10000000-0000-4000-8000-000000000001";
export const deckId = "10000000-0000-4000-8000-000000000002";
export const sessionId = "10000000-0000-4000-8000-000000000003";
export const taskId = "10000000-0000-4000-8000-000000000004";
export const attemptId = "10000000-0000-4000-8000-000000000010";
const assetId = "10000000-0000-4000-8000-000000000006";
const optionIds = ["10000000-0000-4000-8000-000000000007", "10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];

export function baseFixture() {
  return {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" as const }],
    decks: [{ deckId, title: "Dni tygodnia", itemCount: 7, independentlyRecalledCount: 0, testDate: null,
      recommended: true, mockTestAvailable: false, activeSession: null }],
    session: { mode: "training" as const, sessionId, childId, deckId, deckVersionId: "10000000-0000-4000-8000-000000000005",
      policyId: "default", microphoneEnabled: false, state: "active" as const, taskBudget: 1, tasksIssued: 1,
      assessedTasksIssued: 1, startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
  };
}

/** The base session with one written recall task (nothing answered yet); `recordingMode` is the profile's. */
export function recallFixture(recordingMode: "hold" | "toggle" = "hold") {
  const base = baseFixture();
  return {
    ...base,
    profiles: [{ ...base.profiles[0]!, recordingMode }],
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
  };
}

/** A letter-completion task: `fragment` is the word or phrase in which "_" marks a missing letter. */
export function letterTask(prompt: string, fragment: string): TaskDto {
  return { taskId, sessionId, ordinal: 0, state: "issued", remainingAssessed: 1, exerciseType: "letter_completion",
    direction: "source_to_target", prompt: { kind: "letter_completion", prompt, fragment } };
}

/** One issued task of the given prompt kind with fixed texts (the layout specs only need its shape). */
export function taskFor(kind: TaskDto["prompt"]["kind"]): TaskDto {
  const common = { taskId, sessionId, ordinal: 0, state: "issued" as const, remainingAssessed: 1 };
  if (kind === "exposure") return { ...common, exerciseType: "exposure" as const, direction: null, prompt: {
    kind: "exposure" as const, source: "kot", target: "cat", example: "The cat is sleeping.", audioAssetId: assetId,
    exampleAudioAssetId: assetId, imageAssetId: assetId, visualType: "image" as const,
  } };
  if (kind === "listening") return { ...common, exerciseType: "listening" as const, direction: "target_to_source" as const, prompt: {
    kind: "listening" as const, audioAssetId: assetId,
    options: ["marzec", "kwiecień", "październik"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "reading") return { ...common, exerciseType: kind, direction: "target_to_source", prompt: {
    kind, text: "cat", options: ["kot", "pies", "ptak"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "reverse_recognition") return { ...common, exerciseType: kind, direction: "target_to_source", prompt: {
    kind, prompt: "kot", options: ["cat", "dog", "bird"].map((text, index) => ({ id: optionIds[index]!, text })),
  } };
  if (kind === "spelling") return { ...common, exerciseType: "spelling" as const, direction: "source_to_target" as const, prompt: { kind, prompt: "kot" } };
  if (kind === "letter_completion") return letterTask("kot", "c_t");
  if (kind === "speech") return { ...common, exerciseType: "speech" as const, direction: "source_to_target" as const, prompt: { kind, text: "cat", audioAssetId: assetId, imageAssetId: null, visualType: "none" as const } };
  return { ...common, exerciseType: "recall" as const, direction: "source_to_target" as const, prompt: { kind: "recall" as const, prompt: "kot" } };
}

/** A written recall task answered by one completed attempt; `feedback` is what the dock shows. */
export function completedRecallFixture({ feedback = { kind: "great" } }: { feedback?: FeedbackDto } = {}) {
  return {
    ...baseFixture(),
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "recall" as const, direction: "source_to_target" as const,
      state: "issued" as const, prompt: { kind: "recall" as const, prompt: "kot" }, remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "text" as const,
      feedback, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

const textChoiceOptionIds = [31, 32, 33, 34].map((suffix) => `10000000-0000-4000-8000-0000000000${suffix}`);

/** A text choice (reading) with four options; the first one is answered correctly and the result panel is a real footer (flow feedback). */
export function completedTextChoiceFixture() {
  return {
    ...baseFixture(),
    tasks: [{ taskId, sessionId, ordinal: 0, exerciseType: "reading" as const, direction: "target_to_source" as const,
      state: "issued" as const, prompt: { kind: "reading" as const, text: "cat",
        options: ["kot", "pies", "ptak", "ryba"].map((text, index) => ({ id: textChoiceOptionIds[index]!, text })) },
      remainingAssessed: 1 }],
    attempts: [{ attemptId, taskId, state: "completed" as const, modality: "choice" as const,
      feedback: { kind: "great" as const }, taskState: "completed" as const, stepId: null,
      receivedAt: "2026-10-11T10:00:00.000Z", completedAt: "2026-10-11T10:00:01.000Z" }],
  };
}

/** Lesson card body at the schema limit (1200 characters), as in lesson-card-audio-layout.spec.ts. */
const LONG_LESSON_CARD_BODY = (
  "Pająki nie są owadami, chociaż wiele osób tak myśli. • Pająk ma osiem nóg, a owad sześć. "
  + "• Ciało pająka składa się z dwóch części: głowotułowia i odwłoka. • Pająki nie mają czułków ani skrzydeł. "
  + "Większość pająków tka sieci z cienkich, mocnych nici, które wytwarzają kądziołki na końcu odwłoka. "
).repeat(5).slice(0, 1200).trim();

/** A lesson session whose only task is the longest card (long title, 1200-character body, three examples) with its recording. */
export function longLessonCardFixture(): KidUiFixture {
  const ids = {
    childId: "10000000-0000-4000-8000-000000000b01",
    deckId: "10000000-0000-4000-8000-000000000b02",
    sessionId: "10000000-0000-4000-8000-000000000b03",
    deckVersionId: "10000000-0000-4000-8000-000000000b04",
  };
  const card: TaskDto = {
    taskId: "10000000-0000-4000-8000-000000000b11", sessionId: ids.sessionId, ordinal: 0, exerciseType: "lesson_card",
    direction: null, state: "issued", remainingAssessed: 2,
    prompt: {
      kind: "lesson_card",
      card: {
        title: "Czym różnią się pająki od owadów żyjących w ogrodzie za domem?",
        body: LONG_LESSON_CARD_BODY,
        examples: ["Pająk krzyżak tka okrągłą sieć.", "Mucha ma sześć nóg i skrzydła.", "Kosarz ma bardzo długie nogi."],
      },
      questionAudioAssetId: "10000000-0000-4000-8000-000000000b21",
    },
  };
  return lessonAudioFixture(ids, [card], { assessedTasksIssued: 0 });
}

export function makeDeck(index: number, options: Partial<KidDeckDto> = {}): KidDeckDto {
  return {
    deckId: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    title: `Angielski zestaw ${index + 1}`,
    itemCount: 12,
    independentlyRecalledCount: 3,
    testDate: "2026-10-23",
    recommended: index % 2 === 0,
    mockTestAvailable: true,
    activeSession: null,
    ...options,
  };
}

/** Opens the deck screen of a single profile with the given decks (no task is issued). */
export async function openDeckScreen(page: Page, decks: KidDeckDto[]) {
  page.setDefaultTimeout(5_000);
  await installKidUiFixture(page, {
    profiles: [{ childId, displayName: "Szymon", avatarKey: "cat", recordingMode: "hold" }],
    decks,
    session: { mode: "training", sessionId, childId, deckId: decks[0]?.deckId ?? makeDeck(0).deckId,
      deckVersionId: "10000000-0000-4000-8000-000000000004", policyId: "default", microphoneEnabled: false,
      state: "active", taskBudget: 1, tasksIssued: 0, assessedTasksIssued: 0,
      startedAt: "2026-10-11T10:00:00.000Z", resumed: false },
    tasks: [],
  });
  await page.goto("/");
  await page.getByTestId("kid-profile").click();
}
