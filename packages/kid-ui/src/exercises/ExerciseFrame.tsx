import type { ReactElement, ReactNode } from "react";
import type { TaskDto } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { getExercisePresentation } from "./exercise-presentation";

export function ExerciseFrame({
  task,
  content,
  actions,
  secondaryActions,
  result,
  resultActions,
  reserveResult = false,
}: {
  task: TaskDto;
  content: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  result?: ReactNode;
  resultActions?: ReactNode;
  reserveResult?: boolean;
}): ReactElement {
  const presentation = getExercisePresentation(task);
  return (
    <section className="kid-exercise-frame" data-testid="kid-exercise" data-prompt-kind={task.prompt.kind}>
      <div className="kid-exercise-instruction" data-testid="kid-instruction">
        <KidIcon name={presentation.icon} className="kid-exercise-instruction-icon" />
        <span>{presentation.instruction}</span>
      </div>
      <div className="kid-material" data-testid="kid-material">
        <div className="kid-material-content">{content}</div>
        {(reserveResult || result !== undefined) && (
          <div className="kid-exercise-result" data-testid="kid-exercise-result">{result}</div>
        )}
      </div>
      <div className="kid-exercise-actions" data-testid="kid-exercise-actions">
        <div className="kid-primary-slot" data-testid="kid-primary-slot">{resultActions ?? actions}</div>
      </div>
      <div className="kid-exercise-secondary" data-testid="kid-exercise-secondary">
        <div className="kid-secondary-slot" data-testid="kid-secondary-slot">{secondaryActions}</div>
      </div>
    </section>
  );
}
