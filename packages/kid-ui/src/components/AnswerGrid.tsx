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
  className?: string;
  optionClassName?: string;
  labelClassName?: string;
  afterOption?: (option: AnswerGridOption) => ReactNode;
  itemClassName?: (option: AnswerGridOption) => string | undefined;
  listTestId?: string;
  choiceList?: boolean;
  compactChoiceGrid?: boolean;
  optionLang?: string;
}

export function AnswerGrid({
  options,
  outcomes,
  disabled,
  onChoose,
  optionRefs,
  visualOnly = false,
  className,
  optionClassName,
  labelClassName,
  afterOption,
  itemClassName,
  listTestId,
  choiceList = false,
  compactChoiceGrid = false,
  optionLang,
}: AnswerGridProps) {
  return (
    <ul className={[classes.grid, choiceList ? classes.choiceList : undefined, compactChoiceGrid ? classes.compactChoiceGrid : undefined, className].filter(Boolean).join(" ")} data-visual-only={visualOnly || undefined} data-testid={listTestId}>
      {options.map((option, index) => {
        const outcome = outcomes.get(option.id);
        const accessibleName = outcome === "correct"
          ? format(messages.kid.pictureChoiceCorrect, { answer: option.label })
          : outcome === "wrong"
            ? format(messages.kid.pictureChoiceWrong, { answer: option.label })
            : option.label;

        return (
          <li className={[classes.item, itemClassName?.(option)].filter(Boolean).join(" ")} key={option.id}>
            <UnstyledButton
              ref={(element) => {
                if (optionRefs) optionRefs.current[index] = element;
              }}
              type="button"
              className={[classes.option, optionClassName, outcome ? `kid-option--${outcome}` : undefined].filter(Boolean).join(" ")}
              data-testid="kid-option"
              data-option-id={option.id}
              data-outcome={outcome}
              lang={optionLang}
              aria-label={accessibleName}
              aria-pressed={outcome === "pending" ? true : undefined}
              disabled={disabled}
              onClick={() => {
                if (!disabled) onChoose(option.id);
              }}
            >
              {visualOnly ? (
                <span className={[classes.visualOnly, labelClassName].filter(Boolean).join(" ")} data-testid="kid-option-label" aria-hidden="true">{option.label}</span>
              ) : (
                <span className={classes.label}>{option.label}</span>
              )}
              {option.content !== null && option.content !== undefined && (
                <span className={classes.content} data-testid="kid-option-content">{option.content}</span>
              )}
              {outcome === "correct" && <span className={`${classes.outcome} kid-picture-outcome kid-picture-outcome--correct`} aria-hidden="true" data-outcome={outcome} data-testid="kid-outcome-correct">✓</span>}
              {outcome === "wrong" && <span className={`${classes.outcome} kid-picture-outcome kid-picture-outcome--wrong`} aria-hidden="true" data-outcome={outcome} data-testid="kid-outcome-wrong">×</span>}
            </UnstyledButton>
          {afterOption?.(option)}
          </li>
        );
      })}
    </ul>
  );
}
