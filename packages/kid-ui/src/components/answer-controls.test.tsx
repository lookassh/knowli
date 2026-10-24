// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ActionButton } from "./ActionButton";
import { IconActionButton } from "./IconActionButton";
import { AnswerField } from "./AnswerField";
import { AnswerGrid } from "./AnswerGrid";
import { SessionProgress } from "./SessionProgress";
import styles from "./answer-controls.module.css";

afterEach(cleanup);

const options = [
  { id: "one", label: "Jeden", content: <span>①</span> },
  { id: "two", label: "Dwa", content: <span>②</span> },
  { id: "three", label: "Trzy", content: <span>③</span> },
];

describe("AnswerGrid", () => {
  it("sends a chosen option immediately and once while pending disables more choices", () => {
    const onChoose = vi.fn();
    const optionRefs = { current: [] as (HTMLButtonElement | null)[] };
    const view = (disabled: boolean, outcomes = new Map()) => (
      <AnswerGrid
        options={options}
        outcomes={outcomes}
        disabled={disabled}
        onChoose={onChoose}
        optionRefs={optionRefs}
      />
    );

    const { rerender } = renderKid(view(false));
    fireEvent.click(screen.getAllByTestId("kid-option")[0]!.firstChild as Element);
    expect(onChoose.mock.calls).toEqual([["one"]]);
    fireEvent.keyDown(screen.getAllByTestId("kid-option")[0]!, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-pressed")).toBeNull();
    expect(screen.queryByTestId("kid-submit")).toBeNull();

    rerender(view(true, new Map([["one", "pending"]])));
    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("kid-outcome-correct")).toBeNull();
    expect(screen.queryByTestId("kid-outcome-wrong")).toBeNull();
    fireEvent.click(screen.getAllByTestId("kid-option")[1]!);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("exposes server outcomes in accessible names without color-only feedback", () => {
    renderKid(
      <AnswerGrid
        options={options}
        outcomes={new Map([["one", "wrong"], ["two", "correct"]])}
        disabled={false}
        onChoose={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-label")).toContain("błędny wybór: Jeden");
    expect(screen.getAllByTestId("kid-outcome-correct")).toHaveLength(1);
    expect(screen.getByTestId("kid-outcome-wrong").getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps visual-only labels accessible and writes the keyboard refs", () => {
    const optionRefs = { current: [] as (HTMLButtonElement | null)[] };
    renderKid(
      <AnswerGrid options={options} outcomes={new Map()} disabled={false} onChoose={vi.fn()} visualOnly optionRefs={optionRefs} />,
    );

    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-label")).toBe("Jeden");
    expect(screen.getAllByTestId("kid-option-label")[0]!.getAttribute("aria-hidden")).toBe("true");
    expect(optionRefs.current[0]).toBe(screen.getAllByTestId("kid-option")[0]);
    expect(screen.getAllByTestId("kid-option")).toHaveLength(3);
  });
});

describe("ActionButton and AnswerField", () => {
  it("keeps native form attributes, refs and keyboard handlers", () => {
    const ref = createRef<HTMLButtonElement>();
    const onKeyDown = vi.fn();
    const submit = vi.fn();
    renderKid(
      <form id="answer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <ActionButton ref={ref} type="submit" form="answer" onKeyDown={onKeyDown}>Sprawdź</ActionButton>
      </form>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Sprawdź" }), { key: "Enter" });
    expect(ref.current).toBe(screen.getByRole("button", { name: "Sprawdź" }));
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sprawdź" }).getAttribute("type")).toBe("submit");
    expect(screen.getByRole("button", { name: "Sprawdź" }).getAttribute("form")).toBe("answer");
    expect(screen.getByRole("button", { name: "Sprawdź" }).className).toContain("mantine-UnstyledButton-root");
    expect(screen.getByRole("button", { name: "Sprawdź" }).className).not.toContain("mantine-Button-root");
    fireEvent.click(screen.getByRole("button", { name: "Sprawdź" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps icon actions at a named 48px square target", () => {
    const onClick = vi.fn();
    renderKid(<IconActionButton aria-label="Posłuchaj" onClick={onClick}><span aria-hidden="true">▶</span></IconActionButton>);
    const button = screen.getByRole("button", { name: "Posłuchaj" });
    expect(button.style.width).toBe("48px");
    expect(button.style.height).toBe("48px");
    expect(button.style.minWidth).toBe("48px");
    expect(button.style.minHeight).toBe("48px");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact controlled input value and spelling attributes", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    renderKid(
      <AnswerField
        ref={ref}
        aria-label="Wpisz słowo"
        value=" ca "
        onChange={onChange}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        label="Etykieta pola"
        classNames={{ input: "custom-input", label: "custom-label" }}
      />,
    );
    const input = screen.getByLabelText("Wpisz słowo") as HTMLInputElement;
    expect(ref.current).toBe(input);
    expect(input.value).toBe(" ca ");
    expect(input.autocomplete).toBe("off");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.classList.contains("custom-input")).toBe(true);
    expect(input.classList.contains(styles.input)).toBe(true);
    expect(screen.getByText("Etykieta pola").classList.contains("custom-label")).toBe(true);
  });
});

describe("SessionProgress", () => {
  it("renders only the existing remaining-task message", () => {
    const { rerender } = renderKid(<SessionProgress remaining={null} />);
    expect(screen.queryByTestId("kid-remaining")).toBeNull();
    rerender(<SessionProgress remaining={2} />);
    expect(screen.getByTestId("kid-remaining").textContent).toContain("2");
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
