import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { ActionButton } from "../../components/ActionButton";
import { LessonBlockButton } from "../../components/LessonBlockButton";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";
import { matchAssignments, matchComplete, matchPool, matchState, placeRight, rightOf, selectSlot } from "./assignment-state";

/**
 * „Połącz w pary” (`lesson_match`, design szkoły §10.5): każdy lewy element ma
 * pod sobą miejsce. Aktywne miejsce (domyślnie pierwsze puste) przyjmuje
 * dotknięty element z puli; dotknięcie zajętego miejsca oddaje element do puli
 * i czyni miejsce aktywnym. Tylko stukanie — przyciski działają z klawiatury.
 * „Sprawdź” wysyła przypisania po zapełnieniu wszystkich miejsc.
 */
export function LessonMatchView({ task, busy, dock, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "lesson_match" ? task.prompt : null;
  const [state, setState] = useState(() => matchState(prompt?.left ?? [], prompt?.right ?? []));
  const containerRef = useRef<HTMLDivElement>(null);
  useRetryReset(dock, () => {
    if (prompt) setState(matchState(prompt.left, prompt.right));
  }, () => containerRef.current?.querySelector("button")?.focus({ preventScroll: true }));
  if (prompt === null) return null;
  const disabled = busy || dock !== undefined;
  const complete = matchComplete(state);
  const pool = matchPool(state);
  const activeLeft = prompt.left.find((item) => item.id === state.active) ?? null;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <div ref={containerRef} className="kid-lesson-match" data-testid="kid-lesson-match">
          <ul className="kid-lesson-match__pairs" aria-label={messages.kid.lessonMatchPairs}>
            {prompt.left.map((item) => {
              const right = rightOf(state, item.id);
              const active = state.active === item.id;
              return (
                <li key={item.id} className="kid-lesson-match__row" data-testid="kid-lesson-match-row">
                  <span className="kid-lesson-match__left" data-testid="kid-lesson-match-left">{item.text}</span>
                  <LessonBlockButton
                    type="button"
                    className={`kid-lesson-block kid-lesson-match__slot${right ? " kid-lesson-block--placed" : ""}${active ? " kid-lesson-match__slot--active" : ""}`}
                    data-testid="kid-lesson-match-slot"
                    aria-pressed={active}
                    disabled={disabled}
                    aria-label={right
                      ? format(messages.kid.lessonMatchRemove, { item: item.text, answer: right.text })
                      : format(messages.kid.lessonMatchChooseSlot, { item: item.text })}
                    onClick={() => { setState((current) => selectSlot(current, item.id)); handlers.onEdit(); }}
                  >
                    {right ? right.text : messages.kid.lessonMatchEmptySlot}
                  </LessonBlockButton>
                </li>
              );
            })}
          </ul>
          {activeLeft && pool.length > 0 && (
            <p className="kid-hint" data-testid="kid-lesson-match-hint" aria-live="polite">
              {format(messages.kid.lessonMatchActiveHint, { item: activeLeft.text })}
            </p>
          )}
          <div className="kid-lesson-match__pool" data-testid="kid-lesson-match-pool" role="list" aria-label={messages.kid.lessonMatchPool}>
            {pool.map((item) => (
              <LessonBlockButton
                key={item.id}
                type="button"
                role="listitem"
                className="kid-lesson-block"
                data-testid="kid-lesson-match-option"
                disabled={disabled || state.active === null}
                aria-label={activeLeft
                  ? format(messages.kid.lessonMatchPlace, { item: activeLeft.text, answer: item.text })
                  : item.text}
                onClick={() => { setState((current) => placeRight(current, item.id)); handlers.onEdit(); }}
              >
                {item.text}
              </LessonBlockButton>
            ))}
          </div>
        </div>
      )}
      actions={(
        <ActionButton
          type="button"
          className="kid-primary"
          data-testid="kid-lesson-check"
          disabled={disabled || !complete}
          onClick={() => { if (complete && !disabled) handlers.onAnswerAssignment(matchAssignments(state)); }}
        >
          {messages.kid.lessonCheck}
        </ActionButton>
      )}
    />
  );
}
