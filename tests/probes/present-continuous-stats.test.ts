import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presentContinuousV1 } from "../../packages/server/src/domain/lessons/subjects/english-grammar/topics/present-continuous";
import { presentSimpleV1 } from "../../packages/server/src/domain/lessons/subjects/english-grammar/topics/present-simple";
import type { LessonExerciseDraft, LessonTopic } from "../../packages/server/src/domain/lessons/types";
import { resolveOutsideRepoPath } from "./probe-helpers";
import { pcPoolStats, type PcDumpRejection } from "./present-continuous-stats";

const PC = "english_grammar.present_continuous";
const NOW_OR_USUALLY = `${PC}.now_or_usually`;
const AFFIRMATIVE = `${PC}.affirmative`;

function draft(overrides: Partial<LessonExerciseDraft> & Pick<LessonExerciseDraft, "exerciseType" | "objectiveId">): LessonExerciseDraft {
  return { answer: "x", acceptedAnswers: [], focus: [], ...overrides };
}

describe("pcPoolStats", () => {
  const exercises: LessonExerciseDraft[] = [
    draft({ exerciseType: "lesson_card", objectiveId: NOW_OR_USUALLY, instructionPl: "Cicho! Posłuchaj." }),
    draft({ exerciseType: "lesson_gap", objectiveId: NOW_OR_USUALLY, instructionPl: "Cicho! Tom śpi. Uzupełnij zdanie.", stem: "Tom ___ (sleep)." }),
    draft({ exerciseType: "lesson_gap", objectiveId: NOW_OR_USUALLY, instructionPl: "Uzupełnij zdanie.", stem: "Dad ___ (cook) every day." }),
    draft({ exerciseType: "lesson_gap", objectiveId: AFFIRMATIVE, instructionPl: "Cicho!", stem: "Tom ___ (sleep)." }),
  ];
  const rejections: PcDumpRejection[] = [
    { objectiveId: NOW_OR_USUALLY, kind: "rule", ruleIds: ["grammar.pc_tense_marker_missing", "grammar.pc_verb_outside_table", "grammar.pc_tense_marker_missing"] },
    // Ofiara ujawnienia: `detail` zaczyna się od „adding this exercise would make…”, a id reguły jest tylko w `ruleIds`.
    { objectiveId: AFFIRMATIVE, kind: "leak", ruleIds: ["lesson.leak_source"] },
    { objectiveId: AFFIRMATIVE, kind: "rule", ruleIds: [] },
  ];

  it("liczy scenki i odrzucenia tylko w celach porównania, a id reguł według rodzaju odrzucenia", () => {
    const stats = pcPoolStats(exercises, rejections);
    expect(stats.sceneShare).toBe(0.5);
    expect(stats.comparisonAccepted).toBe(2);
    expect(stats.comparisonRejected).toBe(1);
    expect(stats.rejectionShareComparison).toBeCloseTo(1 / 3);
    expect(stats.ruleIdsByKind).toEqual({
      rule: { "grammar.pc_tense_marker_missing": 2, "grammar.pc_verb_outside_table": 1, other: 1 },
      leak: { "lesson.leak_source": 1 },
    });
  });

  it("w open_answer scenkę bierze z prompt, a cel more też jest celem porównania", () => {
    const stats = pcPoolStats(
      [
        draft({ exerciseType: "lesson_open_answer", objectiveId: `${PC}.now_or_usually_more`, instructionPl: "Przetłumacz.", prompt: "Patrz! Mama gotuje obiad." }),
        draft({ exerciseType: "lesson_open_answer", objectiveId: `${PC}.now_or_usually_more`, instructionPl: "Cicho! Przetłumacz.", prompt: "Tata gotuje obiad." }),
      ],
      [],
    );
    expect(stats.comparisonAccepted).toBe(2);
    expect(stats.sceneShare).toBe(0.5);
    expect(stats.rejectionShareComparison).toBe(0);
  });

  it("pusta pula daje zera bez dzielenia przez zero", () => {
    const stats = pcPoolStats([], []);
    expect(stats).toEqual({ sceneShare: 0, comparisonAccepted: 0, comparisonRejected: 0, rejectionShareComparison: 0, ruleIdsByKind: {} });
  });
});

describe("zrzuty zagadnień sondy", () => {
  const cases: readonly [string, LessonTopic][] = [
    ["present-continuous-objectives.json", presentContinuousV1],
    ["present-simple-objectives.json", presentSimpleV1],
  ];
  const material = cases.map(([file]) => (JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")) as { material: string }).material);

  it.each(cases)("%s ma kształt wejścia sondy i zgadza się z katalogiem", (file, topic) => {
    const dump = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")) as Record<string, unknown>;
    expect(dump).toMatchObject({ subjectId: "english_grammar", topicId: topic.id, topicVersion: topic.version, topicTitle: topic.titlePl });
    expect(typeof dump.material).toBe("string");
    expect(dump.objectives).toEqual(topic.objectives.map((objective) => ({ id: objective.id, title: objective.titlePl, descriptionEn: objective.descriptionEn, cards: [] })));
  });

  it("oba zrzuty mają ten sam materiał", () => {
    expect(material[0]).toBe(material[1]);
    expect(material[0]!.length).toBeGreaterThan(100);
  });
});

// Statystyki prawdziwego zrzutu sondy (`UMIEM_PROBE_AGENT_DUMP`); drukuje same liczby, bez treści ćwiczeń.
describe("zrzut puli sondy", () => {
  it.runIf(process.env.UMIEM_PC_STATS_DUMP !== undefined && process.env.UMIEM_PC_STATS_DUMP.trim() !== "")("drukuje pcPoolStats", () => {
    const path = resolveOutsideRepoPath(process.env.UMIEM_PC_STATS_DUMP, "UMIEM_PC_STATS_DUMP")!;
    const dump = JSON.parse(readFileSync(path, "utf8")) as { exercises?: LessonExerciseDraft[]; rejections?: PcDumpRejection[] };
    expect(Array.isArray(dump.exercises) && Array.isArray(dump.rejections)).toBe(true);
    const stats = pcPoolStats(dump.exercises!, dump.rejections!);
    console.log(
      JSON.stringify(
        { exercises: dump.exercises!.length, rejections: dump.rejections!.length, ...stats, sceneShare: Number(stats.sceneShare.toFixed(3)), rejectionShareComparison: Number(stats.rejectionShareComparison.toFixed(3)) },
        null,
        2,
      ),
    );
  });
});
