import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
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
export function PictureRecognitionView({ task, busy, mediaUrl, optionOutcomes, result, resultActions, feedbackAudio, handlers }: ExerciseProps) {
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
          <ul className="kid-options">
            {options.map((option, index) => {
              const outcome = optionOutcomes.get(option.id);
              const audio = feedbackAudio !== undefined && feedbackAudio !== null && outcome === "correct"
                ? feedbackAudio
                : null;
              return (
                <li key={option.id} className={audio === null ? undefined : "kid-recognition-option"}>
                  <button
                    ref={(btn) => { optionRefs.current[index] = btn; }}
                    type="button"
                    data-testid="kid-option"
                    className={outcome === undefined ? undefined : `kid-option--${outcome}`}
                    aria-pressed={outcome === "pending"}
                    disabled={busy}
                    onClick={() => handlers.onAnswerChoice(option.id)}
                    lang="en-GB"
                  >
                    {option.text}
                  </button>
                  {audio !== null && (
                    <button
                      type="button"
                      className="kid-audio-round kid-option-audio"
                      data-testid="kid-option-audio"
                      aria-label={messages.kid.listenCorrectWord}
                      onClick={audio.onPlay}
                    >
                      <KidIcon name="volume" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      actions={resultActions}
      result={result}
      reserveResult
    />
  );
}
