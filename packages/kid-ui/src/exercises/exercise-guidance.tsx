import { createContext, useContext, type ReactElement, type ReactNode } from "react";

const ExerciseGuidanceContext = createContext<ReactNode | null>(null);

/** Przycisk odsłuchu instrukcji zadania, który `ExerciseFrame` stawia obok jej tekstu.
 * Kontekst oszczędza przekazywania go przez `ExerciseView` i każdy widok ćwiczenia. */
export function ExerciseGuidanceProvider({ value, children }: {
  value: ReactNode | null;
  children: ReactNode;
}): ReactElement {
  return <ExerciseGuidanceContext.Provider value={value}>{children}</ExerciseGuidanceContext.Provider>;
}

export function useExerciseGuidance(): ReactNode | null {
  return useContext(ExerciseGuidanceContext);
}
