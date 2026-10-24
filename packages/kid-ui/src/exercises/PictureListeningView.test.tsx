// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { makeExerciseProps } from "../test/exercise-fixtures";
import { PictureListeningView } from "./PictureListeningView";

const task: TaskDto = {
  taskId: "10000000-0000-4000-8000-000000000005",
  sessionId: "10000000-0000-4000-8000-000000000003",
  ordinal: 0,
  exerciseType: "listening",
  direction: null,
  state: "issued",
  prompt: {
    kind: "picture_listening",
    audioAssetId: "10000000-0000-4000-8000-000000000012",
    options: [
      { id: "10000000-0000-4000-8000-000000000008", labelPl: "żółty", visual: { kind: "color", color: "#ffff00" } },
      { id: "10000000-0000-4000-8000-000000000009", labelPl: "jeden", visual: { kind: "number", count: 1 } },
      { id: "10000000-0000-4000-8000-000000000014", labelPl: "kot", visual: { kind: "image", imageAssetId: "10000000-0000-4000-8000-000000000015" } },
    ],
  },
  remainingAssessed: 2,
};

afterEach(cleanup);

describe("PictureListeningView", () => {
  it("sends choices immediately, keeps pending neutral and keeps audio separate", () => {
    const props = makeExerciseProps(task);
    renderKid(<PictureListeningView {...props} />);

    fireEvent.click(screen.getAllByTestId("kid-option")[0]!);
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledExactlyOnceWith(task.prompt.kind === "picture_listening" ? task.prompt.options[0]!.id : "");
    expect(screen.queryByTestId("kid-submit")).toBeNull();

    const play = screen.getByTestId("kid-play");
    fireEvent.click(play);
    expect(props.handlers.onPlay).toHaveBeenCalledTimes(1);
  });

  it("does not choose while busy and shows pending without a verdict", () => {
    const onAnswerChoice = vi.fn();
    const outcomes = new Map([[task.prompt.kind === "picture_listening" ? task.prompt.options[0]!.id : "", "pending" as const]]);
    renderKid(<PictureListeningView {...makeExerciseProps(task, { busy: true, optionOutcomes: outcomes, handlers: { ...makeExerciseProps(task).handlers, onAnswerChoice } })} />);

    fireEvent.click(screen.getAllByTestId("kid-option")[1]!);
    expect(onAnswerChoice).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("kid-outcome-correct")).toBeNull();
    expect(screen.queryByTestId("kid-outcome-wrong")).toBeNull();
  });
});
