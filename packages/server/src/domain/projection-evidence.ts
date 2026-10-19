import type { ExerciseType, History, HistoryEntry } from "./types";

export interface ProjectionEvidence {
  entry: HistoryEntry;
  exerciseType: ExerciseType;
  distinctChoiceCount: number | null;
  audioIssuedBeforeAnswer: boolean;
}

export function qualifyProjectionEvidence(evidence: readonly ProjectionEvidence[]): History {
  return evidence.map(({ entry, exerciseType, distinctChoiceCount, audioIssuedBeforeAnswer }) => {
    const isChoice = exerciseType === "listening" || exerciseType === "reading" || exerciseType === "reverse_recognition" ||
      exerciseType === "picture_recognition";
    const singleton = isChoice && (distinctChoiceCount ?? 0) < 2;
    const assistedReading = (exerciseType === "reading" || exerciseType === "reverse_recognition" || exerciseType === "picture_recognition") &&
      audioIssuedBeforeAnswer;
    if ((!singleton && !assistedReading) || (!entry.independent && !entry.confirmationEligible)) return entry;
    return { ...entry, independent: false, confirmationEligible: false };
  });
}
