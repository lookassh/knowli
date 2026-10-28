import type { LessonExerciseDraft, LessonTopic } from "../../types";

/**
 * Reguły przedmiotu szkolnego dokładane do walidacji ogólnej puli
 * (`subject.validateExercise`) oraz walidacja całej puli z materiałem
 * (`validatePoolExtra`: uziemienie cytatów i spójność rodzin pytań).
 * Komunikaty po polsku, z nazwą pola — jak reszta walidatorów lekcji.
 */

const OPEN_TYPE = "lesson_open_answer";

/** Normalizacja do porównania cytatu z materiałem: NFC, białe znaki, wielkość liter. */
function normalizeForGrounding(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function validateSchoolExercise(ex: LessonExerciseDraft, _topic: LessonTopic): string[] {
  const errors: string[] = [];

  // Każde ćwiczenie puli musi mieć uziemienie (obecność; zgodność z materiałem
  // sprawdza validateSchoolPool, które ma dostęp do materiału).
  if (ex.exerciseType !== "lesson_card") {
    if (!ex.sourceRefs || ex.sourceRefs.length === 0) {
      errors.push("sourceRefs: ćwiczenie przedmiotu szkolnego wymaga co najmniej jednego cytatu źródłowego");
    }
  }

  if (ex.exerciseType === OPEN_TYPE) {
    if (!ex.questionType) {
      errors.push("questionType: odpowiedź otwarta wymaga typu pytania");
    }
    if (!ex.requiredElements || ex.requiredElements.length === 0) {
      errors.push("requiredElements: odpowiedź otwarta wymaga 1–6 elementów wymaganych");
    } else {
      const ids = ex.requiredElements.map((el) => el.id);
      if (new Set(ids).size !== ids.length) {
        errors.push("requiredElements: identyfikatory elementów muszą być unikalne w ćwiczeniu");
      }
    }
    if (!ex.expectedForm) {
      errors.push("expectedForm: odpowiedź otwarta wymaga oczekiwanej formy");
    }
  } else {
    if (ex.questionType !== undefined) {
      errors.push("questionType: typ pytania dotyczy tylko odpowiedzi otwartej");
    }
    if (ex.requiredElements !== undefined) {
      errors.push("requiredElements: elementy wymagane dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.supplementaryElements !== undefined) {
      errors.push("supplementaryElements: elementy uzupełniające dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.commonErrors !== undefined) {
      errors.push("commonErrors: typowe błędy dotyczą tylko odpowiedzi otwartej");
    }
    if (ex.expectedForm !== undefined) {
      errors.push("expectedForm: oczekiwana forma dotyczy tylko odpowiedzi otwartej");
    }
    if (ex.familyId !== undefined) {
      errors.push("familyId: rodziny pytań dotyczą tylko odpowiedzi otwartej");
    }
  }

  return errors;
}

/**
 * Walidacja puli z materiałem: (1) każdy cytat niepochodzący od rodzica musi
 * być dokładnym fragmentem materiału (po normalizacji), (2) ćwiczenia jednej
 * rodziny pytań muszą mieć ten sam cel, tę samą odpowiedź wzorcową i ten sam
 * zbiór identyfikatorów elementów wymaganych.
 */
export function validateSchoolPool(
  drafts: readonly LessonExerciseDraft[],
  ctx: { material: string },
): ReadonlyMap<number, readonly string[]> {
  const errors = new Map<number, string[]>();
  const push = (index: number, message: string) => {
    const list = errors.get(index) ?? [];
    list.push(message);
    errors.set(index, list);
  };

  const materialNormalized = normalizeForGrounding(ctx.material);
  drafts.forEach((ex, index) => {
    for (const ref of ex.sourceRefs ?? []) {
      if (ref.parentAdded === true) continue;
      const quote = normalizeForGrounding(ref.quote);
      if (quote.length < 10) {
        push(index, "sourceRefs: cytat za krótki, aby uziemiał ćwiczenie (min. 10 znaków)");
      } else if (!materialNormalized.includes(quote)) {
        push(index, "sourceRefs: cytat nie występuje w materiale źródłowym");
      }
    }
  });

  const families = new Map<string, number[]>();
  drafts.forEach((ex, index) => {
    if (!ex.familyId) return;
    const list = families.get(ex.familyId) ?? [];
    list.push(index);
    families.set(ex.familyId, list);
  });
  for (const [familyId, indexes] of families) {
    if (indexes.length < 2) continue;
    const first = drafts[indexes[0]!]!;
    const firstElements = (first.requiredElements ?? []).map((el) => el.id).sort().join(",");
    for (const index of indexes.slice(1)) {
      const ex = drafts[index]!;
      const elements = (ex.requiredElements ?? []).map((el) => el.id).sort().join(",");
      const samePrompt =
        normalizeForGrounding(ex.prompt ?? "") === normalizeForGrounding(first.prompt ?? "") && (ex.prompt ?? "") !== "";
      if (samePrompt) {
        push(index, `familyId: ćwiczenie z rodziny „${familyId}” powiela tekst pytania innego członka rodziny`);
      }
      if (ex.objectiveId !== first.objectiveId || ex.answer.trim() !== first.answer.trim() || elements !== firstElements) {
        push(
          index,
          `familyId: ćwiczenie z rodziny „${familyId}” różni się celem, odpowiedzią wzorcową lub elementami wymaganymi od reszty rodziny`,
        );
      }
    }
  }

  return errors;
}
