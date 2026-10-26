import { useEffect, useRef } from "react";
import { messages } from "@learning/contracts";
import { ActionButton } from "../../components/ActionButton";
import { ExerciseFrame } from "../ExerciseFrame";
import type { ExerciseProps } from "../types";

/**
 * Karta lekcji (`lesson_card`): tytuł, treść wyjaśnienia i przykłady; „Dalej”
 * zamyka prezentację przez `complete-presentation` (nie jest oceniana, nie
 * zużywa budżetu). Jeden jasny krok, bez pól do wypełnienia.
 */
export function LessonCardView({ task, busy, dock, handlers }: ExerciseProps) {
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [task.taskId]);

  if (task.prompt.kind !== "lesson_card") return null;
  const { title, body, examples } = task.prompt.card;
  return (
    <ExerciseFrame
      dock={dock}
      task={task}
      content={(
        <article className="kid-lesson-card" data-testid="kid-lesson-card">
          <h2 className="kid-lesson-card__title" data-testid="kid-lesson-card-title">{title}</h2>
          <p className="kid-lesson-card__body" data-testid="kid-lesson-card-body">{body}</p>
          {examples.length > 0 && (
            <ul className="kid-lesson-card__examples" data-testid="kid-lesson-card-examples">
              {examples.map((example, index) => (
                <li key={index} lang="en-GB"><span>{example}</span></li>
              ))}
            </ul>
          )}
        </article>
      )}
      actions={(
        <ActionButton
          ref={nextRef}
          type="button"
          className="kid-primary"
          data-testid="kid-lesson-next"
          disabled={busy}
          onClick={handlers.onComplete}
        >
          {messages.kid.lessonNext}
        </ActionButton>
      )}
    />
  );
}
