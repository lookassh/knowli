import { MAX_COMMON_ERRORS, MAX_LESSON_TEXT_LENGTH } from "@learning/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  GAP_MARKER,
  MAX_GAP_ANSWER_TOKENS,
  contractIssues,
  validateLessonExercise,
  validateLessonExerciseIssues,
} from "./pool-validation";
import { messagesOf, type LessonRuleIssue } from "./rules/catalog";
import { CORE_CASE_BASELINES } from "./rules/core.rule-cases";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { schoolSubject } from "./subjects/school/module";
import type { LessonExerciseDraft } from "./types";

/**
 * Zgłoszenia reguł rdzenia (spec katalogu reguł §4.2): tabela błędów kontraktu na
 * prawdziwym `safeParse`, ponowna analiza po pustych napisach (ścieżka agenta),
 * pole źródłowe zamiast `answer` w typach liczonych i konkretne `found`.
 * Komunikaty rodzica (`validateLessonExercise`) pilnuje `pool-validation.test.ts`.
 */

const englishTopic = englishGrammarSubject.topics[0]!;
const THIRD_PERSON = "english_grammar.present_simple.third_person_s";

function draft(overrides: Partial<LessonExerciseDraft>): LessonExerciseDraft {
  return {
    exerciseType: "lesson_gap",
    objectiveId: THIRD_PERSON,
    answer: "plays",
    acceptedAnswers: [],
    focus: ["plays"],
    stem: `She ${GAP_MARKER} tennis.`,
    hint: "play",
    ...overrides,
  };
}

const issuesOf = (ex: LessonExerciseDraft, options?: { readonly reanalyzeEmpty?: boolean }) =>
  validateLessonExerciseIssues(ex, englishGrammarSubject, englishTopic, options);

const rulesOf = (issues: readonly LessonRuleIssue[]) => issues.map((issue) => issue.rule as string);

const only = (issues: readonly LessonRuleIssue[], rule: string): LessonRuleIssue => {
  const matching = issues.filter((issue) => issue.rule === rule);
  expect(matching, `${rule} w ${JSON.stringify(issues)}`).toHaveLength(1);
  return matching[0]!;
};

/** Pytanie otwarte szkoły z polami v3 (kontrakt przepuszcza je dla każdego przedmiotu). */
function schoolOpen(overrides: Record<string, unknown>): LessonExerciseDraft {
  return {
    exerciseType: "lesson_open_answer",
    objectiveId: "school.x",
    prompt: "Co wytwarza roślina?",
    answer: "Cukry.",
    acceptedAnswers: [],
    focus: [],
    ...overrides,
  } as LessonExerciseDraft;
}

const schoolTopic = schoolSubject.topics[0] ?? englishTopic;
const schoolIssuesOf = (ex: LessonExerciseDraft) => validateLessonExerciseIssues(ex, schoolSubject, schoolTopic);

describe("kontrakt (Zod) → reguły", () => {
  it("pusty napis → field.empty z polem i dzisiejszym komunikatem", () => {
    const issue = only(issuesOf(draft({ hint: "" })), "field.empty");
    expect(issue).toMatchObject({ field: "hint", pl: "hint: wymagane minimum 1", found: "empty string" });
  });

  it("za długi napis → field.max_length z długością i limitem", () => {
    const issue = only(issuesOf(draft({ prompt: "p".repeat(134) })), "field.max_length");
    expect(issue.field).toBe("prompt");
    expect(issue.pl).toBe(`prompt: przekracza limit ${MAX_LESSON_TEXT_LENGTH}`);
    expect(issue.found).toContain("134");
    expect(issue.found).toContain(String(MAX_LESSON_TEXT_LENGTH));
  });

  it("za krótki napis z minimum > 1 → field.max_length, za krótka lista → field.count (według origin)", () => {
    const schema = z.object({ code: z.string().min(3), tags: z.array(z.string()).min(2) });
    const input = { code: "ab", tags: ["x"] };
    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(false);
    const issues = contractIssues(parsed.error!.issues, input);
    expect(issues.map((issue) => [issue.rule, issue.field])).toEqual([["field.max_length", "code"], ["field.count", "tags"]]);
    expect(issues[0]!.found).toBe("2 characters, minimum 3");
    expect(issues[1]!.found).toBe("1 items, at least 2");
    // Lista za krótka na prawdziwym kontrakcie ćwiczenia.
    expect(only(schoolIssuesOf(schoolOpen({ requiredElements: [] })), "field.count").field).toBe("requiredElements");
  });

  it("za długa lista → field.count z licznością i limitem", () => {
    const issue = only(
      schoolIssuesOf(schoolOpen({ commonErrors: Array.from({ length: 6 }, (_, i) => `błąd ${i}`) })),
      "field.count",
    );
    expect(issue.field).toBe("commonErrors");
    expect(issue.found).toContain("6");
    expect(issue.found).toContain(String(MAX_COMMON_ERRORS));
  });

  it("wartość spoza enum → field.invalid z otrzymaną wartością", () => {
    const issue = only(schoolIssuesOf(schoolOpen({ questionType: "explanation" })), "field.invalid");
    expect(issue.field).toBe("questionType");
    expect(issue.found).toContain('"explanation"');
    expect(issue.pl).toBe("questionType: nieprawidłowy typ lub wartość");
  });

  it.each([
    ["obcy klucz", { mood: "happy" }, "exercise", "mood"],
    ["invalid_union", { calculation: { kind: "bogus" } }, "calculation.kind", "matches none of the allowed shapes"],
    [
      "custom",
      { calculation: { kind: "scale_distance", params: { scaleDenominator: 100, mapDistanceCm: 1.0001 }, unit: "m", templateFamilyId: "map-scale" } },
      "calculation.params.mapDistanceCm",
      "fails the contract check",
    ],
  ] as const)("%s → field.invalid", (_name, overrides, field, foundPart) => {
    const issues = schoolIssuesOf(schoolOpen(overrides));
    const issue = only(issues, "field.invalid");
    expect(issue.field).toBe(field);
    expect(issue.found).toContain(foundPart);
  });

  it("liczności list z własną regułą rdzenia dostają jej id", () => {
    const tooManyVariants = issuesOf(draft({ acceptedAnswers: Array.from({ length: 41 }, (_, i) => `v${i}`) }));
    expect(rulesOf(tooManyVariants)).toEqual(["variants.count"]);
    const longAnswer = schoolIssuesOf(schoolOpen({ answer: "a".repeat(301) }));
    expect(rulesOf(longAnswer)).toEqual(["answer.max_length"]);
  });
});

describe("ponowna analiza po pustych napisach (reanalyzeEmpty)", () => {
  const emptyHintBadFocus = draft({ hint: "", focus: ["tennis"] });

  it("pusty napis w polu opcjonalnym i błędny focus → oba zgłoszenia", () => {
    const rules = rulesOf(issuesOf(emptyHintBadFocus, { reanalyzeEmpty: true }));
    expect(rules[0]).toBe("field.empty");
    expect(rules).toContain("focus.not_contiguous");
  });

  it("field.empty i inny błąd kontraktu → tylko kontrakt", () => {
    const rules = rulesOf(issuesOf(draft({ hint: "", prompt: "p".repeat(134), focus: ["tennis"] }), { reanalyzeEmpty: true }));
    expect(rules.sort()).toEqual(["field.empty", "field.max_length"]);
  });

  it("bez opcji → tylko kontrakt (także w komunikatach rodzica)", () => {
    expect(rulesOf(issuesOf(emptyHintBadFocus))).toEqual(["field.empty"]);
    expect(validateLessonExercise(emptyHintBadFocus, englishGrammarSubject, englishTopic)).toEqual(["hint: wymagane minimum 1"]);
  });
});

describe("pole źródłowe zamiast answer w typach liczonych", () => {
  const base = (exerciseType: LessonExerciseDraft["exerciseType"], fields: Record<string, unknown>) =>
    ({ exerciseType, objectiveId: THIRD_PERSON, answer: "", acceptedAnswers: [], focus: [], ...fields }) as LessonExerciseDraft;

  it.each([
    ["lesson_match", "pairs", { pairs: [] }],
    ["lesson_group", "groups", { groups: [] }],
    ["lesson_cloze", "gapAnswers", { clozeText: "a ___ b ___ c", gapAnswers: [] }],
    ["lesson_keywords", "keyOptionIds", { keyOptionIds: [] }],
    ["lesson_calculation", "calculation", { calculation: { kind: "bogus" } }],
  ] as const)("%s: własne zgłoszenie pola %s → bez zgłoszenia answer", (type, source, fields) => {
    const issues = issuesOf(base(type, fields));
    expect(issues.some((issue) => issue.field === source || issue.field.startsWith(`${source}.`))).toBe(true);
    expect(issues.some((issue) => issue.field === "answer")).toBe(false);
  });

  it.each([
    ["lesson_match", "pairs"],
    ["lesson_group", "groups"],
    ["lesson_cloze", "gapAnswers"],
    ["lesson_keywords", "keyOptionIds"],
    ["lesson_calculation", "calculation"],
  ] as const)("%s bez pola źródłowego → zgłoszenie answer ma ścieżkę %s", (type, source) => {
    const issue = only(issuesOf(base(type, {})), "field.empty");
    expect(issue.field).toBe(source);
    expect(issue.found).toContain(`answer computed from ${source}`);
    expect(issue.pl).toBe("answer: wymagane minimum 1");
  });
});

describe("found reguł typów", () => {
  it("focus.not_contiguous podaje tokeny odpowiedzi", () => {
    const issues = issuesOf(draft({
      exerciseType: "lesson_open_answer",
      prompt: "Co ona robi?",
      stem: undefined,
      hint: undefined,
      answer: "She plays tennis.",
      focus: ["tennis", "plays"],
    }));
    expect(only(issues, "focus.not_contiguous").found).toContain("she plays tennis");
  });

  it("order.items_join podaje złożony tekst i odpowiedź", () => {
    const issues = issuesOf(draft({
      exerciseType: "lesson_order",
      stem: undefined,
      hint: undefined,
      focus: [],
      items: [{ id: "1", text: "She" }, { id: "2", text: "plays" }, { id: "3", text: "tennis" }],
      answer: "She plays football",
    }));
    const found = only(issues, "order.items_join").found!;
    expect(found).toContain('"She plays tennis"');
    expect(found).toContain('"She plays football"');
  });

  it("options.correct_unknown podaje dozwolone id", () => {
    const issues = issuesOf(draft({
      exerciseType: "lesson_choice",
      hint: undefined,
      focus: [],
      options: [{ id: "a", text: "plays" }, { id: "b", text: "play" }],
      correctOption: "z",
    }));
    const issue = only(issues, "options.correct_unknown");
    expect(issue.field).toBe("correctOption");
    expect(issue.found).toContain('"z"');
    expect(issue.found).toContain("a, b");
  });

  it("gap.answer_tokens podaje liczbę słów i limit", () => {
    const issues = issuesOf(draft({ answer: "does not play now", focus: ["does not play now"], hint: undefined }));
    const found = only(issues, "gap.answer_tokens").found!;
    expect(found).toContain(`${MAX_GAP_ANSWER_TOKENS + 1} words`);
    expect(found).toContain(`limit ${MAX_GAP_ANSWER_TOKENS}`);
  });
});

describe("opakowanie dla rodzica", () => {
  it("validateLessonExercise to dokładnie komunikaty pl zgłoszeń", () => {
    const ex = draft({ focus: ["tennis"], acceptedAnswers: ["Plays"], visualSubject: "girl" });
    const issues = issuesOf(ex);
    expect(issues.length).toBeGreaterThan(1);
    expect(validateLessonExercise(ex, englishGrammarSubject, englishTopic)).toEqual(messagesOf(issues));
  });

  it("poprawne szkice przypadków reguł rdzenia nie mają zgłoszeń", () => {
    for (const baseline of CORE_CASE_BASELINES) {
      expect(baseline.issues(), baseline.name).toEqual([]);
    }
  });
});
