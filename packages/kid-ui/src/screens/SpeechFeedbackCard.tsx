import { useEffect, useRef, type ReactElement } from "react";
import { messages, type FeedbackDto } from "@learning/contracts";
import { format } from "../format";
import { describeSpeechFeedback } from "./speech-feedback-view";
import { KidIcon } from "../components/KidIcon";
import { useFeedbackCooldown } from "./useFeedbackCooldown";
import { ActionButton } from "../components/ActionButton";
import { m } from "motion/react";
import { kidOutcomeIconAnimate, kidOutcomeIconInitial, kidSpringGentle } from "../motion/kid-motion";

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
export function SpeechFeedbackReferenceAction(props: SpeechFeedbackCardProps): ReactElement | null {
  if (!props.audioAvailable) return null;
  return (
    <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" data-testid="kid-play-reference" disabled={props.busy} onClick={props.onPlay}>
      {messages.kid.feedbackPlayReference}
    </ActionButton>
  );
}

export function SpeechFeedbackContent(props: SpeechFeedbackCardProps & { inDock?: boolean }): ReactElement {
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
      role="status"
      aria-live="polite"
      aria-labelledby="kid-speech-feedback-title"
      aria-busy={props.busy}
    >
      <div className="kid-speech-feedback__body">
        <m.h2 id="kid-speech-feedback-title" ref={headingRef} tabIndex={-1} className="kid-speech-feedback__heard" initial={kidOutcomeIconInitial} animate={kidOutcomeIconAnimate} transition={kidSpringGentle}>
          {view.heardText
            ? format(messages.kid.feedbackHeard, { word: view.heardText })
            : view.message}
        </m.h2>
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

      {!props.inDock && (
        <div className="kid-speech-feedback__actions">
          <SpeechFeedbackReferenceAction {...props} />
        </div>
      )}
    </section>
  );
}

export function SpeechFeedbackActions(props: SpeechFeedbackCardProps): ReactElement {
  const action = props.retry ? props.onRetry : props.onNext;
  const { buttonRef, onKeyDown } = useFeedbackCooldown<HTMLButtonElement>(action, [props.retry, props.dto]);
  return props.retry ? (
    <ActionButton
      ref={buttonRef}
      onKeyDown={onKeyDown}
      type="button"
      className="kid-primary"
      data-testid="kid-feedback-retry"
      disabled={props.busy}
      onClick={props.onRetry}
    >
      <KidIcon name="retry" />
      {messages.kid.feedbackRecordAgain}
    </ActionButton>
  ) : (
    <ActionButton
      ref={buttonRef}
      onKeyDown={onKeyDown}
      type="button"
      className="kid-primary"
      data-testid="kid-next"
      disabled={props.busy}
      onClick={props.onNext}
    >
      <KidIcon name="arrow-right" />
      {messages.kid.feedbackNext}
    </ActionButton>
  );
}

export function SpeechFeedbackSecondaryActions(props: SpeechFeedbackCardProps): ReactElement | null {
  const technical = describeSpeechFeedback(props.dto, props.exerciseType).tone === "technical"
    || (props.dto?.kind === "not_assessed" && !props.dto.speech);
  if (!props.retry || !technical) return null;
  return (
    <ActionButton priority="secondary" fullWidth={false} size="sm" type="button" className="kid-flow-secondary" data-testid="kid-technical-next" disabled={props.busy} onClick={props.onSkip}>
      <KidIcon name="arrow-right" />
      {messages.kid.feedbackNext}
    </ActionButton>
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
