import { messages, type FeedbackDto, type SpellingDiffSegmentDto } from "@learning/contracts";

/**
 * Model widoku feedbacku lekcji (design „Ocena”): czysta funkcja mapująca
 * `FeedbackDto` rodzajów lekcyjnych na to, co pokazuje `AnswerFeedback`.
 * Reguła prywatności: tekst i segmenty pochodzą wyłącznie z DTO serwera —
 * nic nie jest wyliczane z odpowiedzi dziecka po stronie klienta.
 *
 * - `lesson_almost` → „Prawie!”, zaznaczone segmenty odpowiedzi, poprawna
 *   odpowiedź; ton wsparcia (niebieski).
 * - `lesson_hint` → zaznaczone segmenty + podpowiedź kategorii (`hintPl`) +
 *   poprawna odpowiedź; ton wsparcia.
 * - `not_assessed` → komunikat techniczny bez sugerowania błędu, bez segmentów
 *   i bez poprawnej odpowiedzi; ton neutralny, `technical=true` (widok daje
 *   „Spróbuj jeszcze raz” / „Dalej”).
 *
 * Zwraca `null` dla rodzajów nie-lekcyjnych — te obsługuje istniejący widok.
 */
export interface LessonFeedbackView {
  title: string;
  tone: "retry" | "neutral";
  /** Zaznaczone segmenty odpowiedzi dziecka (reuse pigułek pisowni); null, gdy brak. */
  answerSegments: SpellingDiffSegmentDto[] | null;
  /** Poprawna odpowiedź (najbliższy zatwierdzony wariant); null, gdy nieujawniona. */
  correctText: string | null;
  /** Podpowiedź kategorii celu po polsku (tylko `lesson_hint`); null w innych. */
  hint: string | null;
  /** Komunikat techniczny bez winy dziecka (`not_assessed`). */
  technical: boolean;
}

const LESSON_KINDS = new Set(["lesson_almost", "lesson_hint", "not_assessed"]);

export function lessonFeedbackView(dto: FeedbackDto | null): LessonFeedbackView | null {
  if (dto === null || !LESSON_KINDS.has(dto.kind)) return null;
  if (dto.kind === "not_assessed") {
    return {
      title: messages.kid.feedbackNotAssessed,
      tone: "neutral",
      answerSegments: null,
      correctText: null,
      hint: null,
      technical: true,
    };
  }
  return {
    title: dto.kind === "lesson_almost" ? messages.kid.lessonAlmostTitle : messages.kid.lessonHintTitle,
    tone: "retry",
    answerSegments: dto.answerSegments ?? null,
    correctText: dto.correctText ?? null,
    hint: dto.kind === "lesson_hint" ? dto.hintPl ?? null : null,
    technical: false,
  };
}
