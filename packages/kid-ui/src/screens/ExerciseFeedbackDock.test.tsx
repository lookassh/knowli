// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, renderKid, screen } from "../test/render-kid";
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
