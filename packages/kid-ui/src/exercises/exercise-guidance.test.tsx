// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
import { ExerciseFrame } from "./ExerciseFrame";
import { ExerciseGuidanceProvider } from "./exercise-guidance";
import { ExerciseFeedbackDock } from "../screens/ExerciseFeedbackDock";
import type { TaskDto } from "@learning/contracts";

afterEach(cleanup);

const task = {
  taskId: "t1", exerciseType: "reading", remainingAssessed: 3,
  prompt: { kind: "exposure", target: "cat", source: "kot", example: null },
} as unknown as TaskDto;

const button = <button type="button" data-testid="kid-guidance-play">Odsłuchaj</button>;

it("shows provided guidance next to the instruction and nothing without a provider", () => {
  const { unmount } = renderKid(<ExerciseFrame task={task} content={<p>treść</p>} />);
  expect(screen.queryByTestId("kid-guidance-play")).toBeNull();
  unmount();
  renderKid(<ExerciseGuidanceProvider value={button}><ExerciseFrame task={task} content={<p>treść</p>} /></ExerciseGuidanceProvider>);
  expect(screen.getByTestId("kid-instruction").contains(screen.getByTestId("kid-guidance-play"))).toBe(true);
});

it("renders the dock guidance inside the feedback dock", () => {
  renderKid(<ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} guidance={button}><p>Świetnie!</p></ExerciseFeedbackDock>);
  expect(screen.getByTestId("kid-feedback-dock").contains(screen.getByTestId("kid-guidance-play"))).toBe(true);
});
