/** Pola payloadu ćwiczenia potrzebne do zbudowania poprawnego zdania do odczytu po odpowiedzi. */
export interface FeedbackSentenceSource {
  readonly exerciseType: string;
  readonly stem?: string;
  readonly answer?: string;
  readonly options?: readonly { readonly id: string; readonly text: string }[];
  /** Id poprawnej opcji (nie jej tekst). */
  readonly correctOption?: string;
  /** Klocki `lesson_order` w kolejności kanonicznej (jak w payloadzie). */
  readonly items?: readonly { readonly id: string; readonly text: string }[];
}

/** Najdłuższe zdanie, które nagrywamy (jak limit odpowiedzi dziecka). */
export const FEEDBACK_SENTENCE_MAX_LENGTH = 200;

/**
 * Pełne, poprawne angielskie zdanie ćwiczenia gramatyki, czytane dziecku po
 * odpowiedzi. `null`, gdy typ nie ma pojedynczego zdania do przeczytania,
 * luka jest niejednoznaczna albo zdanie przekracza limit.
 */
export function feedbackSentenceText(source: FeedbackSentenceSource): string | null {
  let raw: string | undefined;
  switch (source.exerciseType) {
    case "lesson_gap":
      raw = fillGap(source.stem, source.answer);
      break;
    case "lesson_choice":
      raw = fillGap(source.stem, source.options?.find((option) => option.id === source.correctOption)?.text);
      break;
    case "lesson_order":
      raw = source.items?.map((item) => item.text).join(" ");
      break;
    case "lesson_error_fix":
    case "lesson_transform":
    case "lesson_open_answer":
      raw = source.answer;
      break;
    default:
      return null;
  }
  const sentence = raw?.trim().replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1");
  if (!sentence || sentence.length > FEEDBACK_SENTENCE_MAX_LENGTH) return null;
  return sentence;
}

/** Wstawia tekst w jedyną lukę (2+ podkreśleń); inaczej `undefined`. */
function fillGap(stem: string | undefined, fill: string | undefined): string | undefined {
  if (!stem || !fill?.trim()) return undefined;
  if ((stem.match(/_{2,}/g) ?? []).length !== 1) return undefined;
  return stem.replace(/_{2,}/, () => fill.trim());
}
