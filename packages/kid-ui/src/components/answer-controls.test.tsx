// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ActionButton } from "./ActionButton";
import { IconActionButton } from "./IconActionButton";
import { AnswerField, AnswerTextArea } from "./AnswerField";
import { AnswerGrid } from "./AnswerGrid";
import { SessionProgress } from "./SessionProgress";
import { GuidanceButton } from "./GuidanceButton";
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

  it("shows outcome icons as SVG, not text glyphs, and marks the short grid", () => {
    const { container } = renderKid(
      <AnswerGrid
        options={options}
        outcomes={new Map([["one", "wrong"], ["two", "correct"]])}
        disabled={false}
        onChoose={vi.fn()}
        choiceList
        shortChoiceGrid
      />,
    );

    for (const testId of ["kid-outcome-correct", "kid-outcome-wrong"]) {
      const outcome = screen.getByTestId(testId);
      expect(outcome.querySelector("svg.kid-icon")).not.toBeNull();
      expect(outcome.textContent).toBe("");
    }
    expect(container.querySelector("ul")!.className).toContain(styles.shortChoiceGrid);
  });

  it("celebrates only a tile the child chose correctly, never the revealed answer", () => {
    const grid = (outcomes: Map<string, "correct" | "wrong">) => (
      <AnswerGrid options={options} outcomes={outcomes} disabled onChoose={() => undefined} />
    );
    const { rerender } = renderKid(grid(new Map([["one", "correct"]])));
    expect(screen.getAllByTestId("kid-answer-burst")).toHaveLength(1);

    // Wrong choice: the server's correct option is lit green, but no burst.
    rerender(grid(new Map([["two", "wrong"], ["one", "correct"]])));
    expect(screen.getByTestId("kid-outcome-correct")).toBeTruthy();
    expect(screen.queryByTestId("kid-answer-burst")).toBeNull();
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

describe("AnswerGrid multi-select", () => {
  const grid = (selected: string[], onChoose = vi.fn(), disabled = false) => (
    <AnswerGrid
      options={options}
      outcomes={new Map()}
      disabled={disabled}
      onChoose={onChoose}
      selection={{ selectedIds: new Set(selected), maxSelected: 2 }}
      listLabel="Pojęcia do wyboru"
    />
  );

  it("marks chosen tiles with aria-pressed and a check mark, not colour alone", () => {
    renderKid(grid(["two"]));
    const [one, two] = screen.getAllByTestId("kid-option");
    expect(one!.getAttribute("aria-pressed")).toBe("false");
    expect(two!.getAttribute("aria-pressed")).toBe("true");
    expect(two!.getAttribute("data-selected")).toBe("true");
    const marks = screen.getAllByTestId("kid-option-select-mark");
    expect(marks).toHaveLength(3);
    expect(marks[1]!.getAttribute("data-selected")).toBe("true");
    expect(marks[1]!.querySelector("svg")).not.toBeNull();
    expect(marks[0]!.querySelector("svg")).toBeNull();
    expect(screen.getByRole("list").getAttribute("aria-label")).toBe("Pojęcia do wyboru");
    expect(screen.getByRole("list").getAttribute("data-selection")).toBe("multiple");
  });

  it("reports toggles and disables only unselected tiles once maxSelected is reached", () => {
    const onChoose = vi.fn();
    const { rerender } = renderKid(grid(["one"], onChoose));
    fireEvent.click(screen.getAllByTestId("kid-option")[2]!);
    expect(onChoose).toHaveBeenLastCalledWith("three");

    rerender(grid(["one", "three"], onChoose));
    const tiles = screen.getAllByTestId("kid-option") as HTMLButtonElement[];
    expect(tiles[1]!.disabled).toBe(true);
    expect(tiles[0]!.disabled).toBe(false);
    fireEvent.click(tiles[1]!);
    expect(onChoose).toHaveBeenCalledTimes(1);
    fireEvent.click(tiles[0]!);
    expect(onChoose).toHaveBeenLastCalledWith("one");

    rerender(grid(["one"], onChoose, true));
    expect((screen.getAllByTestId("kid-option") as HTMLButtonElement[]).every((tile) => tile.disabled)).toBe(true);
  });

  it("single-choice grids keep their previous semantics", () => {
    renderKid(<AnswerGrid options={options} outcomes={new Map()} disabled={false} onChoose={vi.fn()} />);
    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("aria-pressed")).toBeNull();
    expect(screen.getAllByTestId("kid-option")[0]!.getAttribute("data-selected")).toBeNull();
    expect(screen.queryByTestId("kid-option-select-mark")).toBeNull();
  });
});

describe("AnswerTextArea", () => {
  it("renders a styled multi-line field that forwards refs and submits its form on Enter only", () => {
    const ref = createRef<HTMLTextAreaElement>();
    const submit = vi.fn();
    renderKid(
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <AnswerTextArea ref={ref} aria-label="Krótsza odpowiedź" defaultValue="Ala ma kota" submitOnEnter />
      </form>,
    );
    const field = screen.getByRole("textbox", { name: "Krótsza odpowiedź" }) as HTMLTextAreaElement;
    expect(ref.current).toBe(field);
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.value).toBe("Ala ma kota");
    expect(field.className).toContain(styles.input);
    expect(field.className).toContain(styles.textarea);
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("keeps Enter as a new line without submitOnEnter", () => {
    const submit = vi.fn();
    renderKid(
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <AnswerTextArea aria-label="Notatka" />
      </form>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notatka" }), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button").className).toContain(styles.action);

    fireEvent.click(screen.getByRole("button", { name: "Sprawdź" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("resolves Material 3 variants with legacy priority as an alias", () => {
    renderKid(<ActionButton>Filled</ActionButton>);
    expect(screen.getByRole("button", { name: "Filled" }).getAttribute("data-variant")).toBe("filled");
    expect(screen.getByRole("button", { name: "Filled" }).getAttribute("data-priority")).toBe("primary");
    cleanup();

    renderKid(<ActionButton priority="secondary">Tonal</ActionButton>);
    expect(screen.getByRole("button", { name: "Tonal" }).getAttribute("data-variant")).toBe("tonal");
    cleanup();

    renderKid(<ActionButton variant="outlined" priority="secondary">Outlined</ActionButton>);
    const outlined = screen.getByRole("button", { name: "Outlined" });
    expect(outlined.getAttribute("data-variant")).toBe("outlined");
    expect(outlined.getAttribute("data-priority")).toBe("secondary");
    expect(outlined.style.borderRadius).toBe("var(--kid-shape-l)");
    cleanup();

    renderKid(<ActionButton variant="text">Text</ActionButton>);
    expect(screen.getByRole("button", { name: "Text" }).getAttribute("data-variant")).toBe("text");
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

        inputClassName="custom-input"
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

describe("sentence field and instruction guidance", () => {
  it("AnswerField sentence variant uses its own class; the default stays a word field", () => {
    renderKid(<><AnswerField aria-label="Słowo" /><AnswerField aria-label="Zdanie" variant="sentence" /></>);
    const word = screen.getByRole("textbox", { name: "Słowo" });
    const sentence = screen.getByRole("textbox", { name: "Zdanie" });
    expect(word.getAttribute("data-variant")).toBe("word");
    expect(word.className).not.toContain(styles.sentence);
    expect(sentence.getAttribute("data-variant")).toBe("sentence");
    expect(sentence.className).toContain(styles.input);
    expect(sentence.className).toContain(styles.sentence);
  });

  it("GuidanceButton in the instruction row is an outlined question with its own name; the dock keeps the speaker", () => {
    const onPlay = vi.fn(async () => {});
    renderKid(<GuidanceButton audioKey="listening" onPlay={onPlay} testId="kid-guidance-play" placement="instruction" />);
    const instruction = screen.getByTestId("kid-guidance-play");
    expect(instruction.getAttribute("aria-label")).toBe("Posłuchaj polecenia");
    expect(instruction.getAttribute("data-variant")).toBe("outlined");
    // The question icon is the only one drawn with a circle; the speaker has none.
    expect(instruction.querySelector("svg circle")).not.toBeNull();
    fireEvent.click(instruction);
    expect(onPlay).toHaveBeenCalledWith("listening");
    cleanup();

    renderKid(<GuidanceButton audioKey="correct" onPlay={onPlay} testId="kid-guidance-play" />);
    const dock = screen.getByTestId("kid-guidance-play");
    expect(dock.getAttribute("aria-label")).toBe("Posłuchaj");
    expect(dock.getAttribute("data-variant")).toBe("tonal");
    expect(dock.querySelector("svg circle")).toBeNull();
  });

  it("GuidanceButton in the dock next to a sentence speaker is an outlined question that keeps the dock name", () => {
    const onPlay = vi.fn(async () => {});
    renderKid(<GuidanceButton audioKey="correct" onPlay={onPlay} testId="kid-guidance-play" icon="question" />);
    const dock = screen.getByTestId("kid-guidance-play");
    expect(dock.getAttribute("aria-label")).toBe("Posłuchaj");
    expect(dock.getAttribute("data-variant")).toBe("outlined");
    expect(dock.getAttribute("data-guidance-icon")).toBe("question");
    expect(dock.querySelector("svg circle")).not.toBeNull();
    fireEvent.click(dock);
    expect(onPlay).toHaveBeenCalledWith("correct");
  });
});
