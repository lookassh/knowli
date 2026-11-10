import { MAX_LESSON_ANSWER_LENGTH } from "@learning/contracts";
import { describe, expect, it } from "vitest";
import { MAX_TEXT_LENGTH } from "../pool-validation";
import { PRODUCTION_SUBJECTS } from "../subjects";
import type { LessonExerciseType, SubjectModule } from "../types";
import { describeRule, RULE_PRIORITY, type LessonRule, type RuleBookContext } from "./catalog";
import { CORE_RULES } from "./core-rules";
import { LESSON_RULES } from "./lesson-rules";
import { EXAMPLE_OBJECTIVE_ID, lessonRuleBook, typeExample, type RuleBook, type RuleLine } from "./rule-book";
import { TYPE_CARDS } from "./type-cards";

/**
 * Księga reguł paczki (spec katalogu reguł §3, §2.4 pkt 5): w księdze jest
 * dokładnie każda pasująca reguła `reject`/`sanitize` rdzenia i przedmiotu (typy zagadnienia i
 * warunki `when`), z dopiskiem przedmiotu, w kolejności `RULE_PRIORITY`, bez
 * reguł `internal`; wynik jest deterministyczny. Macierz: trzy przedmioty ×
 * każdy typ (i wszystkie typy naraz) × przydział `lesson_listen_choice` × ton lektora.
 */

interface Variant {
  readonly listenChoice: boolean;
  readonly voiceTones: boolean;
}

/** Tematy przedmiotu w macierzy: katalog (każdy temat) albo jeden temat dynamiczny. */
function topicIdsOf(subject: SubjectModule): readonly string[] {
  return subject.topics.length > 0 ? subject.topics.map((topic) => topic.id) : ["dynamic"];
}

function contextFor(
  subject: SubjectModule,
  exerciseTypes: readonly LessonExerciseType[],
  variant: Variant,
  topicId: string = topicIdsOf(subject)[0]!,
): RuleBookContext {
  const usesV3Payload = subject.usesV3Payload === true;
  // Pierwsze zagadnienie tematu katalogu (przykłady typów przedmiotu zależą od zagadnienia).
  const objectiveId = subject.topics.find((topic) => topic.id === topicId)?.objectives[0]?.id ?? `${topicId}.objective`;
  return {
    topicId,
    objectiveId,
    exerciseTypes,
    text: { answerMaxLength: usesV3Payload ? MAX_LESSON_ANSWER_LENGTH : MAX_TEXT_LENGTH, groundingRequired: subject.sourceQuotes === true },
    listenChoice: variant.listenChoice,
    voiceTones: variant.voiceTones,
    exerciseExplanations: subject.exerciseExplanations,
    usesV3Payload,
    deduplication: subject.poolDeduplication ?? "answer",
  };
}

/** Reguły księgi przedmiotu: rdzeń i katalog przedmiotu (reguły lekcji sprawdza kod, księga ich nie ma). */
function rulesOf(subject: SubjectModule): [string, LessonRule][] {
  return [CORE_RULES, subject.rules].flatMap((catalog) => Object.entries(catalog) as [string, LessonRule][]);
}

/** Wyrocznia: reguła pasuje, gdy nie jest `internal`, dotyczy typu zagadnienia i spełnia `when`. */
function expectedIds(subject: SubjectModule, ctx: RuleBookContext): string[] {
  return rulesOf(subject)
    .filter(([, rule]) => rule.kind !== "internal")
    .filter(([, rule]) => rule.types === undefined || rule.types.some((type) => ctx.exerciseTypes.includes(type)))
    .filter(([, rule]) => rule.when === undefined || rule.when(ctx))
    .map(([id]) => id);
}

function sections(book: RuleBook): (readonly RuleLine[])[] {
  return [book.general, ...book.types.map((block) => block.rules)];
}

function idsOf(book: RuleBook): string[] {
  return sections(book).flatMap((lines) => lines.map((line) => line.id));
}

const VARIANTS: readonly Variant[] = [
  { listenChoice: true, voiceTones: true },
  { listenChoice: true, voiceTones: false },
  { listenChoice: false, voiceTones: true },
  { listenChoice: false, voiceTones: false },
];

/** Konteksty macierzy: każdy typ przedmiotu osobno i wszystkie naraz, w każdym wariancie i temacie. */
function matrix(subject: SubjectModule): { readonly name: string; readonly ctx: RuleBookContext }[] {
  const typeSets: (readonly LessonExerciseType[])[] = [...subject.exerciseTypes.map((type) => [type]), subject.exerciseTypes];
  return topicIdsOf(subject).flatMap((topicId) =>
    typeSets.flatMap((types) =>
      VARIANTS.map((variant) => ({
        name: `${topicId} ${types.length === 1 ? types[0] : "all"} listen=${variant.listenChoice} tone=${variant.voiceTones}`,
        ctx: contextFor(subject, types, variant, topicId),
      })),
    ),
  );
}

const SUBJECTS = PRODUCTION_SUBJECTS.map((subject) => [subject.id, subject] as const);

describe.each(SUBJECTS)("księga reguł — %s", (_id, subject) => {
  const ruleById = new Map(rulesOf(subject));
  const internalIds = rulesOf(subject).filter(([, rule]) => rule.kind === "internal").map(([id]) => id);

  it("zawiera dokładnie pasujące reguły reject/sanitize, każdą raz, bez internal", () => {
    expect(internalIds.length).toBeGreaterThan(0);
    for (const { name, ctx } of matrix(subject)) {
      const ids = idsOf(lessonRuleBook(subject, ctx));
      expect(new Set(ids).size, name).toBe(ids.length);
      expect([...ids].sort(), name).toEqual(expectedIds(subject, ctx).sort());
      expect(ids.filter((id) => internalIds.includes(id)), name).toEqual([]);
      expect(ids.filter((id) => Object.hasOwn(LESSON_RULES, id)), name).toEqual([]);
    }
  });

  it("reguła typu niedozwolonego w zagadnieniu nie trafia do księgi", () => {
    for (const { name, ctx } of matrix(subject)) {
      for (const id of idsOf(lessonRuleBook(subject, ctx))) {
        const types = ruleById.get(id)!.types;
        if (types !== undefined) {
          expect(types.some((type) => ctx.exerciseTypes.includes(type)), `${name}: ${id}`).toBe(true);
        }
      }
    }
  });

  it("tekst reguły to opis z dopiskiem przedmiotu", () => {
    for (const { name, ctx } of matrix(subject)) {
      for (const line of sections(lessonRuleBook(subject, ctx)).flat()) {
        expect(line.text, `${name}: ${line.id}`).toBe(describeRule(ruleById.get(line.id)!, ctx.text, subject.ruleNotes?.[line.id]));
      }
    }
  });

  it("w każdej sekcji najpierw grupy RULE_PRIORITY w kolejności, potem reszta po id", () => {
    const rank = (id: string): number => {
      const priority = ruleById.get(id)!.priority;
      return priority === undefined ? RULE_PRIORITY.length : RULE_PRIORITY.indexOf(priority);
    };
    for (const { name, ctx } of matrix(subject)) {
      for (const lines of sections(lessonRuleBook(subject, ctx))) {
        const keys = lines.map((line) => [rank(line.id), line.id] as const);
        const sorted = [...keys].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        expect(keys, name).toEqual(sorted);
      }
    }
  });

  it("bloki typów: dozwolone typy przedmiotu bez karty, w kolejności kart, z opisem i przykładem", () => {
    const order = Object.keys(TYPE_CARDS);
    for (const { name, ctx } of matrix(subject)) {
      const book = lessonRuleBook(subject, ctx);
      const types = book.types.map((block) => block.type);
      expect(types, name).toEqual(order.filter((type) => type !== "lesson_card" && ctx.exerciseTypes.includes(type as LessonExerciseType)));
      for (const block of book.types) {
        expect(block.summary).toBe(TYPE_CARDS[block.type].summary);
        expect(JSON.parse(block.example!), `${name}: ${block.type}`).toMatchObject({ exerciseType: block.type, objectiveId: EXAMPLE_OBJECTIVE_ID });
        // Przykład przedmiotu dla zagadnienia ma pierwszeństwo przed przykładem karty.
        expect(JSON.parse(block.example!), `${name}: ${block.type}`)
          .toEqual({ ...typeExample(subject, ctx, block.type), objectiveId: EXAMPLE_OBJECTIVE_ID });
        // Reguła w bloku typu dotyczy wyłącznie tego typu spośród typów zagadnienia.
        for (const line of block.rules) {
          expect(ruleById.get(line.id)!.types!.filter((type) => types.includes(type)), `${name}: ${line.id}`).toEqual([block.type]);
        }
      }
    }
  });

  it("jest deterministyczna i nie zależy od kolejności typów zagadnienia", () => {
    for (const { name, ctx } of matrix(subject)) {
      const book = lessonRuleBook(subject, ctx);
      expect(lessonRuleBook(subject, ctx), name).toEqual(book);
      expect(lessonRuleBook(subject, { ...ctx, exerciseTypes: [...ctx.exerciseTypes].reverse() }), name).toEqual(book);
    }
  });

  it("reguła typu przedmiotu trafia do bloku typu", () => {
    const ctx = contextFor(subject, subject.exerciseTypes, VARIANTS[0]!);
    for (const block of lessonRuleBook(subject, ctx).types) {
      const rule = (subject.prompts.typeRules as Partial<Record<string, string>> | undefined)?.[block.type]?.trim();
      expect(block.subjectRule, block.type).toBe(rule === "" ? undefined : rule);
    }
  });
});

describe("księga reguł — przykłady kolejności", () => {
  const school = PRODUCTION_SUBJECTS.find((subject) => subject.usesV3Payload === true)!;
  const book = lessonRuleBook(school, contextFor(school, school.exerciseTypes, { listenChoice: false, voiceTones: true }));
  const block = (type: LessonExerciseType) => book.types.find((entry) => entry.type === type)!.rules.map((line) => line.id);

  it("pytanie otwarte zaczyna się od rodziny (szkoła bez podpowiedzi, etap 5b)", () => {
    expect(block("lesson_open_answer").slice(0, 3)).toEqual([
      "school.family_answer_differs",
      "school.family_elements_differ",
      "school.family_prompt_repeated",
    ]);
  });

  it("ogólne zaczynają się od braku podpowiedzi i cytatów, rachunek od kształtu rachunku", () => {
    expect(book.general.slice(0, 4).map((line) => line.id)).toEqual([
      "school.hint_open_answer_only",
      "school.quote_in_material",
      "school.quote_required",
      "school.quote_too_short",
    ]);
    expect(block("lesson_calculation").slice(0, 4)).toEqual([
      "calculation.family_slug",
      "calculation.params",
      "calculation.same_unit",
      "calculation.tolerance",
    ]);
  });
});

/**
 * Frazy kluczowe nowych opisów reguł (spec §3 „Nowe opisy reguł”): punkt → id
 * reguły → fraza, która musi być w linii reguły w księdze każdego przedmiotu,
 * którego księga ją zawiera (albo tylko wskazanych przedmiotów — dopiski).
 */
const KEY_PHRASES: readonly { readonly point: string; readonly rule: string; readonly phrase: string; readonly subjects?: readonly string[] }[] = [
  { point: "1. szkoła bez podpowiedzi (etap 5b)", rule: "school.hint_open_answer_only", phrase: "School exercises have no hint" },
  { point: "2. tolerancja rachunku", rule: "calculation.tolerance", phrase: "out or set it to zero" },
  { point: "3. rodzina rachunku", rule: "calculation.family_slug", phrase: "scale-distance-km" },
  { point: "4. pusty napis", rule: "field.empty", phrase: "does not apply is null" },
  { point: "5. pola pytania otwartego szkoły", rule: "school.open_required_fields", phrase: "non-empty questionType" },
  { point: "5. pola pytania otwartego szkoły", rule: "school.open_required_fields", phrase: "supplementaryElements (at most" },
  { point: "6. rodzina pytań", rule: "school.family_answer_differs", phrase: "character for character" },
  { point: "6. rodzina pytań", rule: "school.family_elements_differ", phrase: "the same set of requiredElements ids" },
  { point: "7. ciągły cytat", rule: "school.quote_in_material", phrase: "one continuous fragment" },
  { point: "7. ciągły cytat", rule: "school.quote_in_material", phrase: "never join two fragments" },
];

describe("frazy kluczowe nowych opisów reguł", () => {
  it.each(KEY_PHRASES)("$point: $rule zawiera „$phrase”", ({ rule, phrase, subjects }) => {
    const lines = PRODUCTION_SUBJECTS
      .filter((subject) => subjects === undefined || subjects.includes(subject.id))
      .flatMap((subject) => {
        const ctx = contextFor(subject, subject.exerciseTypes, { listenChoice: true, voiceTones: subject.ttsForPrompts });
        return sections(lessonRuleBook(subject, ctx)).flat().filter((line) => line.id === rule);
      });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.text).toContain(phrase);
    }
  });
});

describe("księga reguł — rozdział", () => {
  const chapter = PRODUCTION_SUBJECTS.find((subject) => subject.id === "english_chapter")!;
  const book = lessonRuleBook(chapter, contextFor(chapter, chapter.exerciseTypes, VARIANTS[0]!));

  it("zakaz polecenia w wyborze ze słuchu ma pełny opis (nie tylko id)", () => {
    const listen = book.types.find((block) => block.type === "lesson_listen_choice")!.rules.find((line) => line.id === "listen.instruction_not_allowed");
    expect(listen).toBeDefined();
    expect(listen!.brief).toBeUndefined();
  });
});
