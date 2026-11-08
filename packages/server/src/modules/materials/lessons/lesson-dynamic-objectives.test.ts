import { describe, expect, it } from "vitest";
import { englishChapterSubject } from "../../../domain/lessons/subjects/english-chapter/module";
import { schoolSubject } from "../../../domain/lessons/subjects/school/module";
import type { LessonObjectivesInput, LlmProvider } from "../../../ports/ai";
import { generateDynamicObjectives, type LessonRunInput } from "./lesson-drafts";
import type { LessonGenerationControl } from "./lesson-generation-control";

/** Etap zagadnień jednym wywołaniem (spec etapu 5 §4.1): rozdział wymaga rodzaju, szkoła bez zmian. */

const control: LessonGenerationControl = {
  assertCurrent: async () => undefined,
  call: (request) => request(new AbortController().signal),
  run: (work) => work(new AbortController().signal),
  deadlineAtMs: Number.MAX_SAFE_INTEGER,
};

const cards = [{ title: "Słowa", body: "coat — płaszcz" }, { title: "Więcej", body: "hat — kapelusz" }];

function llmReturning(objectives: unknown[]): { llm: LlmProvider; requests: LessonObjectivesInput[] } {
  const requests: LessonObjectivesInput[] = [];
  const llm = {
    generateLessonObjectives: async (input: LessonObjectivesInput) => {
      requests.push(input);
      return { objectives };
    },
  } as unknown as LlmProvider;
  return { llm, requests };
}

const input = { deckId: "deck1", material: "coat — płaszcz", topicTitlePl: "Ubrania" } as LessonRunInput;

describe("generateDynamicObjectives", () => {
  it("chapter: sends the subject rules and drops an objective without a valid kind", async () => {
    const { llm, requests } = llmReturning([
      { slug: "clothes", titlePl: "Ubrania", descriptionEn: "Clothes.", kind: null, cards },
      { slug: "wear", titlePl: "Noszę", descriptionEn: "I'm wearing ...", kind: "frame", cards },
    ]);
    const stage = await generateDynamicObjectives(llm, control, englishChapterSubject, input);
    expect(requests[0]!.objectivesRules).toBe(englishChapterSubject.prompts.objectivesRules);
    expect(stage.data.objectives.map((objective) => [objective.titlePl, objective.kind])).toEqual([["Noszę", "frame"]]);
    expect(stage.droppedObjectiveCount).toBe(1);
  });

  it("school: no subject rules, objectives without kind", async () => {
    const { llm, requests } = llmReturning([{ slug: "water", titlePl: "Obieg wody", descriptionEn: "Water cycle.", cards: [...cards, { title: "C", body: "x" }] }]);
    const stage = await generateDynamicObjectives(llm, control, schoolSubject, input);
    expect(requests[0]!.objectivesRules).toBeUndefined();
    expect(stage.data.objectives).toHaveLength(1);
    expect(stage.data.objectives[0]).not.toHaveProperty("kind");
  });
});
