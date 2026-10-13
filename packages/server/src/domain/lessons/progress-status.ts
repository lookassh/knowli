import type { ProgressStatus } from "../types";

/**
 * Odwzorowanie statusu bazy (`child_objective_progress.status`) na domenową
 * projekcję (`ProgressStatus`). Ta sama tabela wartości co słówkowe
 * `mapStatus` w `modules/sessions.ts`, ale czysta i w domenie — moduł lekcji
 * czyta ją stąd zamiast importować z `sessions.ts`, co usuwa zależność cykliczną
 * (sessions.ts deleguje do lesson-sessions.ts, więc odwrotny import byłby cyklem).
 */
export function mapObjectiveStatus(dbStatus: string): ProgressStatus {
  switch (dbStatus) {
    case "unseen":
      return "not_assessed";
    case "practicing":
      return "learning";
    case "needs_confirmation":
      return "needs_confirmation";
    case "needs_reconfirmation":
      return "needs_reconfirmation";
    case "mastered":
      return "mastered";
    default:
      return "not_assessed";
  }
}
