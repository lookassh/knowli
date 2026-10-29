import type { ReactElement } from "react";
import { m } from "motion/react";
import type { SpellingDiffSegmentDto } from "@learning/contracts";
import { kidOutcomeIconAnimate, kidOutcomeIconInitial, kidOutcomeShake, kidOutcomeShakeTransition, kidSpringGentle, kidStaggerDelay } from "../motion/kid-motion";

/** Segmenty z zaznaczonymi pigułkami (reuse pisowni) — jedna etykietowana linia. */
type SpellingSegment = Pick<SpellingDiffSegmentDto, "state" | "text">;

/** One spelling-diff segment: differing letters pop in (expected/lesson)
 * or shake gently (the child's own), one after another. Plain segments
 * stay quiet. Only transform and opacity move. */
export function SpellingPill({ segment, index, variant, animation }: {
  segment: SpellingSegment;
  index: number;
  variant: "given" | "expected";
  animation: "pop" | "shake";
}): ReactElement {
  const pill = segment.state === "pill";
  return (
    <m.span
      className={pill ? `kid-spelling-pill kid-spelling-pill--${variant}` : "kid-spelling-plain"}
      data-testid={pill ? "kid-spelling-pill" : undefined}
      initial={pill ? (animation === "pop" ? kidOutcomeIconInitial : { opacity: 1, x: 0 }) : false}
      animate={pill ? (animation === "pop" ? kidOutcomeIconAnimate : kidOutcomeShake) : undefined}
      transition={animation === "pop" ? { ...kidSpringGentle, delay: kidStaggerDelay(index) } : kidOutcomeShakeTransition}
      style={{ display: "inline-block" }}
    >
      {segment.text}
    </m.span>
  );
}

/**
 * Odpowiedź dziecka z zaznaczonymi segmentami pod etykietą tekstową (kolor
 * nie jest jedynym nośnikiem — pigułka ma obwódkę). Układ `word` to
 * dotychczasowy wiersz feedbacku (krótkie odpowiedzi, duża czcionka, pigułki
 * wskakują po kolei). Układ `text` służy do dłuższego tekstu ciągłego (np.
 * „Skróć odpowiedź”): akapit w czytelnej wielkości, który zawija się jak
 * zwykły tekst; pigułki pokazują fragmenty do usunięcia (przekreślenie jako
 * drugi kanał) i są statyczne — transform nie działa na elementach inline.
 */
export function AnswerSegments({ segments, label, testid, layout = "word", pillDescription }: {
  segments: readonly SpellingSegment[] | undefined;
  label: string;
  testid: string;
  layout?: "word" | "text";
  /** Opis zaznaczonych fragmentów dla czytników ekranu (układ `text`). */
  pillDescription?: string;
}): ReactElement | null {
  if (segments === undefined || segments.length === 0) return null;
  if (layout === "text") {
    return (
      <div className="kid-answer-segments-text" data-testid={testid}>
        <span className="kid-spelling-row-label">{label}</span>
        <p className="kid-answer-segments-text__body">
          {segments.map((segment, index) => segment.state === "pill"
            ? <span key={index} className="kid-spelling-pill kid-spelling-pill--remove" data-testid="kid-spelling-pill">{segment.text}</span>
            : <span key={index} className="kid-spelling-plain">{segment.text}</span>)}
        </p>
        {pillDescription !== undefined && <p className="kid-visually-hidden">{pillDescription}</p>}
      </div>
    );
  }
  return (
    <div className="kid-spelling-row" data-testid={testid}>
      <span className="kid-spelling-row-label">{label}</span>
      {segments.map((segment, index) => (
        <SpellingPill key={index} segment={segment} index={index} variant="given" animation="pop" />
      ))}
    </div>
  );
}
