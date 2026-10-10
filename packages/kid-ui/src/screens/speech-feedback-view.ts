import { messages, type FeedbackDto, type PronunciationFragmentDto } from "@learning/contracts";
import { format } from "../format";

export interface SpeechFeedbackView {
  heardText?: string;
  message: string;
  pronunciationMessage?: string;
  referenceText?: string;
  fragments: readonly PronunciationFragmentDto[];
  tone: "correct" | "practice" | "neutral";
}

/** Dobiera krótki komunikat wyłącznie z jawnych wyników STT i wymowy. */
export function describeSpeechFeedback(
  dto: FeedbackDto | null,
  exerciseType?: string,
): SpeechFeedbackView {
  if (dto === null) {
    return { message: messages.kid.feedbackNotAssessed, fragments: [], tone: "neutral" };
  }
  const fragments = dto.fragments ?? [];
  const base = {
    ...(dto.heardText ? { heardText: dto.heardText } : {}),
    fragments,
  };

  if (dto.speech) {
    const speech = dto.speech;
    const referenceText = speech.referenceText;
    if (speech.recognition === "no_speech") {
      return { ...base, message: messages.kid.feedbackSpeechNoSpeech, tone: "neutral" };
    }
    if (speech.recognition === "unavailable") {
      return { ...base, message: messages.kid.feedbackSpeechUnavailable, tone: "neutral" };
    }
    if (speech.recognition === "uncertain") {
      return { ...base, message: messages.kid.feedbackSpeechUncertain, tone: "neutral" };
    }
    if (speech.recognition === "different") {
      const expected = referenceText ?? dto.correctText ?? "";
      const message = exerciseType === "recall"
        ? format(messages.kid.feedbackSpeechDifferentRecall, { word: expected })
        : format(messages.kid.feedbackSpeechDifferent, { word: expected });
      return { ...base, ...(referenceText ? { referenceText } : {}), message, tone: "practice" };
    }

    const message = dto.kind === "capitalization_hint"
      ? format(messages.kid.feedbackCapitalization, { word: dto.correctText ?? referenceText ?? "" })
      : dto.kind === "almost"
        ? messages.kid.feedbackAlmost
        : dto.kind === "content_matched" || dto.kind === "not_assessed"
          ? messages.kid.feedbackSpeechMatched
          : dto.kind === "incorrect"
            ? format(messages.kid.feedbackIncorrect, { word: dto.correctText ?? referenceText ?? "" })
            : messages.kid.feedbackGreat;
    let pronunciationMessage: string | undefined;
    switch (speech.pronunciation) {
      case "practice": pronunciationMessage = messages.kid.feedbackPronunciationPractice; break;
      case "unreliable": pronunciationMessage = messages.kid.feedbackPronunciationUnreliable; break;
      case "unavailable": pronunciationMessage = messages.kid.feedbackPronunciationUnavailable; break;
      case "not_configured":
      case "not_applicable": pronunciationMessage = messages.kid.feedbackPronunciationNotConfigured; break;
      case "good": break;
    }
    const tone = speech.pronunciation === "practice" || dto.kind === "almost" || dto.kind === "incorrect"
      ? "practice"
      : dto.kind === "great" || dto.kind === "capitalization_hint" || dto.kind === "content_matched"
        ? "correct"
        : "neutral";
    return {
      ...base,
      ...(referenceText ? { referenceText } : {}),
      message,
      ...(pronunciationMessage ? { pronunciationMessage } : {}),
      tone,
    };
  }

  const message = dto.kind === "great"
    ? messages.kid.feedbackGreat
    : dto.kind === "almost"
      ? messages.kid.feedbackAlmost
      : dto.kind === "capitalization_hint"
        ? format(messages.kid.feedbackCapitalization, { word: dto.correctText ?? "" })
        : dto.kind === "incorrect"
          ? format(messages.kid.feedbackIncorrect, { word: dto.correctText ?? "" })
          : dto.kind === "content_matched"
            ? messages.kid.feedbackContentMatched
            : messages.kid.feedbackNotAssessed;
  const tone = dto.kind === "great" || dto.kind === "capitalization_hint"
    ? "correct"
    : dto.kind === "almost" || dto.kind === "incorrect"
      ? "practice"
      : "neutral";
  return { ...base, message, tone };
}
