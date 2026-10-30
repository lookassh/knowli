import { Fragment, useRef, useState } from "react";
import { messages, type LessonItem } from "@learning/contracts";
import { format } from "../../format";
import { ExerciseFrame } from "../ExerciseFrame";
import { useRetryReset } from "../useRetryReset";
import type { ExerciseProps } from "../types";
import { AssignmentCheckButton, AssignmentPool, AssignmentSlot } from "./AssignmentPool";
import { matchAssignments, matchComplete, matchPool, matchState, placeRight, rightOf, selectSlot } from "./assignment-state";

/**
 * „Uzupełnij tekst” (`lesson_cloze`, design szkoły §13.5): luki w tekście są
 * tylko znacznikami (numer i wstawione słowo) — cele ≥48 px w środku zdania
 * rozsadzałyby wiersze na 320 px. Dziecko stuka miejsce luki pod tekstem
 * (domyślnie pierwsze puste), potem słowo z banku. Stan to reguły „Połącz
 * w pary”: luki = lewa kolumna, słowa = prawa.
 */
export function LessonClozeView({ task, busy, dock, handlers }: ExerciseProps) {
  const prompt = task.prompt.kind === "lesson_cloze" ? task.prompt : null;
  const gaps: LessonItem[] = (prompt?.segments ?? []).flatMap((segment, index) =>
    "gapId" in segment ? [{ id: segment.gapId, text: String(index) }] : []);
  const [state, setState] = useState(() => matchState(gaps, prompt?.words ?? []));
  const containerRef = useRef<HTMLDivElement>(null);
  useRetryReset(dock, () => {
    if (prompt) setState(matchState(gaps, prompt.words));
  }, () => containerRef.current?.querySelector("button")?.focus({ preventScroll: true }));
  if (prompt === null) return null;
  const disabled = busy || dock !== undefined;
  const complete = matchComplete(state);
  const pool = matchPool(state);
  const numberOf = new Map(gaps.map((gap, index) => [gap.id, index + 1] as const));
  const activeNumber = state.active === null ? null : numberOf.get(state.active) ?? null;

  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <div ref={containerRef} className="kid-lesson-cloze" data-testid="kid-lesson-cloze">
          <div className="kid-lesson-cloze__main">
            <p className="kid-lesson-cloze__text" data-testid="kid-lesson-cloze-text">
              {prompt.segments.map((segment, index) => {
                if (!("gapId" in segment)) {
                  return prompt.contentLocale
                    ? <span key={index} data-testid="kid-lesson-cloze-segment" lang={prompt.contentLocale}>{segment.text}</span>
                    : <Fragment key={index}>{segment.text}</Fragment>;
                }
                const n = numberOf.get(segment.gapId) ?? 0;
                const word = rightOf(state, segment.gapId);
                const active = state.active === segment.gapId;
                return (
                  <span
                    key={segment.gapId}
                    className={`kid-lesson-cloze__gap${word ? " kid-lesson-cloze__gap--filled" : ""}${active ? " kid-lesson-cloze__gap--active" : ""}`}
                    data-testid="kid-lesson-cloze-gap"
                  >
                    <span className="kid-visually-hidden">
                      {word ? format(messages.kid.lessonClozeGapFilled, { n, word: word.text }) : format(messages.kid.lessonClozeGapEmpty, { n })}
                    </span>
                    <span aria-hidden="true" lang={prompt.contentLocale}>
                      <span className="kid-lesson-cloze__gap-number">{n}</span>
                      {word ? word.text : "…"}
                    </span>
                  </span>
                );
              })}
            </p>
            <ul className="kid-lesson-cloze__slots" aria-label={messages.kid.lessonClozeGaps}>
              {gaps.map((gap, index) => {
                const n = index + 1;
                const word = rightOf(state, gap.id);
                const active = state.active === gap.id;
                return (
                  <li key={gap.id} className="kid-lesson-cloze__slot-row">
                    <AssignmentSlot
                      filled={word !== null}
                      active={active}
                      disabled={disabled}
                      testId="kid-lesson-cloze-slot"
                      lang={word ? prompt.contentLocale : undefined}
                      label={word
                        ? format(messages.kid.lessonClozeRemove, { n, word: word.text })
                        : format(messages.kid.lessonClozeChooseSlot, { n })}
                      onSelect={() => { setState((current) => selectSlot(current, gap.id)); handlers.onEdit(); }}
                    >
                      <span className="kid-lesson-cloze__gap-number" aria-hidden="true">{n}</span>
                      {word ? word.text : messages.kid.lessonClozeEmptySlot}
                    </AssignmentSlot>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="kid-lesson-cloze__bank">
            {activeNumber !== null && pool.length > 0 && (
              <p className="kid-hint" data-testid="kid-lesson-cloze-hint" aria-live="polite">
                {format(messages.kid.lessonClozeActiveHint, { n: activeNumber })}
              </p>
            )}
            <AssignmentPool
              items={pool}
              className="kid-lesson-match__pool"
              testId="kid-lesson-cloze-pool"
              optionTestId="kid-lesson-cloze-option"
              label={messages.kid.lessonClozePool}
              disabled={disabled || state.active === null}
              lang={prompt.contentLocale}
              labelOf={(item) => (activeNumber !== null ? format(messages.kid.lessonClozePlace, { n: activeNumber, word: item.text }) : item.text)}
              onPick={(itemId) => { setState((current) => placeRight(current, itemId)); handlers.onEdit(); }}
            />
          </div>
        </div>
      )}
      actions={(
        <AssignmentCheckButton disabled={disabled} complete={complete} onCheck={() => handlers.onAnswerAssignment(matchAssignments(state))} />
      )}
    />
  );
}
