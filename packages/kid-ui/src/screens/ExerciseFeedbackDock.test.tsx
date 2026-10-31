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
