import type { RecordingModeDto, TaskDto } from "@learning/contracts";
import type { OptionOutcome } from "./option-outcome";

export interface ExerciseHandlers {
  onPlay(): void;
  /** Odsłuch zdania przykładowego prezentacji (SPEC §22). */
  onPlayExample(): void;
  onAnswerChoice(optionId: string): void;
  onSubmitText(text: string): void;
  onNotRemember(): void;
  onSkip(): void;
  /** „Rozumiem” — zamknięcie prezentacji przez complete-presentation. */
  onComplete(): void;
  onRecord(): void;
  onStopRecording(): void;
  onCancelRecording(): void;
  onPrepareRecording(): void;
}

export interface ExerciseProps {
  mockTest?: boolean;
  task: TaskDto;
  busy: boolean;
  recording: boolean;
  recordingPhase: "idle" | "preparing" | "starting" | "recording" | "stopping";
  microphoneReady: boolean;
  inputLevel: number | null;
  recordingNotice: string | null;
  recordingMode: RecordingModeDto;
  /** Mikrofon dostępny: sesja włączona i brak odmowy. */
  micAvailable: boolean;
  /** URL niezmiennej ilustracji karty (route media hosta). */
  mediaUrl: (assetId: string) => string;
  /** Podświetlenia opcji po próbie wyboru; puste poza feedbackiem. */
  optionOutcomes: ReadonlyMap<string, OptionOutcome>;
  handlers: ExerciseHandlers;
}
