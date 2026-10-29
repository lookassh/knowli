// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { makeExerciseProps } from "../test/exercise-fixtures";
import { ExerciseView } from "./ExerciseView";

afterEach(cleanup);

const task: TaskDto = {
  taskId: "10000000-0000-4000-8000-000000000005",
  sessionId: "10000000-0000-4000-8000-000000000003",
  ordinal: 0, exerciseType: "speech", direction: "source_to_target", state: "issued",
  prompt: { kind: "speech", text: "cat", visualType: "none", imageAssetId: null, audioAssetId: null },
  remainingAssessed: 1,
};

it("offers neutral continuation when the microphone is unavailable", () => {
  const props = makeExerciseProps(task, { micAvailable: false });
  renderKid(<ExerciseView {...props} />);
  expect(screen.queryByText("Pomiń")).toBeNull();
  fireEvent.click(screen.getByTestId("kid-technical-next"));
  expect(props.handlers.onSkip).toHaveBeenCalledTimes(1);
  expect(props.handlers.onNotRemember).not.toHaveBeenCalled();
});

it("does not offer technical continuation when the microphone is available", () => {
  renderKid(<ExerciseView {...makeExerciseProps(task, { micAvailable: true, recordingNotice: "Przytrzymaj przycisk i powiedz całe słowo." })} />);
  expect(screen.queryByTestId("kid-technical-next")).toBeNull();
});

it("offers continuation after a technical recording problem", () => {
  renderKid(<ExerciseView {...makeExerciseProps(task, { micAvailable: true, technicalRecordingIssue: true })} />);
  expect(screen.getByTestId("kid-technical-next")).toBeTruthy();
});
