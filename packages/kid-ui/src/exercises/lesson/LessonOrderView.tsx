import { useEffect, useState } from "react";
import { UnstyledButton } from "@mantine/core";
import { messages } from "@learning/contracts";
import { format } from "../../format";
import { ActionButton } from "../../components/ActionButton";
import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";
import { addBlock, blockState, isComplete, placedIds, removeAt } from "./block-order";

/**
 * Układanie klocków (`lesson_order`): dotknięcie klocka w puli dodaje go do
 * zdania, dotknięcie klocka w zdaniu cofa go do puli; „Sprawdź” aktywne po
 * ułożeniu wszystkich klocków i wysyła odpowiedź `sequence` z kolejnością id.
 * Klocki to przyciski — dostępne z klawiatury (focus, Enter/Spacja) — a stan
 * jest czysty (`block-order`), więc widok pozostaje cienki. Kolor nie jest
 * jedynym nośnikiem: pula i zdanie są osobnymi, opisanymi grupami.
 */
export function LessonOrderView({ task, busy, handlers }: ExerciseProps) {
  const [state, setState] = useState(() => blockState(task.prompt.kind === "lesson_order" ? task.prompt.items : []));
  useEffect(() => {
    if (task.prompt.kind === "lesson_order") setState(blockState(task.prompt.items));
  }, [task.taskId, task.prompt]);
  if (task.prompt.kind !== "lesson_order") return null;
  const complete = isComplete(state);
  const disabled = busy;

  return (
    <ExerciseFrame
      task={task}
      content={(
        <div className="kid-lesson-order" data-testid="kid-lesson-order">
          <div
            className="kid-lesson-order__sentence"
            data-testid="kid-lesson-order-sentence"
            role="list"
            aria-label={messages.kid.lessonOrderSentence}
          >
            {state.placed.length === 0 && <span className="kid-hint">{messages.kid.lessonOrderEmpty}</span>}
            {state.placed.map((item, index) => (
              <UnstyledButton
                key={item.id}
                type="button"
                role="listitem"
                className="kid-lesson-block kid-lesson-block--placed"
                data-testid="kid-lesson-order-placed"
                disabled={disabled}
                aria-label={format(messages.kid.lessonOrderRemoveBlock, { word: item.text })}
                onClick={() => { setState((current) => removeAt(current, index)); handlers.onEdit(); }}
              >
                {item.text}
              </UnstyledButton>
            ))}
          </div>
          <div
            className="kid-lesson-order__pool"
            data-testid="kid-lesson-order-pool"
            role="list"
            aria-label={messages.kid.lessonOrderPool}
          >
            {state.pool.map((item) => (
              <UnstyledButton
                key={item.id}
                type="button"
                role="listitem"
                className="kid-lesson-block"
                data-testid="kid-lesson-order-block"
                disabled={disabled}
                aria-label={format(messages.kid.lessonOrderAddBlock, { word: item.text })}
                onClick={() => { setState((current) => addBlock(current, item.id)); handlers.onEdit(); }}
              >
                {item.text}
              </UnstyledButton>
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
          onClick={() => handlers.onAnswerSequence(placedIds(state))}
        >
          {messages.kid.lessonCheck}
        </ActionButton>
      )}
    />
  );
}
