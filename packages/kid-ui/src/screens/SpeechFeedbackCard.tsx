import { useEffect, useRef, type ReactElement } from "react";
import { messages, type FeedbackDto } from "@learning/contracts";
import { format } from "../format";
import { describeSpeechFeedback } from "./speech-feedback-view";

export interface SpeechFeedbackCardProps {
  dto: FeedbackDto | null;
  retry: boolean;
  busy: boolean;
  audioAvailable: boolean;
  audioError: boolean;
  exerciseType: string;
  onPlay: () => void;
  onRetry: () => void;
  onSkip: () => void;
  onNext: () => void;
}

const fragmentDescriptions = {
  good: messages.kid.feedbackFragmentGood,
  almost: messages.kid.feedbackFragmentPractice,
  unknown: messages.kid.feedbackFragmentUnknown,
} as const;

/** Nie-modalna karta wyniku mowy, osadzona bezpośrednio pod bieżącym zadaniem. */
export function SpeechFeedbackContent(props: SpeechFeedbackCardProps): ReactElement {
  const view = describeSpeechFeedback(props.dto, props.exerciseType);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [props.dto, props.retry]);

  const toneClass = view.tone === "correct"
    ? "kid-speech-feedback--correct"
    : view.tone === "practice"
      ? "kid-speech-feedback--practice"
      : "kid-speech-feedback--neutral";
  const hasLocalPractice = view.fragments.some((fragment) => fragment.verdict === "almost");

  return (
    <section
      className={["kid-speech-feedback", toneClass].join(" ")}
      data-testid="kid-speech-feedback"
      aria-labelledby="kid-speech-feedback-title"
      aria-busy={props.busy}
    >
      <div className="kid-speech-feedback__body">
        <h2 id="kid-speech-feedback-title" ref={headingRef} tabIndex={-1} className="kid-speech-feedback__heard">
          {view.heardText
            ? format(messages.kid.feedbackHeard, { word: view.heardText })
            : view.message}
        </h2>
        {view.heardText && <p className="kid-speech-feedback__message">{view.message}</p>}
        {view.pronunciationMessage && (
          <p className="kid-speech-feedback__pronunciation" data-testid="kid-pronunciation-result">
            {view.pronunciationMessage}
          </p>
        )}

        {view.referenceText && (
          <section className="kid-speech-feedback__reference" aria-label={messages.kid.feedbackReferenceTitle}>
            <h3>{messages.kid.feedbackReferenceTitle}</h3>
            <p className="kid-speech-feedback__word" data-testid="kid-reference-text">
              {view.fragments.length > 0
                ? view.fragments.map((fragment, index) => (
                    <span
                      key={index}
                      className={`kid-fragment kid-fragment--${fragment.verdict}`}
                      aria-label={`${fragment.text}: ${fragmentDescriptions[fragment.verdict]}`}
                    >
                      {fragment.text}
                    </span>
                  ))
                : view.referenceText}
            </p>
            {view.fragments.length > 0 && (
              <ul className="kid-speech-feedback__legend" aria-label={messages.kid.feedbackLegend}>
                {(["good", "almost", "unknown"] as const)
                  .filter((verdict) => view.fragments.some((fragment) => fragment.verdict === verdict))
                  .map((verdict) => (
                    <li key={verdict} className={`kid-speech-feedback__legend--${verdict}`}>
                      {fragmentDescriptions[verdict]}
                    </li>
                  ))}
              </ul>
            )}
            {hasLocalPractice && props.retry && (
              <p className="kid-speech-feedback__local">{messages.kid.feedbackLocalPractice}</p>
            )}
          </section>
        )}
        {props.audioError && <p role="alert" className="kid-speech-feedback__error">{messages.kid.feedbackAudioError}</p>}
      </div>

      <div className="kid-speech-feedback__actions">
        {props.audioAvailable && (
          <button type="button" className="kid-secondary" data-testid="kid-play-reference" disabled={props.busy} onClick={props.onPlay}>
            {messages.kid.feedbackPlayReference}
          </button>
        )}
      </div>
    </section>
  );
}

export function SpeechFeedbackActions(props: SpeechFeedbackCardProps): ReactElement {
  return props.retry ? (
    <button type="button" className="kid-primary" data-testid="kid-feedback-retry" disabled={props.busy} onClick={props.onRetry}>
      {messages.kid.feedbackRecordAgain}
    </button>
  ) : (
    <button type="button" className="kid-primary" data-testid="kid-next" disabled={props.busy} onClick={props.onNext}>
      {messages.kid.feedbackNext}
    </button>
  );
}

export function SpeechFeedbackSecondaryActions(props: SpeechFeedbackCardProps): ReactElement | null {
  if (!props.retry) return null;
  return (
    <button type="button" className="kid-flow-secondary" data-testid="kid-feedback-skip" disabled={props.busy} onClick={props.onSkip}>
      {messages.kid.skip}
    </button>
  );
}

/** Zachowuje samodzielną kartę dla klientów spoza ekranu sesji. */
export function SpeechFeedbackCard(props: SpeechFeedbackCardProps): ReactElement {
  return (
    <div className="kid-speech-feedback-layout">
      <SpeechFeedbackContent {...props} />
      <div className="kid-feedback-actions">
        <SpeechFeedbackActions {...props} />
        <SpeechFeedbackSecondaryActions {...props} />
      </div>
    </div>
  );
}
