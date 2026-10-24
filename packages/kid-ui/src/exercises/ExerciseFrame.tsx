import type { ReactElement, ReactNode } from "react";
import { Box } from "@mantine/core";
import type { TaskDto } from "@learning/contracts";
import { KidIcon } from "../components/KidIcon";
import { KidScreen } from "../layout/KidScreen";
import classes from "./ExerciseFrame.module.css";
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
    <KidScreen mode="session" className={`kid-exercise-frame ${classes.root}`} data-testid="kid-exercise" data-prompt-kind={task.prompt.kind}>
      <KidScreen.Header className="kid-exercise-instruction" data-testid="kid-instruction">
        <KidIcon name={presentation.icon} className="kid-exercise-instruction-icon" />
        <span>{presentation.instruction}</span>
      </KidScreen.Header>
      <KidScreen.Content className={`kid-material ${classes.material}`} data-testid="kid-material">
        <Box className="kid-material-content">{content}</Box>
        {(reserveResult || result !== undefined) && (
          <Box className="kid-exercise-result" data-testid="kid-exercise-result">{result}</Box>
        )}
      </KidScreen.Content>
      <KidScreen.Actions
        className="kid-exercise-actions"
        data-testid="kid-exercise-actions"
        secondary={secondaryActions ? <Box className="kid-exercise-secondary" data-testid="kid-exercise-secondary">{secondaryActions}</Box> : undefined}
        classNames={{ primary: classes.primary, secondary: classes.secondary }}
      >
        {resultActions ?? actions}
      </KidScreen.Actions>
    </KidScreen>
  );
}
