// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { makeExerciseProps } from "../test/exercise-fixtures";
import { ExposureView } from "./ExposureView";
import { PictureExposureView } from "./PictureExposureView";
import { ListeningView } from "./ListeningView";
import { ReadingView } from "./ReadingView";
import { PictureRecognitionView } from "./PictureRecognitionView";

const id = (suffix: string) => `10000000-0000-4000-8000-000000000${suffix}`;
const base = (kind: TaskDto["prompt"]["kind"], prompt: TaskDto["prompt"]): TaskDto => ({
  taskId: id("101"), sessionId: id("102"), ordinal: 0, exerciseType: kind as TaskDto["exerciseType"],
  direction: null, state: "issued", prompt, remainingAssessed: 1,
});
const options = [{ id: id("111"), text: "cat" }, { id: id("112"), text: "dog" }];
afterEach(cleanup);

describe("Mantine vocabulary views preserve exercise behavior", () => {
  it("exposure completion is a single complete-presentation action", () => {
    const task = base("exposure", { kind: "exposure", source: "kot", target: "cat", example: null, audioAssetId: null, exampleAudioAssetId: null, imageAssetId: null, visualType: "none" });
    const props = makeExerciseProps(task);
    renderKid(<ExposureView {...props} />);
    fireEvent.click(screen.getByTestId("kid-done"));
    expect(props.handlers.onComplete).toHaveBeenCalledOnce();
    expect(props.handlers.onAnswerChoice).not.toHaveBeenCalled();
    expect(props.handlers.onSubmitText).not.toHaveBeenCalled();
    expect(screen.getByTestId("kid-done").className).toContain("mantine-UnstyledButton-root");
  });

  it("picture exposure completes once and does not invent audio", () => {
    const task = base("picture_exposure", { kind: "picture_exposure", visual: { kind: "color", color: "#123456" }, audioAssetId: null });
    const props = makeExerciseProps(task);
    renderKid(<PictureExposureView {...props} />);
    expect(screen.queryByTestId("kid-play")?.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(screen.getByTestId("kid-done"));
    expect(props.handlers.onComplete).toHaveBeenCalledOnce();
    expect(screen.getByTestId("kid-done").className).toContain("mantine-UnstyledButton-root");
  });

  it.each([
    ["listening", { kind: "listening", options, audioAssetId: id("120") }],
    ["reading", { kind: "reading", text: "Thursday", options }],
    ["reverse_recognition", { kind: "reverse_recognition", prompt: "czwartek", options }],
    ["picture_recognition", { kind: "picture_recognition", visual: { kind: "color", color: "#123456" }, source: "kolor", options }],
  ] as const)("%s sends option id immediately, with Mantine answer controls", (_kind, prompt) => {
    const task = base(prompt.kind, prompt as TaskDto["prompt"]);
    const props = makeExerciseProps(task);
    const View = prompt.kind === "listening" ? ListeningView : prompt.kind === "picture_recognition" ? PictureRecognitionView : ReadingView;
    renderKid(<View {...props} />);
    fireEvent.click(screen.getAllByTestId("kid-option")[1]!);
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledOnce();
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledWith(options[1]!.id);
    expect(props.handlers.onSubmitText).not.toHaveBeenCalled();
    expect(screen.queryByTestId("kid-submit")).toBeNull();
    expect(screen.getAllByTestId("kid-option")[1]?.textContent).toBe("dog");
    expect(screen.queryByTestId("kid-option-content")).toBeNull();
    expect(screen.getAllByTestId("kid-option")[0]!.className).toContain("mantine-UnstyledButton");
  });

  it("pending stays neutral and picture recognition audio is only rendered for the supplied correct result", () => {
    const task = base("picture_recognition", { kind: "picture_recognition", visual: { kind: "color", color: "#123456" }, source: "kolor", options });
    const props = makeExerciseProps(task, { optionOutcomes: new Map([[options[0]!.id, "pending"]]) });
    renderKid(<PictureRecognitionView {...props} />);
    expect(screen.getAllByTestId("kid-option")[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("kid-outcome-correct")).toBeNull();
    expect(screen.queryByTestId("kid-option-audio")).toBeNull();
  });

  it("keeps picture-recognition answer language on each English option", () => {
    const task = base("picture_recognition", { kind: "picture_recognition", visual: { kind: "color", color: "#123456" }, source: "kolor", options });
    renderKid(<PictureRecognitionView {...makeExerciseProps(task)} />);
    expect(screen.getAllByTestId("kid-option")[0]?.getAttribute("lang")).toBe("en-GB");
    expect(screen.getAllByTestId("kid-option")[0]?.textContent).toBe("cat");
  });
});
