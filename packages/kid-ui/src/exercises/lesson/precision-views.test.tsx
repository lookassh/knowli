// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { MAX_TEXT_ATTEMPT_LENGTH, type TaskDto, type TaskPrompt } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../../test/render-kid";
import { makeExerciseProps } from "../../test/exercise-fixtures";
import { ExerciseView } from "../ExerciseView";
import { LessonKeywordsView } from "./LessonKeywordsView";
import { LessonShortenView } from "./LessonShortenView";

afterEach(cleanup);

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function task(prompt: TaskPrompt, exerciseType: TaskDto["exerciseType"]): TaskDto {
  return { taskId: id(1), sessionId: id(2), ordinal: 1, exerciseType, direction: null, state: "issued", prompt, remainingAssessed: 1 };
}

const keywordsPrompt: TaskPrompt = {
  kind: "lesson_keywords",
  instructionPl: "Wybierz 2–3 najważniejsze pojęcia do tej odpowiedzi.",
  prompt: "Na czym polega fotosynteza?",
  options: [
    { id: id(11), text: "światło" },
    { id: id(12), text: "dwutlenek węgla" },
    { id: id(13), text: "korzenie" },
    { id: id(14), text: "tlen" },
    { id: id(15), text: "kolor kwiatów" },
  ],
  minSelected: 2,
  maxSelected: 3,
};

const shortenPrompt: TaskPrompt = {
  kind: "lesson_shorten",
  instructionPl: "Skróć odpowiedź. Usuń zaznaczone fragmenty, zostaw to, co najważniejsze.",
  prompt: "Na czym polega fotosynteza?",
  originalAnswer: "Wczoraj w ogrodzie widziałem, że roślina z wody i dwutlenku węgla robi cukier w świetle.",
  answerSegments: [
    { text: "Wczoraj w ogrodzie widziałem, że ", state: "pill" },
    { text: "roślina z wody i dwutlenku węgla robi cukier w świetle.", state: "plain" },
  ],
};

const options = () => screen.getAllByTestId("kid-option") as HTMLButtonElement[];
const check = () => screen.getByTestId("kid-lesson-check") as HTMLButtonElement;

describe("lesson_keywords — wybór pojęć kluczowych", () => {
  it("dispatches by prompt kind and shows the question with a selection counter", () => {
    renderKid(<ExerciseView {...makeExerciseProps(task(keywordsPrompt, "lesson_keywords"))} />);
    expect(screen.getByTestId("kid-lesson-keywords")).toBeTruthy();
    expect(screen.getByTestId("kid-lesson-source").textContent).toBe("Na czym polega fotosynteza?");
    expect(screen.getByTestId("kid-instruction").textContent).toContain("Wybierz 2–3 najważniejsze pojęcia");
    expect(screen.getByTestId("kid-lesson-keywords-count").textContent).toBe("Wybrane: 0 z 3");
    expect(screen.getByTestId("kid-lesson-keywords-options").getAttribute("aria-label")).toBe("Pojęcia do wyboru");
  });

  it("toggles tiles without answering and keeps the check disabled below minSelected", () => {
    const props = makeExerciseProps(task(keywordsPrompt, "lesson_keywords"));
    renderKid(<LessonKeywordsView {...props} />);
    expect(check().disabled).toBe(true);
    expect(options()[0]!.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(options()[0]!);
    expect(options()[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("kid-lesson-keywords-count").textContent).toBe("Wybrane: 1 z 3");
    expect(check().disabled).toBe(true);
    expect(props.handlers.onAnswerChoice).not.toHaveBeenCalled();
    expect(props.handlers.onAnswerSelection).not.toHaveBeenCalled();
    expect(props.handlers.onEdit).toHaveBeenCalledTimes(1);

    // Ponowne dotknięcie odznacza.
    fireEvent.click(options()[0]!);
    expect(options()[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("kid-lesson-keywords-count").textContent).toBe("Wybrane: 0 z 3");
  });

  it("cannot select more than maxSelected and submits the chosen set as a selection", () => {
    const props = makeExerciseProps(task(keywordsPrompt, "lesson_keywords"));
    renderKid(<LessonKeywordsView {...props} />);
    fireEvent.click(options()[3]!);
    fireEvent.click(options()[0]!);
    expect(check().disabled).toBe(false);
    fireEvent.click(options()[1]!);
    expect(screen.getByTestId("kid-lesson-keywords-count").textContent).toBe("Wybrane: 3 z 3");
    // Pełny wybór: pozostałe kafelki są wyłączone, wybrane można odznaczyć.
    expect(options()[2]!.disabled).toBe(true);
    expect(options()[4]!.disabled).toBe(true);
    expect(options()[0]!.disabled).toBe(false);
    fireEvent.click(options()[2]!);
    expect(options()[2]!.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(check());
    expect(props.handlers.onAnswerSelection).toHaveBeenCalledTimes(1);
    const sent = (props.handlers.onAnswerSelection as unknown as { mock: { calls: string[][][] } }).mock.calls[0]![0]!;
    expect([...sent].sort()).toEqual([id(11), id(12), id(14)]);
  });

  it("keyboard digits toggle tiles; busy blocks toggling and submitting", () => {
    const props = makeExerciseProps(task(keywordsPrompt, "lesson_keywords"));
    const view = renderKid(<LessonKeywordsView {...props} />);
    fireEvent.keyDown(window, { key: "2" });
    expect(options()[1]!.getAttribute("aria-pressed")).toBe("true");
    view.rerender(<LessonKeywordsView {...props} busy />);
    fireEvent.click(options()[0]!);
    expect(options()[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(check().disabled).toBe(true);
  });

  it("clears the selection after retry", () => {
    const props = makeExerciseProps(task(keywordsPrompt, "lesson_keywords"));
    const view = renderKid(<LessonKeywordsView {...props} />);
    fireEvent.click(options()[0]!);
    fireEvent.click(options()[1]!);
    view.rerender(<LessonKeywordsView {...props} dock={<span>wynik</span>} />);
    // Werdykt na ekranie: wybór jest zamrożony.
    expect(options()[2]!.disabled).toBe(true);
    view.rerender(<LessonKeywordsView {...props} />);
    expect(screen.getByTestId("kid-lesson-keywords-count").textContent).toBe("Wybrane: 0 z 3");
    expect(options().every((option) => option.getAttribute("aria-pressed") === "false")).toBe(true);
  });
});

describe("lesson_shorten — skracanie własnej odpowiedzi", () => {
  it("dispatches an open-answer task by prompt kind and renders the original with marked fragments", () => {
    renderKid(<ExerciseView {...makeExerciseProps(task(shortenPrompt, "lesson_open_answer"))} />);
    expect(screen.getByTestId("kid-lesson-shorten")).toBeTruthy();
    expect(screen.getByTestId("kid-lesson-source").textContent).toBe("Na czym polega fotosynteza?");
    const original = screen.getByTestId("kid-lesson-shorten-original");
    expect(original.textContent).toContain("Twoja odpowiedź");
    const pills = screen.getAllByTestId("kid-spelling-pill");
    expect(pills).toHaveLength(1);
    expect(pills[0]!.textContent).toBe("Wczoraj w ogrodzie widziałem, że ");
    expect(pills[0]!.className).toContain("kid-spelling-pill--remove");
    expect(original.textContent).toContain("Do usunięcia: Wczoraj w ogrodzie widziałem, że");
  });

  it("starts the multi-line field with the original answer and submits the edited text", () => {
    const props = makeExerciseProps(task(shortenPrompt, "lesson_open_answer"));
    renderKid(<LessonShortenView {...props} />);
    const input = screen.getByTestId("kid-lesson-input") as HTMLTextAreaElement;
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.value).toBe(shortenPrompt.kind === "lesson_shorten" ? shortenPrompt.originalAnswer : "");
    expect(input.maxLength).toBe(MAX_TEXT_ATTEMPT_LENGTH);
    expect(screen.getByLabelText("Krótsza odpowiedź")).toBe(input);
    // Pole nie przejmuje fokusu przy starcie (klawiatura nie zasłania zaznaczeń).
    expect(document.activeElement).not.toBe(input);
    expect(check().disabled).toBe(false);

    fireEvent.change(input, { target: { value: "Roślina z wody i dwutlenku węgla robi cukier w świetle." } });
    expect(props.handlers.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(check());
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith("Roślina z wody i dwutlenku węgla robi cukier w świetle.");
  });

  it("Enter submits, Shift+Enter does not, and an empty field cannot be checked", () => {
    const props = makeExerciseProps(task(shortenPrompt, "lesson_open_answer"));
    renderKid(<LessonShortenView {...props} />);
    const input = screen.getByTestId("kid-lesson-input") as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.handlers.onSubmitText).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.handlers.onSubmitText).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "   " } });
    expect(check().disabled).toBe(true);
  });

  it("offers skip (allowed for the shorten step) and restores the original after retry", () => {
    const props = makeExerciseProps(task(shortenPrompt, "lesson_open_answer"));
    const view = renderKid(<LessonShortenView {...props} />);
    expect(screen.queryByTestId("kid-not-remember")).toBeNull();
    fireEvent.click(screen.getByTestId("kid-skip"));
    expect(props.handlers.onSkip).toHaveBeenCalledTimes(1);

    const input = () => screen.getByTestId("kid-lesson-input") as HTMLTextAreaElement;
    fireEvent.change(input(), { target: { value: "Robi cukier." } });
    view.rerender(<LessonShortenView {...props} dock={<span>wynik</span>} />);
    view.rerender(<LessonShortenView {...props} />);
    expect(input().value).toBe(shortenPrompt.kind === "lesson_shorten" ? shortenPrompt.originalAnswer : "");
    expect(document.activeElement).toBe(input());
  });
});
