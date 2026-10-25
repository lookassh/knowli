import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Po „Spróbuj jeszcze raz” dock znika przy tym samym zadaniu, a widok
 * zostaje zamontowany (bodziec nie zmienia miejsca przy feedbacku).
 * Ponowna próba ma jednak startować z pustej odpowiedzi — jak przy
 * dawnej podmianie widoku na kartę wyniku — więc widoki z własnym
 * szkicem czyszczą go synchronicznie w tej tranzycji (korekta stanu
 * w renderze), a fokus pola wraca po commicie.
 *
 * Kontrakt: zniknięcie docka przy zamontowanym widoku oznacza retry.
 * LearnScreen nie może czyścić feedbacku z innego powodu bez
 * odmontowania widoku (offline/błąd odmontowują całe zadanie) — gdyby
 * doszła taka tranzycja, ten hook wyczyściłby też szkic, więc trzeba
 * by wtedy przekazać mu jawny sygnał retry.
 */
export function useRetryReset(dock: ReactNode, reset: () => void, afterReset?: () => void): void {
  const [wasDocked, setWasDocked] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  if (dock !== undefined && !wasDocked) {
    setWasDocked(true);
  }
  if (dock === undefined && wasDocked) {
    setWasDocked(false);
    reset();
    setResetCount((count) => count + 1);
  }
  const afterResetRef = useRef(afterReset);
  afterResetRef.current = afterReset;
  useEffect(() => {
    if (resetCount > 0) afterResetRef.current?.();
  }, [resetCount]);
}
