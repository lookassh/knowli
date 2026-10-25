import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { AnswerGrid } from "../components/AnswerGrid";
import { ActionButton } from "../components/ActionButton";
import { ExerciseFrame } from "./ExerciseFrame";
import type { ExerciseProps } from "./types";
import { useChoiceKeyboard } from "./useChoiceKeyboard";
import { MeaningVisualView } from "../visuals/MeaningVisualView";

/**
 * Obrazek → wybór angielskiego słowa (SPEC §12.4a): prompt to wizualizacja
 * znaczenia z małym polskim podpisem, odpowiedź to wybór 1 z 2–4 słów.
 * Prompt nie niesie audio (A07) — odsłuch poprawnej opcji pojawia się
 * dopiero w feedbackzie, przy podświetlonej poprawnej odpowiedzi.
 */
export function PictureRecognitionView({ task, busy, mediaUrl, optionOutcomes, dock, feedbackAudio, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "picture_recognition" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
  });

  if (task.prompt.kind !== "picture_recognition") return null;

  return (
    <ExerciseFrame
      task={task}
      content={(
        <>
          <div className="kid-recognition-prompt">
            <MeaningVisualView visual={task.prompt.visual} mediaUrl={mediaUrl} />
            <p className="kid-picture-caption" data-testid="kid-picture-caption" lang="pl-PL">{task.prompt.source}</p>
          </div>
          <AnswerGrid
            className="kid-options"
            compactChoiceGrid
            optionLang="en-GB"
            options={options.map((option) => ({ id: option.id, label: option.text, content: null }))}
            outcomes={optionOutcomes}
            disabled={busy}
            optionRefs={optionRefs}
            onChoose={handlers.onAnswerChoice}
            itemClassName={(option) => feedbackAudio && optionOutcomes.get(option.id) === "correct" ? "kid-recognition-option" : undefined}
            afterOption={(gridOption) => {
              const option = options.find((candidate) => candidate.id === gridOption.id)!;
              const outcome = optionOutcomes.get(option.id);
              const audio = feedbackAudio !== undefined && feedbackAudio !== null && outcome === "correct"
                ? feedbackAudio
                : null;
              return audio === null ? null : (
                    <ActionButton
                      fullWidth={false}
                      size="sm"
                      type="button"
                      className="kid-audio-round kid-option-audio"
                      data-testid="kid-option-audio"
                      aria-label={messages.kid.listenCorrectWord}
                      onClick={audio.onPlay}
                    >
                      <KidIcon name="volume" />
                    </ActionButton>
                  );
            }}
          />
        </>
      )}
      dock={dock}
    />
  );
}
