"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface EditorLeaveState {
  dirty: boolean;
  busy: boolean;
}

export function useParentLeaveGuard() {
  const editorState = useRef<EditorLeaveState>({ dirty: false, busy: false });
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);

  const register = useCallback((state: EditorLeaveState) => {
    editorState.current = state;
    setDirty(state.dirty);
  }, []);

  const requestLeave = useCallback((action: () => void | Promise<void>) => {
    const current = editorState.current;
    if (current.busy) {
      return;
    }
    if (!current.dirty) {
      void action();
      return;
    }
    pendingAction.current = action;
    setPending(true);
  }, []);

  const stay = useCallback(() => {
    pendingAction.current = null;
    setPending(false);
  }, []);

  const leave = useCallback(async () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    setPending(false);
    await action?.();
  }, []);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorState.current.dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  /** Bieżący stan edytora — odczyt synchroniczny dla obsługi „wstecz” i wygasłej sesji. */
  const current = useCallback((): EditorLeaveState => editorState.current, []);

  return { register, requestLeave, pending, stay, leave, current };
}
