import { ExerciseFrame } from "./ExerciseFrame";
import { messages } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { MeaningVisualView } from "../visuals/MeaningVisualView";
import type { ExerciseProps } from "./types";

export function PictureListeningView({ task, busy, mediaUrl, optionOutcomes, result, resultActions, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "picture_listening") return null;
  return <ExerciseFrame task={task} content={<><button type="button" className="kid-play-big" data-testid="kid-play" disabled={busy} onClick={handlers.onPlay} aria-label={messages.kid.listen}><KidIcon name="volume" /></button><ul className="kid-options kid-picture-options">{task.prompt.options.map(option => <li key={option.id}><button type="button" data-testid="kid-option" className={`kid-picture-option${optionOutcomes.has(option.id) ? ` kid-option--${optionOutcomes.get(option.id)}` : ""}`} disabled={busy} onClick={() => handlers.onAnswerChoice(option.id)}><span className="kid-picture-choice-visual"><MeaningVisualView visual={option.visual} mediaUrl={mediaUrl} /></span><span className="kid-picture-choice-label">{option.labelPl}</span></button></li>)}</ul></>} actions={resultActions} result={result} reserveResult />;
}
