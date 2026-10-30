import { useEffect, useId, useRef, type ReactElement } from "react";
import { AnimatePresence, m, useIsPresent } from "motion/react";
import { messages } from "@learning/contracts";
import {
  kidScrimTransition,
  kidSheetAnimate,
  kidSheetExit,
  kidSheetExitTransition,
  kidSheetInitial,
  kidSheetTransition,
} from "../motion/kid-motion";
import { ActionButton } from "./ActionButton";
import classes from "./EndSessionConfirm.module.css";

export interface EndSessionConfirmProps {
  open: boolean;
  mockTest: boolean;
  /** The session is busy: ending waits, continuing is always possible. */
  busy: boolean;
  onContinue: () => void;
  onEnd: () => void;
}

/**
 * Modalny dolny panel potwierdzenia ✕ „Koniec”. Domyślny fokus i główna akcja
 * to „Ćwiczę dalej”; Escape i dotknięcie tła działają tak samo. Fokus zostaje
 * w panelu, a skróty klawiszowe ćwiczenia pod spodem nie dostają klawiszy.
 */
export function EndSessionConfirm(props: EndSessionConfirmProps): ReactElement {
  return <AnimatePresence>{props.open && <EndSessionSheet key="end-confirm" {...props} />}</AnimatePresence>;
}

function EndSessionSheet({ mockTest, busy, onContinue, onEnd }: EndSessionConfirmProps): ReactElement {
  const titleId = useId();
  const bodyId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const isPresent = useIsPresent();
  const continueAction = useRef(onContinue);
  continueAction.current = onContinue;

  useEffect(() => {
    continueRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!isPresent) return;
    // Document listener runs before the exercise's window shortcuts (digits,
    // Space, Enter), so stopping propagation keeps them from acting under the panel.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        continueAction.current();
        return;
      }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      const buttons = sheet ? [...sheet.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")] : [];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = active instanceof Node && sheet !== null && sheet.contains(active);
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPresent]);

  return (
    <m.div
      className={classes.scrim}
      data-testid="kid-end-confirm-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: kidSheetExitTransition }}
      transition={kidScrimTransition}
      inert={!isPresent}
      onClick={(event) => {
        if (event.target === event.currentTarget) onContinue();
      }}
    >
      <m.section
        ref={sheetRef}
        className={classes.sheet}
        data-testid="kid-end-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        initial={kidSheetInitial}
        animate={kidSheetAnimate}
        exit={{ ...kidSheetExit, transition: kidSheetExitTransition }}
        transition={kidSheetTransition}
      >
        <h2 id={titleId} className={classes.title}>{messages.kid.endConfirmTitle}</h2>
        <p id={bodyId} className={classes.body}>
          {mockTest ? messages.kid.endConfirmMockTest : messages.kid.endConfirmSaved}
        </p>
        <div className={classes.actions}>
          <ActionButton ref={continueRef} variant="filled" data-testid="kid-end-continue" onClick={onContinue}>
            {messages.kid.endConfirmContinue}
          </ActionButton>
          <ActionButton variant="outlined" data-testid="kid-end-confirm-end" disabled={busy} onClick={onEnd}>
            {messages.kid.endConfirmEnd}
          </ActionButton>
        </div>
      </m.section>
    </m.div>
  );
}
