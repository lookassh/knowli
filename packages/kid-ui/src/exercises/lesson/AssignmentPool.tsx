import type { ReactNode } from "react";
import { messages, type LessonItem } from "@learning/contracts";
import { ActionButton } from "../../components/ActionButton";
import { LessonBlockButton } from "../../components/LessonBlockButton";

/**
 * Pula elementów do przypisania i „Sprawdź” — wspólne dla „Połącz w pary”,
 * „Pogrupuj” i „Uzupełnij tekst” (design szkoły §10.5, §13.5). Dotknięcie
 * elementu przekazuje jego id; co jest aktywnym celem, wie widok. `lang` oznacza
 * język tekstu elementów — przekazuj go tylko, gdy cała pula jest w jednym,
 * znanym języku (np. nie dla prawej kolumny par, gdzie bywa polskie znaczenie).
 */
export function AssignmentPool({ items, className, testId, optionTestId, label, disabled, lang, labelOf, onPick }: {
  items: readonly LessonItem[];
  className: string;
  testId: string;
  optionTestId: string;
  label: string;
  disabled: boolean;
  lang?: string | undefined;
  labelOf: (item: LessonItem) => string;
  onPick: (itemId: string) => void;
}) {
  return (
    <div className={className} data-testid={testId} role="list" aria-label={label}>
      {items.map((item) => (
        <div key={item.id} role="listitem" className="kid-lesson-assign__entry">
          <LessonBlockButton
            type="button"
            className="kid-lesson-block"
            data-testid={optionTestId}
            lang={lang}
            disabled={disabled}
            aria-label={labelOf(item)}
            onClick={() => onPick(item.id)}
          >
            {item.text}
          </LessonBlockButton>
        </div>
      ))}
    </div>
  );
}

/**
 * Miejsce na element (para, luka): przerywana obwódka, gdy puste; aktywne
 * przyjmuje następny dotknięty element z puli; zajęte po dotknięciu oddaje go.
 * `lang` oznacza język umieszczonego elementu (jak w `AssignmentPool`).
 */
export function AssignmentSlot({ filled, active, disabled, testId, label, lang, onSelect, children }: {
  filled: boolean;
  active: boolean;
  disabled: boolean;
  testId: string;
  label: string;
  lang?: string | undefined;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <LessonBlockButton
      type="button"
      className={`kid-lesson-block kid-lesson-match__slot${filled ? " kid-lesson-block--placed" : ""}${active ? " kid-lesson-match__slot--active" : ""}`}
      data-testid={testId}
      lang={lang}
      aria-pressed={active}
      disabled={disabled}
      aria-label={label}
      onClick={onSelect}
    >
      {children}
    </LessonBlockButton>
  );
}

/** „Sprawdź” przypisań: aktywne dopiero przy komplecie. */
export function AssignmentCheckButton({ disabled, complete, onCheck }: { disabled: boolean; complete: boolean; onCheck: () => void }) {
  return (
    <ActionButton
      type="button"
      className="kid-primary"
      data-testid="kid-lesson-check"
      disabled={disabled || !complete}
      onClick={() => { if (complete && !disabled) onCheck(); }}
    >
      {messages.kid.lessonCheck}
    </ActionButton>
  );
}
