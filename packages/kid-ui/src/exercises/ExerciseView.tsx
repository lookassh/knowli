import type { ExerciseProps } from "./types";
import { ExposureView } from "./ExposureView";
import { ListeningView } from "./ListeningView";
import { ReadingView } from "./ReadingView";
import { SpeechView } from "./SpeechView";
import { WrittenView } from "./WrittenView";

/** Dyspozytor widoku ćwiczenia po rodzaju promptu (= typie zadania). */
export function ExerciseView(props: ExerciseProps) {
  switch (props.task.prompt.kind) {
    case "exposure":
      return <ExposureView {...props} />;
    case "listening":
      return <ListeningView {...props} />;
    case "reading":
    case "reverse_recognition":
      return <ReadingView {...props} />;
    case "recall":
    case "spelling":
    case "letter_completion":
      return <WrittenView {...props} />;
    case "speech":
      return <SpeechView {...props} />;
  }
}
