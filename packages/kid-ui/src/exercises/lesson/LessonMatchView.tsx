import { useRef, useState } from "react";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";
import { AssignmentCheckButton, AssignmentPool, AssignmentSlot } from "./AssignmentPool";
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
                  <AssignmentSlot
                    filled={right !== null}
                    active={active}
                    disabled={disabled}
                    testId="kid-lesson-match-slot"
                    label={right
                      ? format(messages.kid.lessonMatchRemove, { item: item.text, answer: right.text })
                      : format(messages.kid.lessonMatchChooseSlot, { item: item.text })}
                    onSelect={() => { setState((current) => selectSlot(current, item.id)); handlers.onEdit(); }}
                  >
                    {right ? right.text : messages.kid.lessonMatchEmptySlot}
                  </AssignmentSlot>
                </li>
              );
            })}
          </ul>
          {activeLeft && pool.length > 0 && (
            <p className="kid-hint" data-testid="kid-lesson-match-hint" aria-live="polite">
              {format(messages.kid.lessonMatchActiveHint, { item: activeLeft.text })}
            </p>
          )}
          <AssignmentPool
            items={pool}
            className="kid-lesson-match__pool"
            testId="kid-lesson-match-pool"
            optionTestId="kid-lesson-match-option"
            label={messages.kid.lessonMatchPool}
            disabled={disabled || state.active === null}
            labelOf={(item) => (activeLeft ? format(messages.kid.lessonMatchPlace, { item: activeLeft.text, answer: item.text }) : item.text)}
            onPick={(itemId) => { setState((current) => placeRight(current, itemId)); handlers.onEdit(); }}
          />
        </div>
      )}
      actions={(
        <AssignmentCheckButton disabled={disabled} complete={complete} onCheck={() => handlers.onAnswerAssignment(matchAssignments(state))} />
      )}
    />
  );
}
