// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { ExerciseFeedbackDock, FEEDBACK_TONE_ICONS } from "./ExerciseFeedbackDock";

afterEach(cleanup);

it.each(Object.entries(FEEDBACK_TONE_ICONS))("shows the %s tone with the %s icon badge", (tone, icon) => {
  renderKid(
    <ExerciseFeedbackDock tone={tone as keyof typeof FEEDBACK_TONE_ICONS} primary={<span>Dalej</span>}>
      <p>Wynik</p>
    </ExerciseFeedbackDock>,
  );
  const badge = screen.getByTestId("kid-feedback-tone-icon");
  expect(badge.getAttribute("data-icon")).toBe(icon);
  expect(badge.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTestId("kid-feedback-dock").getAttribute("data-tone")).toBe(tone);
});

it("maps every tone to its icon", () => {
  expect(FEEDBACK_TONE_ICONS).toEqual({ correct: "check", partial: "almost", incorrect: "close", technical: "info", neutral: "info" });
});

it("renders the guidance next to the badge inside the dock", () => {
  renderKid(
    <ExerciseFeedbackDock tone="partial" primary={<span>Dalej</span>} guidance={<button type="button" data-testid="kid-guidance-play">Odsłuchaj</button>}>
      <p>Prawie!</p>
    </ExerciseFeedbackDock>,
  );
  const dock = screen.getByTestId("kid-feedback-dock");
  expect(dock.contains(screen.getByTestId("kid-guidance-play"))).toBe(true);
  expect(dock.contains(screen.getByTestId("kid-feedback-tone-icon"))).toBe(true);
});

it("renders the sentence replay as a listen button that calls onPlay", () => {
  const onPlay = vi.fn();
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={{ onPlay }}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  const button = screen.getByRole("button", { name: "Posłuchaj zdania" });
  expect(button.classList.contains("kid-listen")).toBe(true);
  expect(screen.getByTestId("kid-feedback-dock").contains(button)).toBe(true);
  fireEvent.click(button);
  expect(onPlay).toHaveBeenCalledOnce();
});

it("renders no sentence replay without the prop", () => {
  renderKid(
    <ExerciseFeedbackDock tone="correct" primary={<span>Dalej</span>} sentenceAudio={null}>
      <p>Świetnie!</p>
    </ExerciseFeedbackDock>,
  );
  expect(screen.queryByRole("button", { name: "Posłuchaj zdania" })).toBeNull();
  expect(screen.queryByTestId("kid-sentence-audio")).toBeNull();
});

it("renders the explanation row with a listen button that calls onPlay", () => {
  const onPlay = vi.fn();
  renderKid(
    <ExerciseFeedbackDock tone="incorrect" primary={<span>Dalej</span>}
      explanation={{ text: "Po he dodajemy -s do czasownika.", onPlay }}>
      <p>Spróbuj jeszcze raz</p>
    </ExerciseFeedbackDock>,
  );
  const dock = screen.getByTestId("kid-feedback-dock");
  const text = screen.getByTestId("kid-explanation-text");
  expect(text.textContent).toBe("Po he dodajemy -s do czasownika.");
  expect(dock.contains(text)).toBe(true);
  const button = screen.getByRole("button", { name: "Posłuchaj wyjaśnienia" });
  expect(button.getAttribute("data-testid")).toBe("kid-explanation-audio");
  expect(button.getAttribute("title")).toBe("Posłuchaj wyjaśnienia");
  expect(button.classList.contains("kid-listen")).toBe(true);
  // przycisk na początku wiersza, przed tekstem
  expect(button.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(button);
  expect(onPlay).toHaveBeenCalledOnce();
});

it("renders the explanation text without a listen button when there is no recording", () => {
  renderKid(
    <ExerciseFeedbackDock tone="incorrect" primary={<span>Dalej</span>} explanation={{ text: "Po he dodajemy -s." }}>
      <p>Spróbuj jeszcze raz</p>
    </ExerciseFeedbackDock>,
  );
  expect(screen.getByTestId("kid-explanation-text").textContent).toBe("Po he dodajemy -s.");
  expect(screen.queryByTestId("kid-explanation-audio")).toBeNull();
  expect(screen.queryByRole("button", { name: "Posłuchaj wyjaśnienia" })).toBeNull();
});

it("renders no explanation row without the prop", () => {
  renderKid(
    <ExerciseFeedbackDock tone="incorrect" primary={<span>Dalej</span>} explanation={null}>
      <p>Spróbuj jeszcze raz</p>
    </ExerciseFeedbackDock>,
  );
  expect(screen.queryByTestId("kid-explanation-text")).toBeNull();
  expect(screen.queryByTestId("kid-explanation")).toBeNull();
});
