import type { TaskDto } from "@learning/contracts";

export interface ExerciseHandlers {
  onPlay(): void;
  onAnswerChoice(optionId: string): void;
  onSubmitText(text: string): void;
  onNotRemember(): void;
  onSkip(): void;
  /** „Rozumiem” — zamknięcie prezentacji przez complete-presentation. */
  onComplete(): void;
  onRecord(): void;
  onStopRecording(): void;
}

export interface ExerciseProps {
  task: TaskDto;
  busy: boolean;
  recording: boolean;
  /** Mikrofon dostępny: sesja włączona i brak odmowy. */
  micAvailable: boolean;
  handlers: ExerciseHandlers;
}
