import { vi } from "vitest";
import type { ExerciseHandlers, ExerciseProps } from "../exercises/types";
import type { TaskDto } from "@learning/contracts";

export function makeExerciseHandlers(): ExerciseHandlers {
  return {
    onInteraction: vi.fn(),
    onEdit: vi.fn(),
    onPlay: vi.fn(),
    onPlayExample: vi.fn(),
    onAnswerChoice: vi.fn(),
    onSubmitText: vi.fn(),
    onAnswerSequence: vi.fn(),
    onNotRemember: vi.fn(),
    onSkip: vi.fn(),
    onComplete: vi.fn(),
    onRecord: vi.fn(),
    onStopRecording: vi.fn(),
    onCancelRecording: vi.fn(),
    onPrepareRecording: vi.fn(),
  };
}

export function makeExerciseProps(
  task: TaskDto,
  overrides: Partial<ExerciseProps> = {},
): ExerciseProps {
  return {
    task,
    busy: false,
    recording: false,
    recordingPhase: "idle",
    microphoneReady: false,
    inputLevel: null,
    recordingNotice: null,
    recordingMode: "hold",
    micAvailable: false,
    mediaUrl: (assetId) => `/api/v1/kid/media/${assetId}`,
    optionOutcomes: new Map(),
    handlers: makeExerciseHandlers(),
    ...overrides,
  };
}
