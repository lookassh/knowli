import type { ReactElement, ReactNode } from "react";
import type { TaskDto } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { getExercisePresentation } from "./exercise-presentation";

export function ExerciseFrame({
  task,
  content,
  actions,
  secondaryActions,
}: {
  task: TaskDto;
  content: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
}): ReactElement {
  const presentation = getExercisePresentation(task);
  return (
    <section className="kid-exercise-frame" data-testid="kid-exercise" data-prompt-kind={task.prompt.kind}>
      <div className="kid-exercise-instruction" data-testid="kid-instruction">
        <KidIcon name={presentation.icon} className="kid-exercise-instruction-icon" />
        <span>{presentation.instruction}</span>
      </div>
      <div className="kid-material" data-testid="kid-material">{content}</div>
      {actions !== undefined && <div className="kid-exercise-actions" data-testid="kid-exercise-actions">{actions}</div>}
      {secondaryActions !== undefined && <div className="kid-exercise-secondary">{secondaryActions}</div>}
    </section>
  );
}
