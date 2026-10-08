import { messages } from "@learning/contracts";
import type { ExerciseProps } from "./types";

/**
 * Rozpoznawanie tekstu i odwrotne (SPEC §12.3–12.4): widoczne słowo/prompt
 * i wybór odpowiedzi; wynik nie awansuje samodzielnego przypominania.
 */
export function ReadingView({ task, busy, handlers }: ExerciseProps) {
  if (task.prompt.kind !== "reading" && task.prompt.kind !== "reverse_recognition") {
    return null;
  }
  const visible = task.prompt.kind === "reading" ? task.prompt.text : task.prompt.prompt;
  return (
    <section className="kid-card">
      <h2>{messages.kid.chooseAnswer}</h2>
      <p className="kid-word" data-testid="kid-word">
        {visible}
      </p>
      <ul className="kid-options">
        {task.prompt.options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              data-testid="kid-option"
              disabled={busy}
              onClick={() => handlers.onAnswerChoice(option.id)}
            >
              {option.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
