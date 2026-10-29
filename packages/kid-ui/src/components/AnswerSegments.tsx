import type { ReactElement } from "react";
import { m } from "motion/react";
import { messages, type SpellingDiffSegmentDto } from "@learning/contracts";
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
  // „Nie na temat” (segmenty lekcji szkolnej, design §9.2): własny styl i etykieta.
  const offTopic = segment.state === "offtopic";
  const pill = segment.state === "pill" || offTopic;
  return (
    <m.span
      className={offTopic ? "kid-spelling-pill kid-spelling-pill--offtopic" : pill ? `kid-spelling-pill kid-spelling-pill--${variant}` : "kid-spelling-plain"}
      data-testid={offTopic ? "kid-spelling-offtopic" : pill ? "kid-spelling-pill" : undefined}
      initial={pill ? (animation === "pop" ? kidOutcomeIconInitial : { opacity: 1, x: 0 }) : false}
      animate={pill ? (animation === "pop" ? kidOutcomeIconAnimate : kidOutcomeShake) : undefined}
      transition={animation === "pop" ? { ...kidSpringGentle, delay: kidStaggerDelay(index) } : kidOutcomeShakeTransition}
      style={{ display: "inline-block" }}
    >
      {segment.text}
      {offTopic && <span className="kid-visually-hidden"> ({messages.kid.lessonSegmentOffTopic})</span>}
    </m.span>
  );
}

/** Zaznaczenie w akapicie: zbędne (pigułka) albo nie na temat; etykieta dla czytników ekranu. */
function TextSegment({ segment, labelled }: { segment: SpellingSegment; labelled: boolean }): ReactElement {
  if (segment.state === "plain") return <span className="kid-spelling-plain">{segment.text}</span>;
  const offTopic = segment.state === "offtopic";
  return (
    <span
      className={`kid-spelling-pill kid-spelling-pill--remove${offTopic ? " kid-spelling-pill--offtopic" : ""}`}
      data-testid={offTopic ? "kid-spelling-offtopic" : "kid-spelling-pill"}
    >
      {segment.text}
      {labelled && (
        <span className="kid-visually-hidden">
          {" "}({offTopic ? messages.kid.lessonSegmentOffTopic : messages.kid.lessonSegmentRedundant})
        </span>
      )}
    </span>
  );
}

/**
 * Legenda kategorii zaznaczeń — tylko te, które występują w tekście. Próbka
 * powtarza styl zaznaczenia (obwódka i dekoracja), więc kolor nie jest jedynym
 * nośnikiem; nieinteraktywna.
 */
function SegmentLegend({ segments }: { segments: readonly SpellingSegment[] }): ReactElement | null {
  const hasRedundant = segments.some((segment) => segment.state === "pill");
  const hasOffTopic = segments.some((segment) => segment.state === "offtopic");
  if (!hasOffTopic) return null;
  return (
    <ul className="kid-segment-legend" data-testid="kid-segment-legend">
      {hasRedundant && (
        <li className="kid-segment-legend__item">
          <span className="kid-spelling-pill kid-spelling-pill--remove kid-segment-legend__sample" aria-hidden="true">abc</span>
          {messages.kid.lessonSegmentRedundant}
        </li>
      )}
      <li className="kid-segment-legend__item">
        <span className="kid-spelling-pill kid-spelling-pill--remove kid-spelling-pill--offtopic kid-segment-legend__sample" aria-hidden="true">abc</span>
        {messages.kid.lessonSegmentOffTopic}
      </li>
    </ul>
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
    // Dwie kategorie (zbędne / nie na temat) dostają etykietę przy każdym fragmencie i legendę.
    const categorized = segments.some((segment) => segment.state === "offtopic");
    return (
      <div className="kid-answer-segments-text" data-testid={testid}>
        <span className="kid-spelling-row-label">{label}</span>
        <p className="kid-answer-segments-text__body">
          {segments.map((segment, index) => <TextSegment key={index} segment={segment} labelled={categorized} />)}
        </p>
        <SegmentLegend segments={segments} />
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
