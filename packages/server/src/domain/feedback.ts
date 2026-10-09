import type { Grade } from "./types";

/**
 * Wybór treści feedbacku dla dziecka na podstawie rzeczywistego wyniku
 * (SPEC §16, §12.8). Domena zwraca rodzaj komunikatu i ewentualne poprawne
 * słowo; polskie teksty pochodzą z katalogu komunikatów po stronie klientów.
 * Nigdy nie chwalimy niepoprawnej odpowiedzi jako poprawnej.
 */
export type FeedbackKind =
  | "great"
  | "capitalization_hint"
  | "almost"
  | "incorrect"
  | "content_matched"
  | "not_assessed";

export interface FeedbackChoice {
  kind: FeedbackKind;
  /** Rozwiązanie własnego zadania; feedback nie ujawnia obcych celów (arch §9.3). */
  correctText?: string;
  /** Fragmenty wymowy (design 2026-10-09) — tylko tekst i werdykt, bez liczb. */
  fragments?: Grade["speechFragments"];
}

export function chooseFeedback(grade: Grade, correctText: string): FeedbackChoice {
  const assessed = Object.values(grade.skills).filter((skill) => skill.outcome !== "unevaluated");
  if (assessed.length === 0) {
    // ćwiczenie wymowy: usłyszane właściwe słowo bez oceny wymowy (SPEC §15.4)
    // albo rozbieżna treść — szczery komunikat zamiast udawanej oceny
    if (grade.speechAttempt?.contentMatched) return { kind: "content_matched" };
    if (grade.speechAttempt) return { kind: "incorrect", correctText };
    return { kind: "not_assessed" };
  }

  const anyCorrect = assessed.some((skill) => skill.outcome === "correct");
  const allCorrect = assessed.every((skill) => skill.outcome === "correct");
  if (allCorrect) return { kind: "great", ...(grade.speechFragments ? { fragments: grade.speechFragments } : {}) };

  if (anyCorrect) {
    // „To właściwe słowo! Monday piszemy wielką literą” — jedyny defekt
    // to kapitalizacja (SPEC §12.8); w pozostałych przypadkach „Prawie!”.
    const capitalization = assessed.some(
      (skill) => skill.outcome === "incorrect" && skill.details?.spelling?.capitalizationOnlyDefect,
    );
    return capitalization
      ? { kind: "capitalization_hint", correctText }
      : { kind: "almost", ...(grade.speechFragments ? { fragments: grade.speechFragments } : {}) };
  }
  // wymowa blisko progu — „Prawie! Posłuchaj jeszcze raz” (SPEC §16, §18)
  if (assessed.some((skill) => skill.details?.pronunciation?.band === "partial")) {
    return { kind: "almost", ...(grade.speechFragments ? { fragments: grade.speechFragments } : {}) };
  }
  return { kind: "incorrect", correctText };
}
