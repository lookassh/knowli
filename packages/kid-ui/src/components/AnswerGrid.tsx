import { UnstyledButton } from "@mantine/core";
import type { ReactNode, RefObject } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import type { OptionOutcome } from "../exercises/option-outcome";
import classes from "./answer-controls.module.css";

export interface AnswerGridOption {
  id: string;
  label: string;
  content: ReactNode;
}

export interface AnswerGridProps {
  options: readonly AnswerGridOption[];
  outcomes: ReadonlyMap<string, OptionOutcome>;
  disabled: boolean;
  onChoose: (optionId: string) => void;
  optionRefs?: RefObject<Array<HTMLButtonElement | null>>;
  visualOnly?: boolean;
}

export function AnswerGrid({
  options,
  outcomes,
  disabled,
  onChoose,
  optionRefs,
  visualOnly = false,
}: AnswerGridProps) {
  return (
    <ul className={classes.grid}>
      {options.map((option, index) => {
        const outcome = outcomes.get(option.id);
        const accessibleName = outcome === "correct"
          ? format(messages.kid.pictureChoiceCorrect, { answer: option.label })
          : outcome === "wrong"
            ? format(messages.kid.pictureChoiceWrong, { answer: option.label })
            : option.label;

        return (
          <li className={classes.item} key={option.id}>
            <UnstyledButton
              ref={(element) => {
                if (optionRefs) optionRefs.current[index] = element;
              }}
              type="button"
              className={classes.option}
              data-testid="kid-option"
              data-option-id={option.id}
              data-outcome={outcome}
              aria-label={accessibleName}
              aria-pressed={outcome === "pending"}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChoose(option.id);
              }}
            >
              {visualOnly ? (
                <span className={classes.visualOnly} data-testid="kid-option-label" aria-hidden="true">{option.label}</span>
              ) : (
                <span className={classes.label}>{option.label}</span>
              )}
              <span className={classes.content}>{option.content}</span>
              {outcome === "correct" && <span className={classes.outcome} aria-hidden="true" data-testid="kid-outcome-correct">✓</span>}
              {outcome === "wrong" && <span className={classes.outcome} aria-hidden="true" data-testid="kid-outcome-wrong">×</span>}
            </UnstyledButton>
          </li>
        );
      })}
    </ul>
  );
}
