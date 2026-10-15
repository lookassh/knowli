import type { ExerciseType, VocabularySkill } from "./types";

export interface VocabularyCapabilities {
  skills: readonly VocabularySkill[];
  exerciseTypes: readonly ExerciseType[];
}

const READER: VocabularyCapabilities = {
  skills: ["listening", "reading", "recall", "spelling", "pronunciation"],
  exerciseTypes: ["exposure", "listening", "reading", "reverse_recognition", "recall", "spelling", "letter_completion", "speech"],
};

export function getVocabularyCapabilities(input: {
  canRead: boolean;
  microphoneEnabled: boolean;
}): VocabularyCapabilities {
  if (input.canRead) return READER;
  if (input.microphoneEnabled) {
    return {
      skills: ["listening", "recall", "pronunciation"],
      exerciseTypes: ["exposure", "listening", "recall", "speech"],
    };
  }
  return { skills: ["listening"], exerciseTypes: ["exposure", "listening"] };
}
