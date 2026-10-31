import { messages } from "@learning/contracts";
import { clozeAnswer } from "../domain/lessons/cloze";
import { groupAnswer, matchAnswer } from "../domain/lessons/pool-validation";

function isObjectWith(value: unknown, fields: readonly string[]): boolean {
  return value !== null && typeof value === "object" &&
    fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
}

/** Ton lektora z surowego rekordu modelu; `null` i brak pola nie trafiają do wyniku (sanityzacja w szkicu). */
const voiceToneOf = (record: Record<string, unknown>): { voiceTone?: string } =>
  typeof record.voiceTone === "string" ? { voiceTone: record.voiceTone } : {};

/**
 * Cytaty z modelu: przedmiot bez cytatów dostaje w trybie strict `null`, co
 * oznacza brak pola (nie wartość `null` w ćwiczeniu).
 */
function quotesOf(record: Record<string, unknown>): { sourceRefs?: unknown } {
  return record.sourceRefs === null || record.sourceRefs === undefined ? {} : { sourceRefs: record.sourceRefs };
}

/**
 * Pary, grupy (design szkoły §10.6) i luki z bankiem (§13.6) z modelu niosą
 * tylko teksty i przypisania.
 * Kod dopisuje polecenie (gdy model go nie podał) i kanoniczną odpowiedź,
 * zanim rekord trafi do wspólnej walidacji kształtu i puli.
 */
export function materializeGeneratedAssignments(exercises: unknown[]): unknown[] {
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const record = raw as Record<string, unknown>;
    const instruction = (fallback: string) =>
      typeof record.instructionPl === "string" && record.instructionPl.trim() !== "" ? record.instructionPl : fallback;
    if (record.exerciseType === "lesson_match") {
      const pairs = Array.isArray(record.pairs) ? record.pairs : [];
      const extraRight = Array.isArray(record.extraRight) ? record.extraRight : [];
      // Rekord o złym kształcie zostaje odrzucony przez walidację kształtu (bez odpowiedzi).
      if (!pairs.every((pair) => isObjectWith(pair, ["left", "right"])) || !extraRight.every((text) => typeof text === "string")) {
        return { ...record, answer: undefined };
      }
      const typedPairs = pairs as { left: string; right: string }[];
      return {
        exerciseType: "lesson_match",
        objectiveId: record.objectiveId,
        instructionPl: instruction(messages.kid.lessonMatchInstruction),
        pairs: typedPairs.map((pair) => ({ left: pair.left, right: pair.right })),
        extraRight,
        answer: matchAnswer({ pairs: typedPairs }),
        acceptedAnswers: [],
        focus: [],
        ...quotesOf(record),
        ...voiceToneOf(record),
      };
    }
    if (record.exerciseType === "lesson_group") {
      const groups = Array.isArray(record.groups) ? record.groups : [];
      const groupItems = Array.isArray(record.groupItems) ? record.groupItems : [];
      if (!groups.every((group) => isObjectWith(group, ["id", "label"])) || !groupItems.every((item) => isObjectWith(item, ["text", "groupId"]))) {
        return { ...record, answer: undefined };
      }
      const typedGroups = groups as { id: string; label: string }[];
      return {
        exerciseType: "lesson_group",
        objectiveId: record.objectiveId,
        instructionPl: instruction(messages.kid.lessonGroupInstruction),
        groups: typedGroups.map((group) => ({ id: group.id, label: group.label })),
        groupItems: (groupItems as { text: string; groupId: string }[]).map((item) => ({ text: item.text, groupId: item.groupId })),
        answer: groupAnswer({ groups: typedGroups }),
        acceptedAnswers: [],
        focus: [],
        ...quotesOf(record),
        ...voiceToneOf(record),
      };
    }
    if (record.exerciseType === "lesson_cloze") {
      const gapAnswers = Array.isArray(record.gapAnswers) ? record.gapAnswers : [];
      const extraWords = Array.isArray(record.extraWords) ? record.extraWords : [];
      if (typeof record.clozeText !== "string" || ![...gapAnswers, ...extraWords].every((text) => typeof text === "string")) {
        return { ...record, answer: undefined };
      }
      return {
        exerciseType: "lesson_cloze",
        objectiveId: record.objectiveId,
        instructionPl: instruction(messages.kid.lessonClozeInstruction),
        clozeText: record.clozeText,
        gapAnswers,
        extraWords,
        answer: clozeAnswer({ gapAnswers: gapAnswers as string[] }),
        acceptedAnswers: [],
        focus: [],
        ...quotesOf(record),
        ...voiceToneOf(record),
      };
    }
    return raw;
  });
}
