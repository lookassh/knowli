import type { AssistanceKind, ExerciseType } from "./types";

export interface TaskAssistanceInput {
  exerciseType: ExerciseType;
  visibleLetterFragment: boolean;
  distinctChoiceCount: number | null;
  disclosureKinds: readonly ("audio_issued" | "hint_issued")[];
}

export function resolveTaskAssistance(input: TaskAssistanceInput): AssistanceKind[] {
  const kinds: AssistanceKind[] = [];
  if (input.visibleLetterFragment || input.exerciseType === "letter_completion") kinds.push("visible_letters");
  if (input.distinctChoiceCount !== null && input.distinctChoiceCount < 2) kinds.push("options");
  for (const kind of input.disclosureKinds) {
    if (kind === "hint_issued") kinds.push("answer_reveal");
    if (kind === "audio_issued" && ["reading", "reverse_recognition", "recall", "spelling", "letter_completion"].includes(input.exerciseType)) {
      kinds.push("model_audio");
    }
  }
  return [...new Set(kinds)];
}
