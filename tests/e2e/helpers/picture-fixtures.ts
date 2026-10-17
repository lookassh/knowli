import type { KidUiFixture } from "./kid-ui-fixture";

const childId = "10000000-0000-4000-8000-000000000001";
const deckId = "10000000-0000-4000-8000-000000000002";
const secondDeckId = "10000000-0000-4000-8000-000000000013";
const sessionId = "10000000-0000-4000-8000-000000000003";
const versionId = "10000000-0000-4000-8000-000000000004";
const taskIds = ["10000000-0000-4000-8000-000000000005", "10000000-0000-4000-8000-000000000006"];
const optionIds = ["10000000-0000-4000-8000-000000000008", "10000000-0000-4000-8000-000000000009"];
const attemptIds = ["10000000-0000-4000-8000-000000000010", "10000000-0000-4000-8000-000000000011"];

export function pictureVocabularyFixture(): KidUiFixture {
  return {
    profiles: [{ childId, displayName: "Ola", avatarKey: "fox", recordingMode: "hold", canRead: false }],
    decks: [
      { deckId, title: "Kolory", itemCount: 2, independentlyRecalledCount: 0, testDate: null,
        recommended: true, mockTestAvailable: false, activeSession: null, vocabularyFormat: "picture", coverVisual: { kind: "color", color: "#ff0000" } },
      { deckId: secondDeckId, title: "Liczby", itemCount: 3, independentlyRecalledCount: 0, testDate: null,
        recommended: false, mockTestAvailable: false, activeSession: null, vocabularyFormat: "picture", coverVisual: { kind: "number", count: 4 } },
    ],
    session: { mode: "training", sessionId, childId, deckId, deckVersionId: versionId, policyId: "learning-v1",
      microphoneEnabled: false, canRead: false, vocabularyFormat: "picture", state: "active", taskBudget: 2,
      tasksIssued: 2, assessedTasksIssued: 1, startedAt: "2026-10-14T10:00:00.000Z", resumed: false },
    tasks: [
      { taskId: taskIds[0]!, sessionId, ordinal: 0, exerciseType: "exposure", direction: null, state: "issued",
        prompt: { kind: "picture_exposure", visual: { kind: "color", color: "#ff0000" }, audioAssetId: null }, remainingAssessed: 2 },
      { taskId: taskIds[1]!, sessionId, ordinal: 1, exerciseType: "listening", direction: null, state: "issued",
        prompt: { kind: "picture_listening", audioAssetId: "10000000-0000-4000-8000-000000000012", options: [
          { id: optionIds[0]!, labelPl: "czerwony", visual: { kind: "color", color: "#ff0000" } },
          { id: optionIds[1]!, labelPl: "niebieski", visual: { kind: "color", color: "#0000ff" } },
        ] }, remainingAssessed: 2 },
      null,
    ],
    attempts: [
      { attemptId: attemptIds[0]!, taskId: taskIds[1]!, state: "completed", modality: "choice", feedback: { kind: "great" },
        taskState: "completed", stepId: "step-1", receivedAt: "2026-10-14T10:00:01.000Z", completedAt: "2026-10-14T10:00:02.000Z" },
    ],
    summary: { sessionId, state: "completed", tasksIssued: 2, assessedTasksIssued: 1, endedAt: "2026-10-14T10:00:05.000Z",
      independentSuccesses: { recall: 0, spelling: 0 }, practiceItems: [], reward: { creditedSeconds: 0, pointsEarned: 0 } },
    presentation: { taskId: taskIds[0]!, state: "completed", completedAt: "2026-10-14T10:00:01.000Z" },
  };
}

export function pictureChoiceLayoutFixture(): KidUiFixture {
  const fixture = pictureVocabularyFixture();
  const listening = fixture.tasks[1];
  if (!listening || listening.prompt.kind !== "picture_listening") {
    throw new Error("picture listening fixture missing");
  }

  return {
    ...fixture,
    tasks: [
      fixture.tasks[0]!,
      {
        ...listening,
        prompt: {
          ...listening.prompt,
          options: [
            { id: "10000000-0000-4000-8000-000000000008", labelPl: "żółty", visual: { kind: "color", color: "#ffff00" } },
            { id: "10000000-0000-4000-8000-000000000009", labelPl: "jeden", visual: { kind: "number", count: 1 } },
            { id: "10000000-0000-4000-8000-000000000014", labelPl: "kot", visual: { kind: "image", imageAssetId: "10000000-0000-4000-8000-000000000015" } },
          ],
        },
      },
      fixture.tasks[2]!,
    ],
  };
}
