// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { makeExerciseProps } from "../test/exercise-fixtures";
import { LetterCompletionView } from "./LetterCompletionView";

afterEach(cleanup);

function letterTask(fragment: string): TaskDto {
  return {
    taskId: "10000000-0000-4000-8000-000000000015",
    sessionId: "10000000-0000-4000-8000-000000000003",
    ordinal: 0,
    exerciseType: "letter_completion",
    direction: "source_to_target",
    state: "issued",
    prompt: { kind: "letter_completion", prompt: "Miło Cię poznać", fragment },
    remainingAssessed: 1,
  };
}

// "n_ce to m__t you": gaps at 1, 9 and 10, spaces at 4, 7 and 12.
const FRAGMENT = "n_ce to m__t you";

function renderLetters() {
  const props = makeExerciseProps(letterTask(FRAGMENT));
  renderKid(<LetterCompletionView {...props} />);
  const fragment = screen.getByTestId("kid-fragment");
  const inputs = screen.getAllByTestId("kid-letter-input") as HTMLInputElement[];
  return { props, fragment, inputs };
}

describe("LetterCompletionView word grouping", () => {
  it("lays the fragment out as words separated by fixed spaces", () => {
    const { fragment } = renderLetters();

    const words = [...fragment.querySelectorAll(".kid-letter-word")];
    expect(words.map((word) => word.children.length)).toEqual([4, 2, 4, 3]);
    // Words are direct children of the row and the spaces between them are fixed characters of their own.
    expect([...fragment.children].map((child) => child.className)).toEqual([
      "kid-letter-word", "kid-letter-fixed", "kid-letter-word", "kid-letter-fixed",
      "kid-letter-word", "kid-letter-fixed", "kid-letter-word",
    ]);
    expect([...fragment.querySelectorAll(":scope > .kid-letter-fixed")].map((space) => space.textContent)).toEqual([" ", " ", " "]);
    // Inside a word only fixed letters and letter fields stand, in the order of the fragment.
    expect([...fragment.querySelectorAll(".kid-letter-word")].map((word) =>
      [...word.children].map((child) => child.matches("input.kid-letter-input") ? "_" : child.textContent).join(""))).toEqual(["n_ce", "to", "m__t", "you"]);
  });

  it("keeps the letter fields in order with their position labels", () => {
    const { inputs } = renderLetters();

    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual([
      "Brakująca litera, miejsce 2",
      "Brakująca litera, miejsce 10",
      "Brakująca litera, miejsce 11",
    ]);
    expect(screen.getByTestId("kid-fragment").getAttribute("aria-label")).toBe("Uzupełnij brakujące litery");
  });

  it("submits the whole phrase, spaces included, once every gap is filled", () => {
    const { props, inputs } = renderLetters();

    expect(document.activeElement).toBe(inputs[0]);
    fireEvent.change(inputs[0]!, { target: { value: "i" } });
    expect(document.activeElement).toBe(inputs[1]);
    fireEvent.change(inputs[1]!, { target: { value: "e" } });
    expect(document.activeElement).toBe(inputs[2]);
    fireEvent.submit(inputs[2]!.form!);
    expect(props.handlers.onSubmitText).not.toHaveBeenCalled();

    fireEvent.change(inputs[2]!, { target: { value: "e" } });
    expect(props.handlers.onEdit).toHaveBeenCalledTimes(3);
    fireEvent.submit(inputs[2]!.form!);
    expect(props.handlers.onSubmitText).toHaveBeenCalledExactlyOnceWith("nice to meet you");
  });

  it("moves between gaps in different words with the arrows and Backspace", () => {
    const { inputs } = renderLetters();
    const [first, second, third] = inputs as [HTMLInputElement, HTMLInputElement, HTMLInputElement];
    expect(first.closest(".kid-letter-word")).not.toBe(second.closest(".kid-letter-word"));
    expect(second.closest(".kid-letter-word")).toBe(third.closest(".kid-letter-word"));

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);

    // An empty gap hands focus back to the previous gap, across the space between the words.
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(document.activeElement).toBe(first);
  });
});
