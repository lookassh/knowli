// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../../test/render-kid";
import type { TaskDto, TaskPrompt } from "@learning/contracts";
import { makeExerciseProps } from "../../test/exercise-fixtures";
import { LessonCardView } from "./LessonCardView";
import { LessonChoiceView } from "./LessonChoiceView";
import { LessonGapView } from "./LessonGapView";
import { LessonGroupView } from "./LessonGroupView";
import { LessonMatchView } from "./LessonMatchView";
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

  it("notice word marks a server outcome with an icon, never a text glyph", () => {
    const outcomes = new Map<string, "correct" | "wrong">([[id(3), "correct"], [id(4), "wrong"]]);
    const props = makeExerciseProps(
      task({ kind: "lesson_notice", instructionPl: "Dotknij", segments: [[{ id: id(3), text: "He" }, { id: id(4), text: "plays" }, { id: id(5), text: "ball" }]] }),
      { optionOutcomes: outcomes },
    );
    renderKid(<LessonNoticeView {...props} />);
    const words = screen.getAllByTestId("kid-lesson-notice-word");
    const markers = screen.getAllByTestId("kid-lesson-notice-outcome");
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.getAttribute("aria-hidden")).toBe("true");
      expect(marker.querySelector("svg.kid-icon")).not.toBeNull();
      expect(marker.textContent).toBe("");
    }
    expect(markers[0]!.getAttribute("data-outcome")).toBe("correct");
    expect(markers[1]!.getAttribute("data-outcome")).toBe("wrong");
    expect(words[2]!.querySelector("[data-testid='kid-lesson-notice-outcome']")).toBeNull();
    expect(words.map((word) => word.textContent)).toEqual(["He", "plays", "ball"]);
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

  it("match: miejsca przyjmują elementy z puli, „Sprawdź” dopiero po komplecie, przypisania lewy → prawy", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_match", instructionPl: "Połącz",
      left: [{ id: id(3), text: "równik" }, { id: id(4), text: "południk" }, { id: id(5), text: "biegun" }],
      right: [{ id: id(6), text: "łączy bieguny" }, { id: id(7), text: "dzieli półkule" }, { id: id(8), text: "koniec osi" }, { id: id(9), text: "nad morzem" }],
    }));
    renderKid(<LessonMatchView {...props} />);
    const check = screen.getByTestId("kid-lesson-check") as HTMLButtonElement;
    expect(screen.getAllByTestId("kid-lesson-match-slot")[0]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("dzieli półkule"));
    fireEvent.click(screen.getByText("łączy bieguny"));
    expect(check.disabled).toBe(true);
    fireEvent.click(screen.getByText("koniec osi"));
    expect(screen.getAllByTestId("kid-lesson-match-option").map((el) => el.textContent)).toEqual(["nad morzem"]);
    expect(check.disabled).toBe(false);
    fireEvent.click(check);
    expect(props.handlers.onAnswerAssignment).toHaveBeenCalledWith([
      { itemId: id(3), targetId: id(7) }, { itemId: id(4), targetId: id(6) }, { itemId: id(5), targetId: id(8) },
    ]);
  });

  it("match: dotknięcie zajętego miejsca oddaje element do puli", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_match", instructionPl: "Połącz",
      left: [{ id: id(3), text: "a" }, { id: id(4), text: "b" }, { id: id(5), text: "c" }],
      right: [{ id: id(6), text: "x" }, { id: id(7), text: "y" }, { id: id(8), text: "z" }],
    }));
    renderKid(<LessonMatchView {...props} />);
    fireEvent.click(screen.getByText("x"));
    expect(screen.getAllByTestId("kid-lesson-match-option")).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("kid-lesson-match-slot")[0]!);
    expect(screen.getAllByTestId("kid-lesson-match-option")).toHaveLength(3);
  });

  it("group: elementy trafiają do aktywnej grupy, a „Sprawdź” wysyła przypisania element → grupa", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_group", instructionPl: "Pogrupuj",
      groups: [{ id: id(3), text: "ssaki" }, { id: id(4), text: "ptaki" }],
      items: [{ id: id(5), text: "sowa" }, { id: id(6), text: "pies" }, { id: id(7), text: "kot" }, { id: id(8), text: "wróbel" }],
    }));
    renderKid(<LessonGroupView {...props} />);
    const check = screen.getByTestId("kid-lesson-check") as HTMLButtonElement;
    fireEvent.click(screen.getByText("pies"));
    fireEvent.click(screen.getByText("kot"));
    fireEvent.click(screen.getAllByTestId("kid-lesson-group-target")[1]!);
    expect(screen.getAllByTestId("kid-lesson-group-target")[1]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("sowa"));
    expect(check.disabled).toBe(true);
    fireEvent.click(screen.getByText("wróbel"));
    fireEvent.click(check);
    expect(props.handlers.onAnswerAssignment).toHaveBeenCalledWith([
      { itemId: id(5), targetId: id(4) }, { itemId: id(6), targetId: id(3) }, { itemId: id(7), targetId: id(3) }, { itemId: id(8), targetId: id(4) },
    ]);
  });

  it("group: po wyniku (dock) przyciski są wyłączone", () => {
    const props = makeExerciseProps(task({
      kind: "lesson_group", instructionPl: "Pogrupuj",
      groups: [{ id: id(3), text: "ssaki" }, { id: id(4), text: "ptaki" }],
      items: [{ id: id(5), text: "sowa" }, { id: id(6), text: "pies" }, { id: id(7), text: "kot" }, { id: id(8), text: "wróbel" }],
    }));
    renderKid(<LessonGroupView {...props} dock={<span>wynik</span>} />);
    expect(screen.getAllByTestId("kid-lesson-group-item").every((el) => (el as HTMLButtonElement).disabled)).toBe(true);
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

  it("open answer uses the prompt locale when the server knows it, otherwise keeps en-GB", () => {
    const school = renderKid(<LessonSentenceView {...makeExerciseProps(task({ kind: "lesson_open_answer", instructionPl: "Odpowiedz.", prompt: "Co to jest skala?", promptLocale: "pl-PL" }))} />);
    expect(screen.getByTestId("kid-lesson-source").getAttribute("lang")).toBe("pl-PL");
    expect(screen.getByTestId("kid-lesson-input").getAttribute("lang")).toBe("pl-PL");
    school.unmount();
    renderKid(<LessonSentenceView {...makeExerciseProps(task({ kind: "lesson_open_answer", instructionPl: "Napisz.", prompt: "Write about your day." }))} />);
    expect(screen.getByTestId("kid-lesson-source").getAttribute("lang")).toBe("en-GB");
    expect(screen.getByTestId("kid-lesson-input").hasAttribute("lang")).toBe(false);
  });

  it("calculation shows the Polish prompt and sends the typed result verbatim by click or Enter", () => {
    const calculation = task({ kind: "lesson_calculation", instructionPl: "Oblicz.", prompt: "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m." });
    const props = makeExerciseProps(calculation);
    const { unmount } = renderKid(<LessonSentenceView {...props} />);
    const source = screen.getByTestId("kid-lesson-source");
    expect(source.textContent).toContain("1:25 000");
    expect(source.getAttribute("lang")).toBe("pl-PL");
    const input = screen.getByTestId("kid-lesson-input") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.maxLength).toBe(600);
    expect(input.getAttribute("lang")).toBe("pl-PL");
    expect(screen.queryByTestId("kid-lesson-listen")).toBeNull();
    fireEvent.change(input, { target: { value: "0,75 km" } });
    fireEvent.click(screen.getByTestId("kid-lesson-check"));
    expect(props.handlers.onSubmitText).toHaveBeenCalledWith("0,75 km");
    fireEvent.change(input, { target: { value: "1 250 m" } });
    fireEvent.submit(input.closest("form")!);
    expect(props.handlers.onSubmitText).toHaveBeenLastCalledWith("1 250 m");
    // Uproszczone akcje sesji (#145): w zadaniu zostaje tylko „Nie pamiętam”.
    expect(screen.queryByTestId("kid-skip")).toBeNull();
    fireEvent.click(screen.getByTestId("kid-not-remember"));
    expect(props.handlers.onNotRemember).toHaveBeenCalledOnce();
    unmount();

    const busyProps = makeExerciseProps(calculation, { busy: true });
    renderKid(<LessonSentenceView {...busyProps} />);
    const busyInput = screen.getByTestId("kid-lesson-input") as HTMLInputElement;
    expect(busyInput.disabled).toBe(true);
    // Non-empty text, so only the busy guard can stop the submission.
    fireEvent.change(busyInput, { target: { value: "0,75 km" } });
    fireEvent.submit(busyInput.closest("form")!);
    expect((screen.getByTestId("kid-lesson-check") as HTMLButtonElement).disabled).toBe(true);
    expect(busyProps.handlers.onSubmitText).not.toHaveBeenCalled();
  });
});
