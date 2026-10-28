import type { CSSProperties, ReactNode, RefObject } from "react";
import { messages } from "@learning/contracts";
import { format } from "../format";
import type { OptionOutcome } from "../exercises/option-outcome";
import classes from "./answer-controls.module.css";
import { m } from "motion/react";
import { BurstParticles } from "./CelebrationBurst";
import {
  kidEntranceAnimate,
  kidEntranceInitial,
  kidOutcomeIconAnimate,
  kidOutcomeIconInitial,
  kidOutcomePop,
  kidOutcomePopTransition,
  kidSpringBouncy,
  kidSpringGentle,
  kidSpringSnappy,
  kidStaggerDelay,
  kidTapScale,
  kidTileTapScale,
  kidWrongIconAnimate,
  kidWrongIconTransition,
} from "../motion/kid-motion";

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
  // After a wrong choice the server's correct option is also lit green to
  // show the answer; that reveal must never look like praise, so only a
  // tile the child chose correctly (no wrong outcome anywhere) celebrates.
  const choseCorrectly = !Array.from(outcomes.values()).includes("wrong");
  return (
    <ul className={[classes.grid, choiceList ? classes.choiceList : undefined, compactChoiceGrid ? classes.compactChoiceGrid : undefined, className].filter(Boolean).join(" ")} data-visual-only={visualOnly || undefined} data-testid={listTestId}
      style={visualOnly ? { "--visual-choice-count": options.length, "--visual-choice-rows": Math.ceil(options.length / 2) } as CSSProperties : undefined}>
      {options.map((option, index) => {
        const outcome = outcomes.get(option.id);
        const accessibleName = outcome === "correct"
          ? format(messages.kid.pictureChoiceCorrect, { answer: option.label })
          : outcome === "wrong"
            ? format(messages.kid.pictureChoiceWrong, { answer: option.label })
            : option.label;
          {/* Picture options skip the item entrance: asynchronously loaded images inside a fading item (on top of the pane entrance) flicker. Text options keep the stagger wave. */}

        return (
          <m.li className={[classes.item, itemClassName?.(option)].filter(Boolean).join(" ")} key={option.id} initial={visualOnly ? false : kidEntranceInitial} animate={kidEntranceAnimate} transition={{ ...kidSpringGentle, delay: kidStaggerDelay(index) }}>
            <m.button
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
              animate={outcome === "correct" ? kidOutcomePop : { scale: 1, x: 0 }}
              whileTap={disabled ? undefined : { scale: visualOnly ? kidTileTapScale : kidTapScale }}
              transition={outcome === "correct" ? kidOutcomePopTransition : kidSpringSnappy}
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
              {outcome === "correct" && <m.span className={`${classes.outcome} kid-picture-outcome kid-picture-outcome--correct`} aria-hidden="true" data-outcome={outcome} data-testid="kid-outcome-correct" initial={kidOutcomeIconInitial} animate={kidOutcomeIconAnimate} transition={kidSpringBouncy} style={{ display: "inline-block" }}>✓</m.span>}
              {outcome === "wrong" && <m.span className={`${classes.outcome} kid-picture-outcome kid-picture-outcome--wrong`} aria-hidden="true" data-outcome={outcome} data-testid="kid-outcome-wrong" initial={kidOutcomeIconInitial} animate={kidWrongIconAnimate} transition={kidWrongIconTransition} style={{ display: "inline-block" }}>×</m.span>}
            </m.button>
          {/* Chosen correct tile: a small star burst out of the tile (outside
              the button, whose overflow is clipped). Decorative only. */}
          {outcome === "correct" && choseCorrectly && <BurstParticles size="sm" transient testId="kid-answer-burst" />}
          {afterOption?.(option)}
          </m.li>
        );
      })}
    </ul>
  );
}
