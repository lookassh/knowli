import { MAX_LESSON_ANSWER_LENGTH, MAX_LESSON_TEXT_LENGTH } from "@learning/contracts";
import type { LessonExerciseType, SubjectModule } from "../types";
import {
  describeRule,
  RULE_PRIORITY,
  type LessonRule,
  type RuleBookContext,
  type RuleCatalog,
  type RuleTextContext,
} from "./catalog";
import { CORE_RULES } from "./core-rules";
import { subjectFeatures, TYPE_CARDS } from "./type-cards";

/**
 * Księga reguł paczki przebiegu bazowego (spec katalogu reguł §3): karty typów i reguły
 * rdzenia i przedmiotu pasujące do typów dozwolonych w zagadnieniu i warunków `when`.
 * Adapter tylko ją renderuje. Czysta funkcja: ten sam wynik dla tego samego
 * wejścia (kolejność stała, bez zegara i losowości).
 *
 * Sekcje:
 * - `types` — blok każdego dozwolonego typu (karta typu, reguła typu przedmiotu i
 *   reguły, które w zagadnieniu dotyczą wyłącznie tego typu);
 * - `general` — reguły rdzenia i przedmiotu bez typów albo wspólne kilku typom
 *   zagadnienia (opis wtedy sam wymienia typy). Żaden opis się nie powtarza.
 *
 * W każdej sekcji najpierw reguły grup `RULE_PRIORITY` (w kolejności grup), potem
 * reszta po id. Reguły `internal` i reguły lekcji (`LESSON_RULES`; sprawdza je kod po paczce) nigdy nie
 * trafiają do księgi. Opis z dopiskiem przedmiotu (`SubjectModule.ruleNotes`).
 */

export interface RuleLine {
  readonly id: string;
  readonly text: string;
  /** Reguła z `promptBrief`: renderer promptu jej nie wymienia (za takie reguły jedno zdanie o schemacie wyjścia). */
  readonly brief?: true;
}

export interface TypeBlock {
  readonly type: LessonExerciseType;
  readonly summary: string;
  /** Przykład rekordu w JSON (z `objectiveId` zastępczym), gdy karta ma przykład dla cech przedmiotu. */
  readonly example?: string;
  /** Semantyka typu z profilu promptów przedmiotu (`prompts.typeRules`). */
  readonly subjectRule?: string;
  readonly rules: readonly RuleLine[];
}

export interface RuleBook {
  readonly general: readonly RuleLine[];
  readonly types: readonly TypeBlock[];
}

/** Zastępczy `objectiveId` przykładu karty: model wpisuje id swojego zagadnienia. */
export const EXAMPLE_OBJECTIVE_ID = "<objective id>";

/** Typ bez bloku: karta pochodzi z tematu, nie z puli. */
const CARD_TYPE: LessonExerciseType = "lesson_card";

/** Stała kolejność bloków typów: kolejność kart. */
const TYPE_ORDER = Object.keys(TYPE_CARDS) as LessonExerciseType[];

type Placement =
  | { readonly section: "general" }
  | { readonly section: "type"; readonly type: LessonExerciseType };

interface PlacedRule {
  readonly id: string;
  readonly rule: LessonRule;
  readonly placement: Placement;
}

/** Czy reguła trafia do księgi przy tych typach i kontekście. */
function matches(rule: LessonRule, allowed: readonly LessonExerciseType[], ctx: RuleBookContext): boolean {
  if (rule.kind === "internal") return false;
  if (rule.types !== undefined && !rule.types.some((type) => allowed.includes(type))) return false;
  return rule.when === undefined || rule.when(ctx);
}

/** Sekcja reguły: blok jedynego pasującego typu albo ogólne. */
function placementOf(rule: LessonRule, blockTypes: readonly LessonExerciseType[]): Placement {
  const matching = rule.types?.filter((type) => blockTypes.includes(type)) ?? [];
  return matching.length === 1 ? { section: "type", type: matching[0]! } : { section: "general" };
}

/** Pozycja grupy priorytetu; reguły bez grupy po wszystkich grupach. */
function priorityRank(rule: LessonRule): number {
  return rule.priority === undefined ? RULE_PRIORITY.length : RULE_PRIORITY.indexOf(rule.priority);
}

/** Kolejność w sekcji: grupa priorytetu, potem id (porównanie kodów znaków, niezależne od locale). */
function byPriorityThenId(a: PlacedRule, b: PlacedRule): number {
  const rank = priorityRank(a.rule) - priorityRank(b.rule);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Księga reguł przedmiotu dla zagadnienia o typach `ctx.exerciseTypes`. */
export function lessonRuleBook(subject: SubjectModule, ctx: RuleBookContext): RuleBook {
  const allowed = ctx.exerciseTypes.filter((type) => subject.exerciseTypes.includes(type));
  const blockTypes = TYPE_ORDER.filter((type) => type !== CARD_TYPE && allowed.includes(type));
  const notes = subject.ruleNotes ?? {};

  const placed: PlacedRule[] = [];
  const seen = new Set<string>();
  for (const catalog of [CORE_RULES, subject.rules] as readonly RuleCatalog[]) {
    for (const [id, rule] of Object.entries(catalog)) {
      if (seen.has(id) || !matches(rule, allowed, ctx)) continue;
      seen.add(id);
      placed.push({ id, rule, placement: placementOf(rule, blockTypes) });
    }
  }
  placed.sort(byPriorityThenId);

  const line = ({ id, rule }: PlacedRule): RuleLine => ({
    id,
    text: describeRule(rule, ctx.text, notes[id]),
    ...(rule.promptBrief === true ? { brief: true as const } : {}),
  });

  const types = blockTypes.map((type): TypeBlock => {
    const card = TYPE_CARDS[type];
    const example = typeExample(subject, ctx, type);
    const subjectRule = subject.prompts.typeRules?.[type]?.trim();
    return {
      type,
      summary: card.summary,
      ...(example === undefined ? {} : { example: exampleJson(example) }),
      ...(subjectRule === undefined || subjectRule === "" ? {} : { subjectRule }),
      rules: placed
        .filter((entry) => entry.placement.section === "type" && entry.placement.type === type)
        .map(line),
    };
  });

  return { general: placed.filter((entry) => entry.placement.section === "general").map(line), types };
}

/**
 * Przykład typu w zagadnieniu: przykład przedmiotu dla tematu i zagadnienia (`SubjectModule.typeExamples`),
 * a bez niego przykład karty typu dla cech przedmiotu. `undefined` — typ bez przykładu.
 */
export function typeExample(
  subject: SubjectModule,
  at: Pick<RuleBookContext, "topicId" | "objectiveId">,
  type: LessonExerciseType,
): Readonly<Record<string, unknown>> | undefined {
  const own = subject.typeExamples?.({ topicId: at.topicId, objectiveId: at.objectiveId })?.[type];
  return own ?? TYPE_CARDS[type].example?.(subjectFeatures(subject));
}

/**
 * Limity i flagi przedmiotu do tekstów opisów reguł — te same, którymi posługuje się walidacja:
 * odpowiedź przedmiotu z payloadem v3 ma limit kontraktu odpowiedzi, pozostałe limit tekstu.
 */
export function ruleTextContextOf(subject: Pick<SubjectModule, "usesV3Payload" | "sourceQuotes">): RuleTextContext {
  return {
    answerMaxLength: subject.usesV3Payload === true ? MAX_LESSON_ANSWER_LENGTH : MAX_LESSON_TEXT_LENGTH,
    groundingRequired: subject.sourceQuotes === true,
  };
}

/**
 * Pełny kontekst księgi reguł przedmiotu dla zagadnienia `objectiveId` tematu `topicId`: `exerciseTypes` — typy
 * dozwolone w zagadnieniu, `listenChoice` — czy `lesson_listen_choice` jest dostępny zagadnieniu (nie: czy
 * zostało miejsce w przydziale). Pozostałe pola pochodzą z przedmiotu.
 */
export function ruleBookContextFor(
  subject: SubjectModule,
  topicId: string,
  objectiveId: string,
  exerciseTypes: readonly LessonExerciseType[],
  listenChoice: boolean,
): RuleBookContext {
  return {
    topicId,
    objectiveId,
    exerciseTypes,
    text: ruleTextContextOf(subject),
    listenChoice,
    voiceTones: subject.ttsForPrompts === true,
    exerciseExplanations: subject.exerciseExplanations,
    usesV3Payload: subject.usesV3Payload === true,
    deduplication: subject.poolDeduplication ?? "answer",
  };
}

/** Przykład w JSON: `exerciseType`, zastępczy `objectiveId`, potem pola karty. */
function exampleJson(example: Readonly<Record<string, unknown>>): string {
  const { exerciseType, ...rest } = example;
  return JSON.stringify({ exerciseType, objectiveId: EXAMPLE_OBJECTIVE_ID, ...rest });
}
