import type { ReactNode } from "react";
import type { RecordingModeDto, TaskDto } from "@learning/contracts";
import type { OptionOutcome } from "./option-outcome";

export interface ExerciseHandlers {
  /** Content-free activity signal for an actual edit or block move. */
  onInteraction(): void;
  onPlay(): void;
  /** Odsłuch zdania przykładowego prezentacji (SPEC §22). */
  onPlayExample(): void;
  onAnswerChoice(optionId: string): void;
  onSubmitText(text: string): void;
  /** Ułożona kolejność klocków (`lesson_order`) — odpowiedź `sequence`. */
  onAnswerSequence(itemIds: string[]): void;
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
  /** Krótkotrwały szkic luk; zachowuje pola gdy widok zadania ustępuje feedbackowi. */
  letterDraft?: Readonly<Record<number, string>>;
  onLetterDraftChange?: (letters: Record<number, string>) => void;
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
  /**
   * Odsłuch poprawnego słowa w feedbacku `picture_recognition`: identyfikator
   * ujawniony serwerowo dopiero wraz z oceną (audio_issued przed HTTP).
   */
  feedbackAudio?: { assetId: string; onPlay: () => void } | null;
  /** Wynik próby wyboru pozostaje w tej samej ramie co podświetlone odpowiedzi. */
  result?: ReactNode;
  /** Główna akcja dostępna po wyniku próby; wynik sam pozostaje w material/result slot. */
  resultActions?: ReactNode;
  /** Rezerwuje stałą wysokość na krótki wynik także przed próbą. */
  reserveResult?: boolean;
  handlers: ExerciseHandlers;
}
