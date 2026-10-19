import type { ExerciseType, VocabularySkill } from "./types";

export interface VocabularyCapabilities {
  skills: readonly VocabularySkill[];
  exerciseTypes: readonly ExerciseType[];
}

export interface VocabularyCapabilitiesInput {
  canRead: boolean;
  microphoneEnabled: boolean;
  /**
   * Zestaw obrazkowy: jedyny format, w którym `picture_recognition` jest
   * dostępne (SPEC §12.4a — wyłącznie dzieci nieczytające).
   */
  vocabularyFormat?: "standard" | "picture";
  /** Flaga zdolności klienta zadeklarowana przy starcie sesji (arch §20). */
  supportsPictureRecognition?: boolean;
}

const READER: VocabularyCapabilities = {
  skills: ["listening", "reading", "recall", "spelling", "pronunciation"],
  exerciseTypes: ["exposure", "listening", "reading", "reverse_recognition", "recall", "spelling", "letter_completion", "speech"],
};

export function getVocabularyCapabilities(input: VocabularyCapabilitiesInput): VocabularyCapabilities {
  if (input.canRead) return READER;
  const base: VocabularyCapabilities = input.microphoneEnabled
    ? {
        skills: ["listening", "recall", "pronunciation"],
        exerciseTypes: ["exposure", "listening", "recall", "speech"],
      }
    : { skills: ["listening"], exerciseTypes: ["exposure", "listening"] };
  // picture_recognition: nieczytający + zestaw picture + klient z flagą.
  // Umiejętność pozostaje `reading` w ocenach, ale nie wchodzi do `skills`
  // nieczytającego — priorytety harmonogramu i gwiazdki §6 liczą dalej
  // listening/recall, a wyniki reading żyją w historii i raporcie rodzica.
  if (input.vocabularyFormat === "picture" && input.supportsPictureRecognition === true) {
    return {
      skills: base.skills,
      exerciseTypes: [...base.exerciseTypes, "picture_recognition"],
    };
  }
  return base;
}
