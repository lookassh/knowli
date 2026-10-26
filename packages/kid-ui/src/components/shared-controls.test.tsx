// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { WordChoiceButton } from "./WordChoiceButton";
import { LessonBlockButton } from "./LessonBlockButton";
import { LetterField } from "./LetterField";
import { ProfileChoiceButton } from "./ProfileChoiceButton";

afterEach(cleanup);

describe("shared kid controls", () => {
  it("WordChoiceButton sends the choice, keeps aria-pressed and blocks when disabled", () => {
    const onClick = vi.fn();
    const { rerender } = renderKid(
      <WordChoiceButton data-testid="word" aria-pressed onClick={onClick}>kot</WordChoiceButton>,
    );
    const word = screen.getByTestId("word");
    expect(word.tagName).toBe("BUTTON");
    expect(word.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(word);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<WordChoiceButton data-testid="word" disabled onClick={onClick}>kot</WordChoiceButton>);
    fireEvent.click(screen.getByTestId("word"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("LessonBlockButton keeps listitem semantics for both order variants", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    renderKid(
      <>
        <LessonBlockButton data-testid="pool-block" role="listitem" aria-label="Dodaj: kot" onClick={onAdd}>kot</LessonBlockButton>
        <LessonBlockButton data-testid="placed-block" role="listitem" aria-label="Cofnij: kot" onClick={onRemove}>kot</LessonBlockButton>
      </>,
    );
    fireEvent.click(screen.getByTestId("pool-block"));
    fireEvent.click(screen.getByTestId("placed-block"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("placed-block").getAttribute("role")).toBe("listitem");
  });

  it("LetterField forwards ref, maxLength and typed value", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    renderKid(<LetterField ref={ref} data-testid="letter" maxLength={1} aria-label="Litera" onChange={onChange} />);
    const input = screen.getByTestId("letter") as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.maxLength).toBe(1);
    fireEvent.change(input, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("a");
  });

  it("ProfileChoiceButton selects the profile on click", () => {
    const onClick = vi.fn();
    renderKid(<ProfileChoiceButton data-testid="kid-profile" onClick={onClick}>Szymon</ProfileChoiceButton>);
    fireEvent.click(screen.getByTestId("kid-profile"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
