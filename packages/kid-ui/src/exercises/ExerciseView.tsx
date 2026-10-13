import type { ExerciseProps } from "./types";
import { ExposureView } from "./ExposureView";
import { ListeningView } from "./ListeningView";
import { ReadingView } from "./ReadingView";
import { SpeechView } from "./SpeechView";
import { WrittenView } from "./WrittenView";
import { LetterCompletionView } from "./LetterCompletionView";
import { LessonCardView } from "./lesson/LessonCardView";
import { LessonNoticeView } from "./lesson/LessonNoticeView";
import { LessonChoiceView } from "./lesson/LessonChoiceView";
import { LessonShortAnswerView } from "./lesson/LessonShortAnswerView";
import { LessonOrderView } from "./lesson/LessonOrderView";
import { LessonGapView } from "./lesson/LessonGapView";
import { LessonSentenceView } from "./lesson/LessonSentenceView";

/**
 * Dyspozytor widoku ćwiczenia po rodzaju promptu (= typie zadania).
 * Wyczerpujący: strażnik `never` w gałęzi domyślnej jest błędem kompilacji,
 * gdy dojdzie nowy typ ćwiczenia bez widoku (przegląd zadania 8).
 */
export function ExerciseView(props: ExerciseProps) {
  const kind = props.task.prompt.kind;
  switch (kind) {
    case "exposure":
      return <ExposureView {...props} />;
    case "listening":
      return <ListeningView {...props} />;
    case "reading":
    case "reverse_recognition":
      return <ReadingView {...props} />;
    case "recall":
    case "spelling":
      return <WrittenView key={props.task.taskId} {...props} />;
    case "letter_completion":
      // Nowe zadanie ma puste luki; kolejna próba tego samego zachowuje wpis.
      return <LetterCompletionView key={props.task.taskId} {...props} />;
    case "speech":
      return <SpeechView key={props.task.taskId} {...props} />;
    // Lekcje (design „Typy ćwiczeń i etapy”). Pola edycji resetują się przy
    // zmianie zadania, dlatego `key` po `taskId`.
    case "lesson_card":
      return <LessonCardView key={props.task.taskId} {...props} />;
    case "lesson_notice":
      return <LessonNoticeView key={props.task.taskId} {...props} />;
    case "lesson_choice":
      return <LessonChoiceView key={props.task.taskId} {...props} />;
    case "lesson_short_answer":
      return <LessonShortAnswerView key={props.task.taskId} {...props} />;
    case "lesson_order":
      return <LessonOrderView key={props.task.taskId} {...props} />;
    case "lesson_gap":
      return <LessonGapView key={props.task.taskId} {...props} />;
    case "lesson_error_fix":
    case "lesson_transform":
    case "lesson_open_answer":
      return <LessonSentenceView key={props.task.taskId} {...props} />;
    default: {
      // Strażnik wyczerpania: dodanie nowego typu bez gałęzi wyżej nie skompiluje się.
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
