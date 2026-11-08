import { schoolAgentPolicy } from "../subjects/school/agent-policy";
import { schoolSubject } from "../subjects/school/module";
import type { SubjectModule } from "../types";

/**
 * Szkoła na agencie puli z kontrolami 2b (sędzia podpowiedzi, kontrola otwarta) — wyłącznie testy
 * mechaniki agenta i jego kontroli do etapu 5c (#362), który usuwa agenta. Produkcja generuje szkołę
 * przebiegiem bazowym bez podpowiedzi (etap 5b); tu podpowiedź pytania otwartego zostaje, żeby
 * kontrole 2b miały co sprawdzać, a pozostałe oczyszczenie jest jak w produkcji.
 */
const subject: SubjectModule = (({ baselinePool: _baseline, ...rest }) => ({
  ...rest,
  agentPolicy: {
    ...schoolAgentPolicy,
    hintJudgeTypes: ["lesson_open_answer"],
    openAnswerCheckTypes: ["lesson_open_answer"],
    ruleNotes: {
      ...schoolAgentPolicy.ruleNotes,
      "check.hint_judge":
        "Unsupported: use only facts from the material; not correct Polish: fix the wording; gives the content away: " +
        "hint at the reasoning, not the content; if it cannot be fixed, set it to null.",
      "check.open_answer": "The solvers see the material and the grader checks both answers against it.",
    },
    sanitize(draft, ctx) {
      const keep = draft.exerciseType === "lesson_open_answer" ? draft.hint : undefined;
      const result = schoolAgentPolicy.sanitize!(draft, ctx);
      if (keep === undefined) return result;
      return {
        ...result,
        draft: { ...result.draft, hint: keep },
        removed: result.removed.filter((field) => field !== "hint"),
        notes: (result.notes ?? []).filter((note) => note.field !== "hint"),
      };
    },
  },
}))(schoolSubject);

export const agentSchoolSubject = subject;
export const agentSchoolPolicy = subject.agentPolicy;
