// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderKid, screen } from "../test/render-kid";
import { SpeechFeedbackSecondaryActions, type SpeechFeedbackCardProps } from "./SpeechFeedbackCard";
import { AnswerFeedbackSecondaryActions } from "./AnswerFeedback";

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
