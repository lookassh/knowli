import { z } from "zod";
import { clip, issueFrom, type LessonRuleIssue } from "./rules/catalog";
import { CORE_RULES } from "./rules/core-rules";

/**
 * Kształt surowego rekordu agenta puli (spec katalogu reguł §4.3): co walidacja
 * semantyczna dereferencuje, zanim rekord stanie się szkicem (`toExerciseDraft`).
 * Dwa sprawdzenia z jednej tabeli pól:
 * - `rawShapeIssues` — zgłoszenia `shape.*` z polem, oczekiwanym kształtem i
 *   otrzymanym typem dla ścieżki agenta, także dla pól v3, które
 *   `toExerciseDraft` po cichu filtruje;
 * - `hasLenientRawShape` — łagodny strażnik punktu kontrolnego z dzisiejszą
 *   semantyką (tylko pola z `guarded`).
 *
 * Pola nieobowiązkowe są `nullish`: structured outputs (json_schema strict)
 * zwraca każde pole schematu, z `null` dla nie dotyczących typu, więc `null`
 * znaczy brak pola. Czysta domena: nie rzuca dla dowolnego JSON.
 */

const shapeIssue = issueFrom(CORE_RULES);

type ShapeRuleId = Extract<keyof typeof CORE_RULES, `shape.${string}`>;

/** Kształt elementu listy: napis, lista napisów albo obiekt z polami-napisami (pola dodatkowe dozwolone). */
export type RawItemShape = "string" | "string_list" | readonly string[];

export interface RawListField {
  readonly field: string;
  readonly rule: ShapeRuleId;
  readonly item: RawItemShape;
  /** Pole sprawdza też łagodny strażnik (dzisiejszy schemat kształtu). */
  readonly guarded: boolean;
}

/** Pola listowe rekordu agenta; `guarded: false` — pola v3, które dziś filtruje `toExerciseDraft`. */
export const RAW_LIST_FIELDS: readonly RawListField[] = [
  { field: "acceptedAnswers", rule: "shape.accepted_answers", item: "string", guarded: true },
  { field: "focus", rule: "shape.focus", item: "string", guarded: true },
  { field: "options", rule: "shape.options", item: ["id", "text"], guarded: true },
  { field: "items", rule: "shape.items", item: ["id", "text"], guarded: true },
  { field: "keywordOptions", rule: "shape.keyword_options", item: ["id", "text"], guarded: true },
  { field: "keyOptionIds", rule: "shape.key_option_ids", item: "string", guarded: true },
  { field: "noticeSegments", rule: "shape.notice_segments", item: "string_list", guarded: true },
  { field: "pairs", rule: "shape.pairs", item: ["left", "right"], guarded: true },
  { field: "extraRight", rule: "shape.extra_right", item: "string", guarded: true },
  { field: "groups", rule: "shape.groups", item: ["id", "label"], guarded: true },
  { field: "groupItems", rule: "shape.group_items", item: ["text", "groupId"], guarded: true },
  { field: "gapAnswers", rule: "shape.gap_answers", item: "string", guarded: true },
  { field: "extraWords", rule: "shape.extra_words", item: "string", guarded: true },
  { field: "requiredElements", rule: "shape.required_elements", item: ["id", "text"], guarded: false },
  { field: "supplementaryElements", rule: "shape.supplementary_elements", item: "string", guarded: false },
  { field: "commonErrors", rule: "shape.common_errors", item: "string", guarded: false },
  { field: "sourceRefs", rule: "shape.source_refs", item: ["quote"], guarded: false },
];

/**
 * Pola tekstowe (napis albo `null`, reguła `shape.text_field`). Poza tabelą
 * celowo `explanationPl` i `voiceTone`: zły typ znaczy „brak pola” z notą
 * sanityzacji szkicu, nie odrzucenie całego ćwiczenia.
 */
export const RAW_TEXT_FIELDS: readonly { readonly field: string; readonly guarded: boolean }[] = [
  { field: "instructionPl", guarded: true },
  { field: "stem", guarded: true },
  { field: "statement", guarded: true },
  { field: "prompt", guarded: true },
  { field: "hint", guarded: true },
  { field: "transformId", guarded: true },
  { field: "correctOption", guarded: true },
  { field: "clozeText", guarded: true },
  { field: "questionType", guarded: false },
  { field: "expectedForm", guarded: false },
  { field: "familyId", guarded: false },
  { field: "visualSubject", guarded: false },
];

/** Rodzaj otrzymanej wartości do `found` (bez treści). */
function kindOf(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  switch (typeof value) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return `a ${typeof value}`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function itemText(item: RawItemShape): string {
  if (item === "string") return "a string";
  if (item === "string_list") return "a list of strings";
  return `{${item.join(", ")}}`;
}

/** Liczba mnoga kształtu elementu (`a list of …`). */
function itemsText(item: RawItemShape): string {
  if (item === "string") return "strings";
  if (item === "string_list") return "lists of strings";
  return itemText(item);
}

function itemTextPl(item: RawItemShape): string {
  if (item === "string") return "listy napisów";
  if (item === "string_list") return "listy list napisów";
  return `listy obiektów {${item.join(", ")}}`;
}

/** Pierwszy problem elementu listy: ścieżka względem elementu i co nie pasuje; `null` = poprawny. */
function itemProblem(value: unknown, item: RawItemShape): { readonly path: string; readonly found: string } | null {
  if (item === "string") {
    return typeof value === "string" ? null : { path: "", found: `expected a string, got ${kindOf(value)}` };
  }
  if (item === "string_list") {
    if (!Array.isArray(value)) return { path: "", found: `expected a list of strings, got ${kindOf(value)}` };
    const index = value.findIndex((entry) => typeof entry !== "string");
    return index < 0 ? null : { path: `[${index}]`, found: `expected a string, got ${kindOf(value[index])}` };
  }
  if (!isObject(value)) return { path: "", found: `expected ${itemText(item)}, got ${kindOf(value)}` };
  const key = item.find((name) => typeof value[name] !== "string");
  return key === undefined ? null : { path: `.${key}`, found: `expected a string, got ${kindOf(value[key])}` };
}

/** Zgłoszenia jednego pola listowego (najwyżej jedno: pierwszy zły element); nieznane pole → []. */
export function listFieldIssues(record: Readonly<Record<string, unknown>>, field: string): LessonRuleIssue[] {
  const entry = RAW_LIST_FIELDS.find((candidate) => candidate.field === field);
  const value = record[field];
  if (entry === undefined || value === null || value === undefined) return [];
  const pl = `${field}: oczekiwano ${itemTextPl(entry.item)}`;
  if (!Array.isArray(value)) {
    return [shapeIssue(entry.rule, {
      field,
      pl,
      found: `${field}: expected a list of ${itemsText(entry.item)} or null, got ${kindOf(value)}`,
    })];
  }
  for (const [index, element] of value.entries()) {
    const problem = itemProblem(element, entry.item);
    if (problem !== null) {
      const path = `${field}[${index}]${problem.path}`;
      return [shapeIssue(entry.rule, { field: path, pl, found: `${path}: ${problem.found}` })];
    }
  }
  return [];
}

/** Zgłoszenie pola tekstowego, które nie jest napisem ani `null`. */
export function textFieldIssues(record: Readonly<Record<string, unknown>>, field: string): LessonRuleIssue[] {
  const value = record[field];
  if (value === null || value === undefined || typeof value === "string") return [];
  return [shapeIssue("shape.text_field", {
    field,
    pl: `${field}: pole tekstowe musi być napisem`,
    found: `${field}: expected a string or null, got ${kindOf(value)}`,
  })];
}

/** Zgłoszenia `shape.record`: rekord nie jest obiektem albo `exerciseType`/`objectiveId` nie są napisami. */
export function rawRecordIssues(raw: unknown): LessonRuleIssue[] {
  if (!isObject(raw)) {
    return [shapeIssue("shape.record", {
      pl: "ćwiczenie: rekord nie jest obiektem",
      found: `the exercise is ${kindOf(raw)}, not an object`,
    })];
  }
  return (["exerciseType", "objectiveId"] as const).flatMap((field) =>
    typeof raw[field] === "string"
      ? []
      : [shapeIssue("shape.record", {
        field,
        pl: `${field}: wymagany napis`,
        found: `${field}: expected a string, got ${kindOf(raw[field])}`,
      })],
  );
}

/**
 * Zgłoszenia kształtu rekordu agenta (po materializacji): `shape.record`, potem
 * `answer`, pola tekstowe, listy (`RAW_LIST_FIELDS`) i `calculation`. Pusta lista =
 * `toExerciseDraft` niczego nie zgubi po cichu; treść sprawdza walidacja ćwiczenia.
 */
export function rawShapeIssues(raw: unknown): LessonRuleIssue[] {
  const recordIssues = rawRecordIssues(raw);
  if (!isObject(raw)) return recordIssues;
  const issues = [...recordIssues];
  if (typeof raw.answer !== "string") {
    issues.push(shapeIssue("shape.answer", {
      pl: "answer: odpowiedź musi być napisem",
      found: `answer: expected a string, got ${kindOf(raw.answer)}`,
    }));
  }
  for (const { field } of RAW_TEXT_FIELDS) issues.push(...textFieldIssues(raw, field));
  for (const { field } of RAW_LIST_FIELDS) issues.push(...listFieldIssues(raw, field));
  const calculation = raw.calculation;
  if (calculation !== null && calculation !== undefined && !isObject(calculation)) {
    issues.push(shapeIssue("shape.calculation", {
      pl: "calculation: oczekiwano obiektu specyfikacji obliczenia",
      found: `calculation: expected an object {kind, unit, params, templateFamilyId}, got ${kindOf(calculation)}`,
    }));
  }
  return issues;
}

/** Zgłoszenie ćwiczenia innego zagadnienia niż to, nad którym pracuje podagent. */
export function foreignObjectiveIssues(objectiveId: string, expected: string): LessonRuleIssue[] {
  if (objectiveId === expected) return [];
  return [shapeIssue("shape.objective_id", {
    pl: "objectiveId: ćwiczenie innego zagadnienia",
    found: `objectiveId must be "${expected}" (this objective), not ${clip(objectiveId)}`,
  })];
}

function itemSchema(item: RawItemShape): z.ZodType {
  if (item === "string") return z.string();
  if (item === "string_list") return z.array(z.string());
  return z.object(Object.fromEntries(item.map((key) => [key, z.string()]))).passthrough();
}

/**
 * Dzisiejszy schemat KSZTAŁTU surowego ćwiczenia (nie semantyki), z tej samej
 * tabeli: wymagane napisy `exerciseType`, `objectiveId` i `answer`, pola
 * tekstowe i listy z `guarded`. Chroni walidację semantyczną przed rekordami,
 * których tablice mają zły typ elementów (np. `options=[null,{…}]`), bez
 * wywracania całego runu (wymóg 2.5). `passthrough` — pól dodatkowych nie odrzuca.
 */
const rawExerciseShapeSchema = z
  .object({
    exerciseType: z.string(),
    objectiveId: z.string(),
    answer: z.string(),
    ...Object.fromEntries(RAW_TEXT_FIELDS.filter((entry) => entry.guarded).map((entry) => [entry.field, z.string().nullish()])),
    ...Object.fromEntries(
      RAW_LIST_FIELDS.filter((entry) => entry.guarded).map((entry) => [entry.field, z.array(itemSchema(entry.item)).nullish()]),
    ),
  })
  .passthrough();

/**
 * Łagodny strażnik kształtu (punkt kontrolny agenta i ścieżki bez zgłoszeń):
 * dzisiejsza semantyka — pól v3 spoza `guarded` nie sprawdza.
 */
export function hasLenientRawShape(raw: unknown): boolean {
  return isObject(raw) && rawExerciseShapeSchema.safeParse(raw).success;
}
