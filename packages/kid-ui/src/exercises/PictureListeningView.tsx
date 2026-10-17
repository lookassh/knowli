import { ExerciseFrame } from "./ExerciseFrame";
import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";
import { format } from "../format";

export function PictureListeningView({ task, busy, mediaUrl, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "picture_listening") return null;
  return (
    <ExerciseFrame
      task={task}
      content={(
        <>
          <button type="button" className="kid-play-big" data-testid="kid-play" disabled={busy}
            onClick={handlers.onPlay} aria-label={messages.kid.listen}>
            <KidIcon name="volume" />
          </button>
          <ul className="kid-options kid-picture-options">
            {task.prompt.options.map(option => {
              const outcome = optionOutcomes.get(option.id);
              const outcomeLabel = outcome === undefined ? option.labelPl
                : outcome === "correct"
                  ? format(messages.kid.pictureChoiceCorrect, { answer: option.labelPl })
                  : format(messages.kid.pictureChoiceWrong, { answer: option.labelPl });
              return (
                <li key={option.id}>
                  <button type="button" data-testid="kid-option" aria-label={outcomeLabel}
                    className={`kid-picture-option${outcome === undefined ? "" : ` kid-option--${outcome}`}`}
                    disabled={busy} onClick={() => handlers.onAnswerChoice(option.id)}>
                    <span className="kid-picture-choice-visual">
                      <MeaningVisualView visual={option.visual} mediaUrl={mediaUrl} numberDisplay="digit" />
                    </span>
                    <span className="kid-picture-choice-label">{option.labelPl}</span>
                    {outcome !== undefined && (
                      <span className={`kid-picture-outcome kid-picture-outcome--${outcome}`} aria-hidden="true" data-testid={`kid-outcome-${outcome}`}>
                        {outcome === "correct" ? "✓" : "×"}
                      </span>
                    )}
                  </button>
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
