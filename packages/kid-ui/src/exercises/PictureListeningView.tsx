import { useEffect, useRef } from "react";
import { ActionIcon } from "@mantine/core";
import { ExerciseFrame } from "./ExerciseFrame";
import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";
import { format } from "../format";
import { useChoiceKeyboard } from "./useChoiceKeyboard";
import { AnswerGrid } from "../components/AnswerGrid";
import classes from "./PictureListeningView.module.css";

export function PictureListeningView({ task, busy, mediaUrl, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
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
      content={(
        <>
          <ActionIcon
            ref={playRef}
            type="button"
            className="kid-play-big"
            data-testid="kid-play"
            disabled={busy}
            onClick={handlers.onPlay}
            aria-label={messages.kid.listen}
          >
            <KidIcon name="volume" />
          </ActionIcon>
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
        </>
      )}
      actions={resultActions}
      result={result}
      reserveResult
    />
  );
}
