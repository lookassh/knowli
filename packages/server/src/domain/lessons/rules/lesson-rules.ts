import type { RuleCatalog } from "./catalog";

/**
 * Katalog reguł lekcji (spec katalogu reguł §2.2): reguły całej puli
 * (`validatePoolIssues`) i ujawnienia odpowiedzi (`agent/admission.ts`, krok
 * reguł lekcji walidacji puli). Przedmiot dopisuje do opisów własne zdania przez
 * `SubjectAgentPolicy.ruleNotes`.
 *
 * Bez importu wartości z `./catalog` (cykl przez `ENGINE_CATALOGS`): katalog
 * deklaruje się przez `satisfies RuleCatalog`, a id sprawdza `defineRules`
 * przy składaniu `ENGINE_CATALOGS`.
 */
export const LESSON_RULES = {
  // Reguły całej puli (`validatePoolIssues`).
  "lesson.listen_reveals_answer": {
    field: "stem",
    kind: "reject",
    when: (ctx) => ctx.listenChoice,
    types: ["lesson_listen_choice", "lesson_open_answer", "lesson_transform", "lesson_error_fix"],
    description:
      "The full sentence of a lesson_listen_choice (the correct option in the gap) is never the answer or an accepted " +
      "variant of a lesson_open_answer, lesson_transform or lesson_error_fix in the lesson, because hearing it would give " +
      "that answer away.",
  },
  // Reguły duplikatów wykluczają się trybem przedmiotu (`validatePoolIssues`).
  "lesson.duplicate_stimulus": {
    field: "exercise",
    kind: "reject",
    when: (ctx) => ctx.deduplication === "exercise",
    description:
      "Within one objective no two exercises of the same type repeat the stimulus (question, sentence, statement, items, " +
      "pairs or text); vary the content, not only the answer.",
  },
  "lesson.duplicate_answer": {
    field: "answer",
    kind: "reject",
    when: (ctx) => ctx.deduplication === "answer",
    description: "No two exercises of the lesson have answers that are equivalent after normalization.",
  },
  // Ujawnienia rozwiązań (tryb `generation`: równoważność po normalizatorze przedmiotu, także warianty).
  "lesson.leak": {
    field: "answer",
    kind: "reject",
    description:
      "The answer of an independent exercise (and each accepted variant) must not appear earlier in the lesson: it differs " +
      "from the answer and sentence of every guided or productive exercise, from every card example and from earlier " +
      "independent answers. Questions of one open-question family may share their model answer.",
  },
  "lesson.leak_source": {
    field: "answer",
    kind: "reject",
    description:
      "An exercise must not show the answer of a later independent exercise of this or another objective (also one " +
      "already in the lesson): its answer and full sentence differ from it.",
  },
} as const satisfies RuleCatalog;
