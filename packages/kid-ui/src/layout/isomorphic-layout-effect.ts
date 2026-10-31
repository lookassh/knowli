import { useEffect, useLayoutEffect } from "react";

/**
 * Efekt layoutu w przeglądarce, zwykły efekt na serwerze. Pomiar w efekcie
 * layoutu i aktualizacja stanu z niego trafiają na ekran przed pierwszym
 * malowaniem (React renderuje je synchronicznie w tym samym commicie); na
 * serwerze `useLayoutEffect` tylko by ostrzegał. Używają go `useKidViewport`
 * (pomiar okna i skala dużego okna dla `KidPage`) i `ExerciseFrame` (rezerwa
 * pod panelem wyniku).
 */
export const useIsomorphicLayoutEffect: typeof useLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
