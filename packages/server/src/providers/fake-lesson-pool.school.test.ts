import { describe, expect, it } from "vitest";
import { closedCheckItems, closedCheckVerdict } from "../domain/lessons/closed-check";
import { validateLessonExerciseIssues } from "../domain/lessons/pool-validation";
import { schoolSubject } from "../domain/lessons/subjects/school/module";
import type { LessonExerciseDraft } from "../domain/lessons/types";
import { packetInput } from "../modules/materials/lessons/lesson-baseline-pool";
import { parseLessonRecord } from "../modules/materials/lessons/lesson-pool-agent-tools";
import { fakeClosedAnswer, fakePacketExercises } from "./fake-lesson-pool";

/** Fake paczek szkoły (etap 5b): pytania otwarte z keywords tej samej rodziny przechodzą strukturę, rodziny i kontrolę fake'a. */

const subject = schoolSubject;
const topic = subject.buildDynamicTopic!({
  titlePl: "Rośliny",
  objectives: [{ id: "school.dx.plants", titlePl: "Części rośliny", descriptionEn: "Plant parts.", cards: [{ title: "Pojęcia", body: "korzeń — pobiera wodę" }] }],
});
const material = "Korzeń pobiera wodę z gleby. Łodyga przewodzi wodę do liści. Liście wytwarzają pokarm. Kwiat wytwarza nasiona.";

describe("fakePacketExercises for school", () => {
  it("open-answer packet with the keywords companion passes structure, families and the closed check", () => {
    const objective = topic.objectives[0]!;
    const input = packetInput({ subject, topic, objective, type: "lesson_open_answer", companion: "lesson_keywords", count: 2, withExamples: false, material, graderAvailable: true, avoidSentences: [], timeoutMs: 1000 });
    const { exercises } = fakePacketExercises(input, 100);
    const drafts: LessonExerciseDraft[] = exercises.map((raw) => {
      const parsed = parseLessonRecord(raw, objective.id, subject, null);
      if (!parsed.ok) throw new Error(`${String(raw.exerciseType)}: ${parsed.rejection.code} ${parsed.rejection.ruleIds.join(",")}`);
      const draft = subject.sanitize?.(parsed.draft, { material }).draft ?? parsed.draft;
      expect(validateLessonExerciseIssues(draft, subject, topic, { agent: true }).map((issue) => issue.rule)).toEqual([]);
      return draft;
    });
    expect(drafts.map((draft) => draft.exerciseType)).toEqual(["lesson_open_answer", "lesson_open_answer", "lesson_keywords"]);
    expect([...subject.validatePoolExtra!(drafts, { material }).values()].flat().map((issue) => issue.rule)).toEqual([]);
    const keywords = drafts[2]!;
    const views = closedCheckItems(keywords, topic, drafts[0]!.prompt);
    expect(views).toHaveLength(1);
    expect(closedCheckVerdict(keywords, views!.map((view) => ({ answers: fakeClosedAnswer(view) })), subject.normalizer)).toEqual({ pass: true });
  });
});
