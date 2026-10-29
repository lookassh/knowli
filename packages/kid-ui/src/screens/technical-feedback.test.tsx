// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { SpeechFeedbackSecondaryActions, type SpeechFeedbackCardProps } from "./SpeechFeedbackCard";
import { AnswerFeedbackContent, AnswerFeedbackSecondaryActions } from "./AnswerFeedback";

afterEach(cleanup);

it("offers neutral continuation for an unassessed lesson", () => {
  const skip = vi.fn();
  renderKid(<AnswerFeedbackSecondaryActions dto={{ kind: "not_assessed" }} retry busy={false} onNext={vi.fn()} onSkip={skip} />);
  fireEvent.click(screen.getByRole("button", { name: "Dalej" }));
  expect(skip).toHaveBeenCalledTimes(1);
});

it("offers speech continuation for a technical result, but not a knowledge error", () => {
  const skip = vi.fn();
  const base: SpeechFeedbackCardProps = { dto: null, retry: true, busy: false, audioAvailable: false, audioError: false,
    exerciseType: "speech", onPlay: vi.fn(), onRetry: vi.fn(), onSkip: skip, onNext: vi.fn() };
  const { rerender } = renderKid(<SpeechFeedbackSecondaryActions {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Dalej" }));
  expect(skip).toHaveBeenCalledTimes(1);
  rerender(<SpeechFeedbackSecondaryActions {...base} dto={{ kind: "not_assessed" }} />);
  expect(screen.getByRole("button", { name: "Dalej" })).toBeTruthy();
  rerender(<SpeechFeedbackSecondaryActions {...base} dto={{ kind: "incorrect" }} />);
  expect(screen.queryByRole("button", { name: "Dalej" })).toBeNull();
});

it("renders a precision hint as praise with the shortening tip and no neutral continuation", () => {
  const hintPl = "Wiesz to! Teraz spróbuj powiedzieć to krócej, bez dodatkowych historii.";
  renderKid(<AnswerFeedbackContent dto={{ kind: "lesson_precision_hint", hintPl }} busy={false} />);
  const feedback = screen.getByTestId("kid-feedback");
  expect(feedback.className).toContain("kid-feedback--correct");
  expect(screen.getByRole("heading").textContent).toBe("Świetnie!");
  expect(screen.getByTestId("kid-lesson-feedback-hint").textContent).toBe(hintPl);
  expect(screen.queryByTestId("kid-lesson-answer-segments")).toBeNull();
  expect(screen.queryByTestId("kid-lesson-correct")).toBeNull();
  cleanup();
  renderKid(<AnswerFeedbackSecondaryActions dto={{ kind: "lesson_precision_hint", hintPl }} retry busy={false} onNext={vi.fn()} onSkip={vi.fn()} />);
  expect(screen.queryByTestId("kid-technical-next")).toBeNull();
});
