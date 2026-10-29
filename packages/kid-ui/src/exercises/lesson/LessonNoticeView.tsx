import { messages } from "@learning/contracts";
import { ExerciseFrame } from "../ExerciseFrame";
import { KidIcon } from "../../components/KidIcon";
import { WordChoiceButton } from "../../components/WordChoiceButton";
import type { ExerciseProps } from "../types";

/**
 * Wskazanie (`lesson_notice`): zdania złożone z dotykowych słów; dotknięcie
 * słowa wysyła odpowiedź `choice` z id segmentu. Podświetlenie po próbie
 * pochodzi wyłącznie z feedbacku serwera (`optionOutcomes`), nigdy lokalnie —
 * wynik nie zapala się przy braku sieci.
 */
export function LessonNoticeView({ task, busy, optionOutcomes, dock, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "lesson_notice") return null;
  return (
    <ExerciseFrame
      task={task}
      content={(
        <div className="kid-lesson-notice" data-testid="kid-lesson-notice">
          {task.prompt.segments.map((sentence, sentenceIndex) => (
            <p key={sentenceIndex} className="kid-lesson-notice__sentence">
              {sentence.map((segment) => {
                const outcome = optionOutcomes.get(segment.id);
                return (
                  <WordChoiceButton
                    key={segment.id}
                    type="button"
                    data-testid="kid-lesson-notice-word"
                    className={["kid-lesson-notice__word", outcome === undefined ? "" : `kid-option--${outcome}`].filter(Boolean).join(" ")}
                    aria-pressed={outcome === "pending"}
                    disabled={busy}
                    onClick={() => handlers.onAnswerChoice(segment.id)}
                  >
                    {segment.text}
                    {(outcome === "correct" || outcome === "wrong") && (
                      <span
                        className="kid-lesson-notice__outcome"
                        aria-hidden="true"
                        data-outcome={outcome}
                        data-testid="kid-lesson-notice-outcome"
                      >
                        <KidIcon name={outcome === "correct" ? "check" : "close"} />
                      </span>
                    )}
                  </WordChoiceButton>
                );
              })}
            </p>
          ))}
        </div>
      )}
      secondaryActions={<p className="kid-hint">{messages.kid.lessonNoticeInstruction}</p>}
      dock={dock}
    />
  );
}
