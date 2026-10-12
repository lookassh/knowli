import { useEffect, useRef, type ReactElement } from "react";
import { messages, type FeedbackDto } from "@learning/contracts";
import { format } from "../format";
import { joinedText } from "./spelling-diff-view";

export interface AnswerFeedbackProps {
  dto: FeedbackDto | null;
  retry: boolean;
  busy: boolean;
  onNext: () => void;
}

function feedbackText(feedback: FeedbackDto | null): string {
  const dto = feedback ?? { kind: "not_assessed" as const };
  switch (dto.kind) {
    case "great": return messages.kid.feedbackGreat;
    case "almost": return messages.kid.feedbackAlmost;
    case "capitalization_hint": return format(messages.kid.feedbackCapitalization, { word: dto.correctText ?? "" });
    case "incorrect": return format(messages.kid.feedbackIncorrect, { word: dto.correctText ?? "" });
    case "spelling_hint":
      return dto.spellingDiff?.capitalizationHint
        ? format(messages.kid.feedbackSpellingCapitalization, { word: dto.correctText ?? "" })
        : messages.kid.feedbackSpelling;
    case "content_matched": return messages.kid.feedbackContentMatched;
    case "not_assessed": return messages.kid.feedbackNotAssessed;
    case "lesson_almost": return messages.kid.feedbackAlmost;
    case "lesson_hint": return dto.hintPl ?? messages.kid.feedbackSpelling;
  }
}

/** Wynik serwera dla wyboru/pisma; tekst i ton nie są wyliczane z odpowiedzi klienta. */
export function feedbackTone(feedback: FeedbackDto | null): string {
  const dto = feedback ?? { kind: "not_assessed" as const };
  switch (dto.kind) {
    case "great":
    case "capitalization_hint": return "kid-feedback--correct";
    case "almost":
    case "incorrect":
    case "spelling_hint": return "kid-feedback--retry";
    case "content_matched":
    case "not_assessed": return "";
    case "lesson_almost": return "kid-feedback--retry";
    case "lesson_hint": return "kid-feedback--retry";
  }
}

export function AnswerFeedback({ dto, retry, busy, onNext }: AnswerFeedbackProps): ReactElement {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Moving focus off a written field dismisses the mobile keyboard without scrolling the page.
    titleRef.current?.focus({ preventScroll: true });
  }, [dto, retry]);

  const feedback = dto ?? { kind: "not_assessed" as const };
  return (
    <section
      className={["kid-answer-feedback", feedbackTone(dto)].filter(Boolean).join(" ")}
      data-testid="kid-feedback"
      role="status"
      aria-live="polite"
      aria-labelledby="kid-feedback-title"
      aria-busy={busy}
    >
      <div className="kid-feedback-content">
        <h2 className="kid-feedback-text" id="kid-feedback-title" ref={titleRef} tabIndex={-1}>
          {feedbackText(dto)}
        </h2>
        {feedback.heardText && (
          <p className="kid-heard-text" data-testid="kid-heard-text">
            {format(messages.kid.feedbackHeard, { word: feedback.heardText })}
          </p>
        )}
        {feedback.fragments && feedback.fragments.length > 0 && (
          <p className="kid-fragments" data-testid="kid-fragments">
            {feedback.fragments.map((fragment, index) => (
              <span
                key={index}
                className={`kid-fragment kid-fragment--${fragment.verdict}`}
                data-testid="kid-fragment"
              >
                {fragment.text}
              </span>
            ))}
          </p>
        )}
        {feedback.spellingDiff && (
          <div className="kid-spelling-diff" data-testid="kid-spelling-diff">
            <p className="kid-visually-hidden">
              {format(messages.kid.spellingDiffAria, {
                given: joinedText(feedback.spellingDiff.given),
                expected: joinedText(feedback.spellingDiff.expected),
              })}
            </p>
            <div className="kid-spelling-row" data-testid="kid-spelling-given">
              <span className="kid-spelling-row-label">{messages.kid.spellingYourAnswer}</span>
              {feedback.spellingDiff.given.map((segment, index) => (
                <span
                  key={index}
                  className={segment.state === "pill" ? "kid-spelling-pill kid-spelling-pill--given" : "kid-spelling-plain"}
                  data-testid={segment.state === "pill" ? "kid-spelling-pill" : undefined}
                >
                  {segment.text}
                </span>
              ))}
            </div>
            <div className="kid-spelling-row" data-testid="kid-spelling-expected">
              <span className="kid-spelling-row-label">{messages.kid.spellingCorrect}</span>
              {feedback.spellingDiff.expected.map((segment, index) => (
                <span
                  key={index}
                  className={segment.state === "pill" ? "kid-spelling-pill kid-spelling-pill--expected" : "kid-spelling-plain"}
                  data-testid={segment.state === "pill" ? "kid-spelling-pill" : undefined}
                >
                  {segment.text}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <button type="button" className="kid-primary" data-testid="kid-next" disabled={busy} onClick={onNext}>
        {retry ? messages.kid.feedbackRetry : messages.kid.feedbackNext}
      </button>
    </section>
  );
}
