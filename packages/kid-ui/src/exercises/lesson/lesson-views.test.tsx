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

describe("lesson exercise Mantine views", () => {
  it("lesson card completes the presentation and uses Mantine action", () => {
    const props = makeExerciseProps(task({ kind: "lesson_card", card: { title: "Reguła", body: "Dodaj -s", examples: ["He plays."] } }));
    renderKid(<LessonCardView {...props} />);
    expect(screen.getByTestId("kid-lesson-card-title").textContent).toBe("Reguła");
    const next = screen.getByTestId("kid-lesson-next");
    expect(next.className).toContain("mantine-Button-root");
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
    expect(screen.getByTestId("kid-lesson-listen").className).toContain("mantine-Button-root");
    fireEvent.click(screen.getByTestId("kid-lesson-listen"));
    expect(sentenceProps.handlers.onPlay).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByTestId("kid-lesson-input"), { target: { value: "He plays." } });
    fireEvent.click(screen.getByTestId("kid-lesson-check"));
    expect(sentenceProps.handlers.onSubmitText).toHaveBeenCalledWith("He plays.");
  });
});
