// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { TaskDto } from "@learning/contracts";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { makeExerciseProps } from "../test/exercise-fixtures";
import { ExerciseView } from "./ExerciseView";

afterEach(cleanup);

function task(kind: "recall" | "spelling" = "recall", taskId = "10000000-0000-4000-8000-000000000005"): TaskDto {
  return {
    taskId,
    sessionId: "10000000-0000-4000-8000-000000000003",
    ordinal: 0,
    exerciseType: kind,
    direction: "source_to_target",
    state: "issued",
    prompt: { kind, prompt: "kot" },
    remainingAssessed: 1,
  };
}

function letterTask(taskId = "10000000-0000-4000-8000-000000000015"): TaskDto {
  return {
    taskId,
    sessionId: "10000000-0000-4000-8000-000000000003",
    ordinal: 0,
    exerciseType: "letter_completion",
    direction: "source_to_target",
    state: "issued",
    prompt: { kind: "letter_completion", prompt: "Uzupełnij słowo", fragment: "c_t" },
    remainingAssessed: 1,
  };
}

describe("written exercise controls", () => {
  it("offers a clear recall action without skipping or submitting an empty answer", () => {
    const props = makeExerciseProps(task());
    renderKid(<ExerciseView {...props} />);
    expect(screen.queryByTestId("kid-skip")).toBeNull();
    expect(screen.getByTestId("kid-not-remember").textContent).toBe("Nie pamiętam");
    fireEvent.click(screen.getByTestId("kid-not-remember"));
    expect(props.handlers.onNotRemember).toHaveBeenCalledTimes(1);
    expect(props.handlers.onSubmitText).not.toHaveBeenCalled();
  });
  it("submits the exact controlled value with Enter and the external form button", () => {
    const props = makeExerciseProps(task());
    const { rerender } = renderKid(<ExerciseView {...props} />);
    const input = screen.getByTestId("kid-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: " ca " } });
    fireEvent.submit(input.form!);
    expect(props.handlers.onSubmitText).toHaveBeenCalledExactlyOnceWith(" ca ");
    expect(props.handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(input.tagName).toBe("INPUT");

    rerender(<ExerciseView {...makeExerciseProps(task("recall", "10000000-0000-4000-8000-000000000006"), { handlers: props.handlers })} />);
    const nextInput = screen.getByTestId("kid-input") as HTMLInputElement;
    fireEvent.change(nextInput, { target: { value: " dog " } });
    fireEvent.click(screen.getByTestId("kid-submit"));
    expect(props.handlers.onSubmitText).toHaveBeenLastCalledWith(" dog ");
    expect(screen.getByTestId("kid-submit").tagName).toBe("BUTTON");
  });

  it("rejects empty/space-only values and disables submission while busy", () => {
    const handlers = makeExerciseProps(task()).handlers;
    const { rerender } = renderKid(<ExerciseView {...makeExerciseProps(task(), { handlers })} />);
    const input = screen.getByTestId("kid-input") as HTMLInputElement;
    fireEvent.submit(input.form!);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.form!);
    expect(handlers.onSubmitText).not.toHaveBeenCalled();

    rerender(<ExerciseView {...makeExerciseProps(task(), { handlers, busy: true })} />);
    expect(screen.getByTestId("kid-input").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("kid-submit").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("kid-not-remember").hasAttribute("disabled")).toBe(true);

    for (const overrides of [{ recording: true }, { recordingPhase: "preparing" as const }]) {
      rerender(<ExerciseView {...makeExerciseProps(task(), { handlers, ...overrides })} />);
      expect(screen.getByTestId("kid-input").hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId("kid-submit").hasAttribute("disabled")).toBe(true);
    }
  });

  it("keeps text across same-task rerenders and resets only when taskId changes", () => {
    const handlers = makeExerciseProps(task()).handlers;
    const { rerender } = renderKid(<ExerciseView {...makeExerciseProps(task(), { handlers })} />);
    fireEvent.change(screen.getByTestId("kid-input"), { target: { value: "ca" } });
    rerender(<ExerciseView {...makeExerciseProps(task(), { handlers, busy: true })} />);
    expect((screen.getByTestId("kid-input") as HTMLInputElement).value).toBe("ca");

    rerender(<ExerciseView {...makeExerciseProps(task("recall", "10000000-0000-4000-8000-000000000006"), { handlers })} />);
    expect((screen.getByTestId("kid-input") as HTMLInputElement).value).toBe("");
  });

  it("keeps spelling flags and preserves letter draft, sequence and exact submitted word", () => {
    const handlers = makeExerciseProps(letterTask()).handlers;
    const props = makeExerciseProps(letterTask(), {
      handlers,
      letterDraft: { 1: "a" },
      onLetterDraftChange: () => undefined,
    });
    renderKid(<ExerciseView {...props} />);
    const input = screen.getByTestId("kid-letter-input") as HTMLInputElement;
    expect(input.value).toBe("a");
    expect(input.autocomplete).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.tagName).toBe("INPUT");
    fireEvent.submit(input.form!);
    expect(handlers.onSubmitText).toHaveBeenCalledExactlyOnceWith("cat");
  });

  it("keeps the letter draft but restores focus to the gap after retry", () => {
    const handlers = makeExerciseProps(letterTask()).handlers;
    const base = makeExerciseProps(letterTask(), {
      handlers,
      letterDraft: { 1: "a" },
      onLetterDraftChange: () => undefined,
    });
    const { rerender } = renderKid(<ExerciseView {...base} dock={<span>wynik</span>} />);
    const input = screen.getByTestId("kid-letter-input") as HTMLInputElement;
    input.blur();
    expect(document.activeElement).not.toBe(input);
    rerender(<ExerciseView {...base} />);
    expect(input.value).toBe("a");
    expect(document.activeElement).toBe(input);
  });

  it("clears the written draft and restores focus after retry", () => {
    const handlers = makeExerciseProps(task()).handlers;
    const { rerender } = renderKid(<ExerciseView {...makeExerciseProps(task(), { handlers })} />);
    fireEvent.change(screen.getByTestId("kid-input"), { target: { value: "dog" } });
    rerender(<ExerciseView {...makeExerciseProps(task(), { handlers, dock: <span>wynik</span> })} />);
    const dockedInput = screen.getByTestId("kid-input") as HTMLInputElement;
    dockedInput.blur();
    expect(document.activeElement).not.toBe(dockedInput);
    rerender(<ExerciseView {...makeExerciseProps(task(), { handlers })} />);
    const input = screen.getByTestId("kid-input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });
});
