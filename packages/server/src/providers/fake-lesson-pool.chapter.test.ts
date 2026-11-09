import { describe, expect, it } from "vitest";
import { closedCheckItems, closedCheckVerdict } from "../domain/lessons/closed-check";
import { validateLessonExerciseIssues } from "../domain/lessons/pool-validation";
import { englishChapterSubject } from "../domain/lessons/subjects/english-chapter/module";
import { packetInput } from "../modules/materials/lessons/lesson-baseline-pool";
import { parseLessonRecord } from "../modules/materials/lessons/lesson-pool-agent-tools";
import { fakeClosedAnswer, fakePacketExercises } from "./fake-lesson-pool";

/** Fake paczek rozdziału (etap 5a #362): każdy typ rozdziału przechodzi strukturę i kontrolę fake'a. */

const subject = englishChapterSubject;
const topic = subject.buildDynamicTopic!({
  titlePl: "Ubrania",
  objectives: [
    { id: "english_chapter.dx.clothes", titlePl: "Ubrania", descriptionEn: "Clothes.", kind: "words", cards: [{ title: "Słowa", body: "coat — płaszcz" }, { title: "Więcej", body: "hat — kapelusz" }] },
    { id: "english_chapter.dx.wearing", titlePl: "Noszę", descriptionEn: "I'm wearing …", kind: "frame", cards: [{ title: "Rama", body: "I'm wearing (a) …" }, { title: "Przykład", body: "I'm wearing a coat." }] },
  ],
});
const material = "Słowa:\ncoat — płaszcz\nhat — kapelusz\nZwroty:\nI'm wearing (a) …";

describe("fakePacketExercises for the chapter", () => {
  for (const objective of topic.objectives) {
    for (const type of objective.exerciseTypes.filter((entry) => entry !== "lesson_card")) {
      it(`${objective.id.split(".").at(-1)} × ${type}: structure and closed check pass`, () => {
        const input = packetInput({ subject, topic, objective, type, count: 2, withExamples: false, material, avoidSentences: [], timeoutMs: 1000 });
        const { exercises } = fakePacketExercises(input, 100);
        expect(exercises).toHaveLength(2);
        for (const raw of exercises) {
          const parsed = parseLessonRecord(raw, objective.id, subject, null);
          if (!parsed.ok) throw new Error(`${type}: ${parsed.rejection.code} ${parsed.rejection.ruleIds.join(",")}`);
          const draft = subject.sanitize?.(parsed.draft, { material }).draft ?? parsed.draft;
          expect(validateLessonExerciseIssues(draft, subject, topic, { agent: true }).map((issue) => issue.rule)).toEqual([]);
          const views = closedCheckItems(draft, topic);
          if (views === null) continue;
          const results = views.map((view) =>
            type === "lesson_order" ? { verdict: "yes" } : { answers: fakeClosedAnswer(view) },
          );
          expect(closedCheckVerdict(draft, results, subject.normalizer)).toEqual({ pass: true });
        }
      });
    }
  }
});
