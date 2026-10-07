import { qualifyAttempt } from "./independence";
import { normalizeTargetText } from "./target-key";
import type {
  AnswerKey,
  EvaluationContext,
  ExerciseType,
  Grade,
  ReadingDirection,
  Skill,
  SkillGrade,
  SpellingDetails,
} from "./types";

/** Odpowiedzi niebędące próbą wiedzy: „Nie pamiętam" i „Pomiń" (arch §9.1a). */
export type NonAnswerKind = "dont_remember" | "skip";

/** Dopasowanie odpowiedzi pisemnej do klucza (bez LLM, A36). */
export interface WrittenMatch {
  /** Zgodność z wariantem co do znaku (po NFC i przycięciu brzegów). */
  exact: boolean;
  /** Zgodność z wariantem ignorując wielkość liter. */
  ci: boolean;
  matchedVariant: string | null;
}

export function matchWrittenAnswer(answer: string, key: AnswerKey): WrittenMatch {
  const normalized = answer.normalize("NFC").trim();
  const folded = normalizeTargetText(answer);
  const matched =
    [key.target, ...key.acceptedAnswers].find((candidate) => normalizeTargetText(candidate) === folded) ??
    null;
  return {
    exact: matched !== null && matched.normalize("NFC").trim() === normalized,
    ci: matched !== null,
    matchedVariant: matched,
  };
}

function skillsForExercise(exerciseType: ExerciseType): readonly Skill[] {
  switch (exerciseType) {
    case "listening":
      return ["listening"];
    case "reading":
    case "reverse_recognition":
      return ["reading"];
    case "recall":
    case "spelling":
    case "letter_completion":
      // Jedna samodzielna odpowiedź pisemna daje po jednym wyniku dla
      // przypomnienia i pisowni (SPEC §18, §12.5, §12.8).
      return ["recall", "spelling"];
    case "exposure":
    case "speech":
      return [];
  }
}

/** Umiejętności oceniane w danym typie ćwiczenia (puste dla prezentacji). */
export function assessedSkills(exerciseType: ExerciseType): readonly Skill[] {
  return skillsForExercise(exerciseType);
}

function directionFor(key: AnswerKey): ReadingDirection | undefined {
  if (key.exerciseType !== "reading" && key.exerciseType !== "reverse_recognition") {
    return undefined;
  }
  return key.direction ?? (key.exerciseType === "reading" ? "target_to_source" : "source_to_target");
}

function spellingDetails(match: WrittenMatch): SpellingDetails {
  return {
    matchedVariant: match.matchedVariant,
    wordMatched: match.ci,
    letterOrderMatched: match.ci,
    capitalizationCorrect: match.exact,
    capitalizationOnlyDefect: match.ci && !match.exact,
  };
}

function gradeSkill(
  skill: Skill,
  match: WrittenMatch,
  attempt: ReturnType<typeof qualifyAttempt>,
  direction: ReadingDirection | undefined,
): SkillGrade {
  const outcome =
    skill === "spelling" ? (match.exact ? "correct" : "incorrect") : match.ci ? "correct" : "incorrect";
  const details: { direction?: ReadingDirection; spelling?: SpellingDetails } = {};
  if (direction !== undefined) details.direction = direction;
  if (skill === "spelling") details.spelling = spellingDetails(match);
  return {
    outcome,
    independent: attempt.independent,
    confirmationEligible: attempt.independent && attempt.confirmationEligible && outcome === "correct",
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

/**
 * Ocenia pisemną (lub rozpoznaną tekstowo) odpowiedź według klucza i zamrożonego
 * kontekstu (SPEC §12.8, §18). Treść zaliczamy wyłącznie jednoznacznym
 * dopasowaniem do kanonicznej odpowiedzi lub zatwierdzonego wariantu —
 * podobieństwo tekstu samo w sobie nie wystarcza (A16).
 */
export function evaluateWritten(answer: string, key: AnswerKey, ctx: EvaluationContext): Grade {
  const attempt = qualifyAttempt(ctx);
  const direction = directionFor(key);
  const skills: Partial<Record<Skill, SkillGrade>> = {};
  const match = matchWrittenAnswer(answer, key);

  for (const skill of skillsForExercise(key.exerciseType)) {
    if (answer.normalize("NFC").trim() === "") {
      skills[skill] = {
        outcome: "unevaluated",
        reason: "ambiguous",
        independent: false,
        confirmationEligible: false,
        ...(direction !== undefined ? { details: { direction } } : {}),
      };
      continue;
    }
    skills[skill] = gradeSkill(skill, match, attempt, direction);
  }

  return { skills, attempt };
}

/**
 * Ocenia odpowiedź zamkniętą: poprawność rozstrzyga serwerowe id opcji
 * z klucza, nie porównanie tekstu — opcje zadań rozpoznawania są polskie
 * albo się powtarzają między zadaniami (SPEC §12.2–12.4).
 */
export function evaluateChoice(chosenOptionId: string, key: AnswerKey, ctx: EvaluationContext): Grade {
  const attempt = qualifyAttempt(ctx);
  const direction = directionFor(key);
  const correct = key.correctOptionId !== undefined && chosenOptionId === key.correctOptionId;
  const skills: Partial<Record<Skill, SkillGrade>> = {};

  for (const skill of skillsForExercise(key.exerciseType)) {
    skills[skill] = {
      outcome: correct ? "correct" : "incorrect",
      independent: attempt.independent,
      confirmationEligible: attempt.independent && attempt.confirmationEligible && correct,
      ...(direction !== undefined ? { details: { direction } } : {}),
    };
  }

  return { skills, attempt };
}

/**
 * Ocena odpowiedzi niebędącej próbą wiedzy. „Nie pamiętam" w niezależnym
 * kontekście to zadeklarowana trudność: incorrect + dont_remember + independent,
 * przerywa serię sukcesów, ale nie tworzy mylonej pary (SPEC §15.1, arch §9.1a).
 * „Pomiń" pozostaje bez oceny — nie jest deklaracją braku wiedzy (A32).
 */
export function evaluateNonAnswer(kind: NonAnswerKind, key: AnswerKey, ctx: EvaluationContext): Grade {
  const attempt = qualifyAttempt(ctx);
  const direction = directionFor(key);
  const skills: Partial<Record<Skill, SkillGrade>> = {};

  for (const skill of skillsForExercise(key.exerciseType)) {
    skills[skill] =
      kind === "dont_remember"
        ? {
            outcome: "incorrect",
            reason: "dont_remember",
            independent: attempt.independent,
            confirmationEligible: false,
            ...(direction !== undefined ? { details: { direction } } : {}),
          }
        : {
            outcome: "unevaluated",
            reason: "skipped",
            independent: false,
            confirmationEligible: false,
            ...(direction !== undefined ? { details: { direction } } : {}),
          };
  }

  return { skills, attempt };
}
