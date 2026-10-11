import { messages, type TaskDto } from "@learning/contracts";
import type { KidIconName } from "../components/KidIcon";

export interface ExercisePresentation {
  instruction: string;
  icon: KidIconName;
}

export function getExercisePresentation(task: TaskDto): ExercisePresentation {
  switch (task.prompt.kind) {
    case "exposure":
      return { instruction: messages.kid.instructionExposure, icon: "sparkles" };
    case "listening":
      return { instruction: messages.kid.instructionListening, icon: "volume" };
    case "reading":
      return { instruction: messages.kid.instructionReading, icon: "book" };
    case "reverse_recognition":
      return { instruction: messages.kid.instructionReverseRecognition, icon: "ear" };
    case "recall":
      return { instruction: messages.kid.instructionRecall, icon: "book" };
    case "spelling":
      return { instruction: messages.kid.instructionSpelling, icon: "pencil" };
    case "letter_completion":
      return { instruction: messages.kid.instructionLetterCompletion, icon: "letters" };
    case "speech":
      return { instruction: messages.kid.instructionSpeech, icon: "microphone" };
  }
}
