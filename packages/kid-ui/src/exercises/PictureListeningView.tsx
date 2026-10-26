import { useEffect, useRef } from "react";
import { ExerciseFrame } from "./ExerciseFrame";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";
import { useChoiceKeyboard } from "./useChoiceKeyboard";
import { AnswerGrid } from "../components/AnswerGrid";
import classes from "./PictureListeningView.module.css";

export function PictureListeningView({ task, busy, mediaUrl, optionOutcomes, dock, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "picture_listening" ? task.prompt : null;
  const options = prompt ? prompt.options : [];
  const playRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useChoiceKeyboard({
    options,
    busy,
    onChoice: handlers.onAnswerChoice,
    onPlay: handlers.onPlay,
  });

  useEffect(() => {
    if (task.prompt.kind === "picture_listening") {
      playRef.current?.focus({ preventScroll: true });
    }
  }, [task.taskId, task.prompt.kind]);

  if (task.prompt.kind !== "picture_listening") return null;

  return (
    <ExerciseFrame
      task={task}
      feedbackLayout="flow"
      instructionAudio={{ ref: playRef, disabled: busy, onPlay: handlers.onPlay }}
      content={(
        <>
          <div className={classes.answers}>
            <AnswerGrid
              options={options.map((option) => ({
                id: option.id,
                label: option.labelPl,
                content: <span className="kid-picture-choice-visual"><MeaningVisualView visual={option.visual} mediaUrl={mediaUrl} numberDisplay="digit" /></span>,
              }))}
              outcomes={optionOutcomes}
              disabled={busy}
              onChoose={handlers.onAnswerChoice}
              optionRefs={optionRefs}
              visualOnly
              className="kid-picture-options"
              optionClassName="kid-picture-option"
              labelClassName="kid-picture-choice-label"
            />
          </div>
        </>
      )}
      dock={dock}
    />
  );
}
