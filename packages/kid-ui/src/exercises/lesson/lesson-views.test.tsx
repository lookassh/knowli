// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../../test/render-kid";
import type { TaskDto, TaskPrompt } from "@learning/contracts";
import { makeExerciseProps } from "../../test/exercise-fixtures";
import { LessonCardView } from "./LessonCardView";
import { LessonChoiceView } from "./LessonChoiceView";
import { LessonGapView } from "./LessonGapView";
import { LessonNoticeView } from "./LessonNoticeView";
import { LessonOrderView } from "./LessonOrderView";
import { LessonSentenceView } from "./LessonSentenceView";
import { LessonShortAnswerView } from "./LessonShortAnswerView";

afterEach(cleanup);

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function task(prompt: TaskPrompt): TaskDto {
  return { taskId: id(1), sessionId: id(2), ordinal: 1, exerciseType: prompt.kind as TaskDto["exerciseType"], direction: null, state: "issued", prompt, remainingAssessed: 1 };
}

describe("lesson exercise views", () => {
  it("lesson card completes the presentation and uses the shared action button", () => {
    const props = makeExerciseProps(task({ kind: "lesson_card", card: { title: "Reguła", body: "Dodaj -s", examples: ["He plays."] } }));
    renderKid(<LessonCardView {...props} />);
    expect(screen.getByTestId("kid-lesson-card-title").textContent).toBe("Reguła");
    const next = screen.getByTestId("kid-lesson-next");
    expect(next.tagName).toBe("BUTTON");
    fireEvent.click(next);
    expect(props.handlers.onComplete).toHaveBeenCalledOnce();
  });

  it("choice answers immediately by option id", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_choice", instructionPl: "Wybierz", stem: "He ___ football.",
      options: [{ id: id(3), text: "plays" }, { id: id(4), text: "play" }],
    }));
    renderKid(<LessonChoiceView {...props} />);
    fireEvent.click(screen.getAllByTestId("kid-option")[0]!);
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledWith(id(3));
    expect(screen.queryByTestId("kid-lesson-check")).toBeNull();
  });

  it("choice with a person pictogram shows the pictogram above the stem", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_choice", instructionPl: "Kto to jest? Wybierz", visualSubject: "girl", stem: "___ is happy.",
      options: [{ id: id(3), text: "She" }, { id: id(4), text: "He" }],
    }));
    renderKid(<LessonChoiceView {...props} />);
    expect(screen.getByTestId("kid-lesson-visual").textContent).toBe("👧");
    expect(screen.getByTestId("kid-lesson-visual").getAttribute("aria-label")).toBe("Dziewczynka");
    expect(screen.getByTestId("kid-lesson-stem").textContent).toBe("___ is happy.");
  });

  it("notice word sends its segment id without local grading", () => {
    const props = makeExerciseProps(task({ kind: "lesson_notice", instructionPl: "Dotknij", segments: [[{ id: id(3), text: "He" }]] }));
    renderKid(<LessonNoticeView {...props} />);
    fireEvent.click(screen.getByTestId("kid-lesson-notice-word"));
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledWith(id(3));
    expect(screen.getByTestId("kid-lesson-notice-word").className).not.toMatch(/correct|wrong/);
  });

  it("short answer sends a choice immediately", () => {
    const props = makeExerciseProps(task({ kind: "lesson_short_answer", question: "Does he play?", options: [{ id: id(5), text: "Yes" }] }));
    renderKid(<LessonShortAnswerView {...props} />);
    expect(screen.getByTestId("kid-lesson-short-answer").tagName).toBe("UL");
    fireEvent.click(screen.getByTestId("kid-option"));
    expect(props.handlers.onAnswerChoice).toHaveBeenCalledWith(id(5));
  });

  it("order submits ordered item ids, including duplicate visible words", () => {
    const props = makeExerciseProps(task({ kind: "lesson_order", instructionPl: "Ułóż", items: [{ id: id(3), text: "play" }, { id: id(4), text: "play" }] }));
    renderKid(<LessonOrderView {...props} />);
    fireEvent.click(screen.getAllByTestId("kid-lesson-order-block")[1]!);
    fireEvent.click(screen.getAllByTestId("kid-lesson-order-block")[0]!);
    fireEvent.click(screen.getByTestId("kid-lesson-check"));
    expect(props.handlers.onAnswerSequence).toHaveBeenCalledWith([id(4), id(3)]);
  });

  it("order keeps placed blocks when the same task arrives as a fresh prompt object", () => {
    const items = [{ id: id(3), text: "He" }, { id: id(4), text: "plays" }];
    const props = makeExerciseProps(task({ kind: "lesson_order", instructionPl: "Ułóż", items }));
    const view = renderKid(<LessonOrderView {...props} />);
    fireEvent.click(screen.getAllByTestId("kid-lesson-order-block")[0]!);
    expect(screen.getByTestId("kid-lesson-order-sentence").querySelectorAll("[data-testid='kid-lesson-order-placed']")).toHaveLength(1);
    const refreshed = makeExerciseProps(task({ kind: "lesson_order", instructionPl: "Ułóż", items: items.map((item) => ({ ...item })) }));
    view.rerender(<LessonOrderView {...refreshed} handlers={props.handlers} />);
    expect(screen.getByTestId("kid-lesson-order-sentence").querySelectorAll("[data-testid='kid-lesson-order-placed']")).toHaveLength(1);
  });

  it("order clears placed blocks and restores focus after retry", () => {
    const props = makeExerciseProps(task({ kind: "lesson_order", instructionPl: "U\u0142\u00f3\u017c", items: [{ id: id(3), text: "He" }, { id: id(4), text: "plays" }] }));
    const view = renderKid(<LessonOrderView {...props} />);
    fireEvent.click(screen.getAllByTestId("kid-lesson-order-block")[0]!);
    expect(screen.getAllByTestId("kid-lesson-order-placed")).toHaveLength(1);
    view.rerender(<LessonOrderView {...props} dock={<span>wynik</span>} />);
    view.rerender(<LessonOrderView {...props} />);
    expect(screen.queryAllByTestId("kid-lesson-order-placed")).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getAllByTestId("kid-lesson-order-block")[0]);
  });

  it("gap and sentence clear the draft and restore focus after retry", () => {
    const gapProps = makeExerciseProps(task({ kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "He ___ (play)." }));
    const gapView = renderKid(<LessonGapView {...gapProps} />);
    fireEvent.change(screen.getByTestId("kid-lesson-gap-input"), { target: { value: "plays" } });
    gapView.rerender(<LessonGapView {...gapProps} dock={<span>wynik</span>} />);
    const gapInput = screen.getByTestId("kid-lesson-gap-input") as HTMLInputElement;
    gapInput.blur();
    gapView.rerender(<LessonGapView {...gapProps} />);
    expect(gapInput.value).toBe("");
    expect(document.activeElement).toBe(gapInput);
    gapView.unmount();

    const sentenceProps = makeExerciseProps(task({ kind: "lesson_error_fix", instructionPl: "Popraw", statement: "He play." }));
    const sentenceView = renderKid(<LessonSentenceView {...sentenceProps} />);
    fireEvent.change(screen.getByTestId("kid-lesson-input"), { target: { value: "He plays." } });
    sentenceView.rerender(<LessonSentenceView {...sentenceProps} dock={<span>wynik</span>} />);
    const sentenceInput = screen.getByTestId("kid-lesson-input") as HTMLInputElement;
    sentenceInput.blur();
    sentenceView.rerender(<LessonSentenceView {...sentenceProps} />);
    expect(sentenceInput.value).toBe("");
    expect(document.activeElement).toBe(sentenceInput);
  });

  it("gap and sentence forms keep text payloads and only play issued audio", () => {
    const gapProps = makeExerciseProps(task({ kind: "lesson_gap", instructionPl: "Uzupełnij", stemWithGap: "He ___ (play)." }));
    const { unmount } = renderKid(<LessonGapView {...gapProps} />);
    expect(screen.queryByTestId("kid-lesson-listen")).toBeNull();
    fireEvent.change(screen.getByTestId("kid-lesson-gap-input"), { target: { value: "plays" } });
    fireEvent.click(screen.getByTestId("kid-lesson-check"));
    expect(gapProps.handlers.onSubmitText).toHaveBeenCalledWith("plays");
    unmount();

    const sentenceProps = makeExerciseProps(task({ kind: "lesson_error_fix", instructionPl: "Popraw", statement: "He play.", audioAssetId: id(9) }));
    renderKid(<LessonSentenceView {...sentenceProps} />);
    expect(screen.getByTestId("kid-lesson-listen").tagName).toBe("BUTTON");
    fireEvent.click(screen.getByTestId("kid-lesson-listen"));
    expect(sentenceProps.handlers.onPlay).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByTestId("kid-lesson-input"), { target: { value: "He plays." } });
    fireEvent.click(screen.getByTestId("kid-lesson-check"));
    expect(sentenceProps.handlers.onSubmitText).toHaveBeenCalledWith("He plays.");
  });
});
