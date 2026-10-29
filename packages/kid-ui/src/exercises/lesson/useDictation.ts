import { useEffect, useRef, useState } from "react";
import type { ExerciseProps } from "../types";

/**
 * Pole odpowiedzi zasilane dyktowaniem (design szkoły §5.3): rozpoznany tekst
 * wchodzi do pola raz na wynik (`seq`), a dziecko może go poprawić przed
 * „Sprawdź”. Sposób wprowadzenia to „speech”, dopóki pole nie zostanie
 * wyczyszczone; czy tekst poprawiono, rozstrzyga serwer. Po dwóch nieudanych
 * dyktowaniach z rzędu fokus wraca do pola — pisanie jest zawsze dostępne.
 */
export function useDictationField(
  dictation: ExerciseProps["dictation"],
  setText: (text: string) => void,
  focusField: () => void,
): { inputMethod: "keyboard" | "speech"; onTextChange: (text: string) => void; reset: () => void } {
  const [fromDictation, setFromDictation] = useState(false);
  const applied = useRef<number | null>(null);

  useEffect(() => {
    if (!dictation || applied.current === dictation.seq) return;
    applied.current = dictation.seq;
    if (dictation.status === "heard" && dictation.text) {
      setText(dictation.text);
      setFromDictation(true);
      return;
    }
    if (dictation.failures >= 2) focusField();
  }, [dictation, setText, focusField]);

  return {
    inputMethod: fromDictation ? "speech" : "keyboard",
    onTextChange: (text) => { if (text.trim() === "") setFromDictation(false); },
    reset: () => setFromDictation(false),
  };
}
