import { describe, expect, it } from "vitest";
import { lessonPoolMinimums } from "./lesson-coverage";
import { bucketOf, INDEPENDENT_RESERVE, KEYWORDS_PER_OBJECTIVE, PACKET_RESERVE, packetPlan, packetPlanForTargets } from "./packet-plan";
import { stageOf } from "./stages";
import { englishGrammarSubject } from "./subjects/english-grammar/module";
import { SCHOOL_EXERCISE_TYPES, schoolSubject } from "./subjects/school/module";
import type { LearningObjective } from "./types";

const objective = (slug: string) => {
  const found = englishGrammarSubject.topics.flatMap((topic) => topic.objectives).find((item) => item.id.endsWith(`.${slug}`));
  if (found === undefined) throw new Error(slug);
  return found;
};

describe("packetPlan", () => {
  it("splits stage targets over the objective's types and adds the packet reserve", () => {
    const plan = packetPlan(englishGrammarSubject, objective("present_continuous.affirmative"), { guided: 4, productive: 6, independent: 2 }, 2);
    expect(plan.caps).toEqual({ guided: 4, productive: 6, independent: 3, intro: 2, listen: 2, keywords: 0 });
    expect(plan.packets).toEqual([
      { type: "lesson_notice", share: 2, count: 2 },
      { type: "lesson_choice", share: 2, count: 5 },
      { type: "lesson_order", share: 2, count: 5 },
      { type: "lesson_gap", share: 3, count: 6 },
      { type: "lesson_error_fix", share: 3, count: 6 },
      { type: "lesson_open_answer", share: 3, count: 6 },
      { type: "lesson_listen_choice", share: 2, count: 2 },
    ]);
  });

  it("raises small splits to the publication minimum with the independent reserve", () => {
    const plan = packetPlan(englishGrammarSubject, objective("present_continuous.affirmative"), { guided: 1, productive: 1, independent: 1 }, 0);
    expect(plan.caps).toEqual({ guided: 3, productive: 4, independent: 3, intro: 2, listen: 0, keywords: 0 });
    expect(INDEPENDENT_RESERVE).toBe(1);
    expect(plan.caps.independent).toBe(lessonPoolMinimums(englishGrammarSubject).independent + INDEPENDENT_RESERVE);
    expect(plan.packets.some((packet) => packet.type === "lesson_listen_choice")).toBe(false);
  });

  it("gives every grammar objective a packet in each assessed stage that sums to the target", () => {
    for (const topic of englishGrammarSubject.topics) {
      for (const item of topic.objectives) {
        const plan = packetPlan(englishGrammarSubject, item, { guided: 4, productive: 5, independent: 3 }, 2);
        for (const stage of ["guided", "productive", "independent"] as const) {
          const packets = plan.packets.filter((packet) => packet.type !== "lesson_listen_choice" && stageOf(packet.type) === stage);
          expect(packets.length, `${item.id} ${stage}`).toBeGreaterThan(0);
          expect(packets.reduce((sum, packet) => sum + packet.share, 0), `${item.id} ${stage}`).toBe(plan.caps[stage]);
          expect(packets.every((packet) => packet.count === packet.share + PACKET_RESERVE)).toBe(true);
        }
        expect(plan.packets.some((packet) => packet.type === "lesson_card")).toBe(false);
      }
    }
  });

  it("builds add-mode packets from the given targets: no packets for a zero stage and no notice", () => {
    expect(PACKET_RESERVE).toBe(3);
    const plan = packetPlanForTargets(objective("present_continuous.affirmative"), { guided: 0, productive: 2, independent: 1 }, false, 1);
    expect(plan.caps).toEqual({ guided: 0, productive: 2, independent: 1, intro: 0, listen: 1, keywords: 0 });
    expect(plan.packets).toEqual([
      { type: "lesson_gap", share: 1, count: 4 },
      { type: "lesson_error_fix", share: 1, count: 4 },
      { type: "lesson_open_answer", share: 1, count: 4 },
      { type: "lesson_listen_choice", share: 1, count: 1 },
    ]);
    // Cel etapu mniejszy niż liczba typów: typ bez udziału nie zamawia samego zapasu.
    const one = packetPlanForTargets(objective("present_continuous.affirmative"), { guided: 1, productive: 0, independent: 0 }, false, 0);
    expect(one.packets).toEqual([{ type: "lesson_choice", share: 1, count: 4 }]);
  });
});

describe("keywords companion (stage 5b, variant A)", () => {
  const school = { id: "school.d1.o1", titlePl: "Woda", descriptionEn: "Water.", cards: [], errorCategories: [], hints: {}, exerciseTypes: [...SCHOOL_EXERCISE_TYPES] } as unknown as LearningObjective;

  it("the open answer packet carries the keywords companion and keywords have no packet of their own", () => {
    const plan = packetPlan(schoolSubject, school, { guided: 4, productive: 3, independent: 3 }, 0);
    const open = plan.packets.find((packet) => packet.type === "lesson_open_answer");
    expect(open?.companion).toBe("lesson_keywords");
    expect(plan.packets.some((packet) => packet.type === "lesson_keywords")).toBe(false);
    expect(plan.packets.filter((packet) => packet.companion !== undefined)).toHaveLength(1);
    expect(plan.caps.keywords).toBe(KEYWORDS_PER_OBJECTIVE);
  });

  it("no companion without the keywords type or in the add plan", () => {
    const grammar = packetPlan(englishGrammarSubject, objective("present_continuous.affirmative"), { guided: 4, productive: 6, independent: 2 }, 0);
    expect(grammar.caps.keywords).toBe(0);
    expect(grammar.packets.some((packet) => packet.companion !== undefined)).toBe(false);
    const add = packetPlanForTargets(school, { guided: 0, productive: 0, independent: 2 }, false, 0);
    expect(add.packets.some((packet) => packet.companion !== undefined)).toBe(false);
    expect(add.caps.keywords).toBe(0);
  });

  it("the open answer packet also orders the calculation share (calculations stay empty when the material teaches no method)", () => {
    const plan = packetPlan(schoolSubject, school, { guided: 4, productive: 4, independent: 4 }, 0);
    const open = plan.packets.find((packet) => packet.type === "lesson_open_answer")!;
    const calc = plan.packets.find((packet) => packet.type === "lesson_calculation")!;
    expect([open.share, calc.share]).toEqual([2, 2]);
    expect(open.count).toBe(open.share + calc.share + PACKET_RESERVE);
    expect(calc.count).toBe(calc.share + PACKET_RESERVE);
    // Limit etapu bez zmian: nadmiar pytań otwartych odpada przy przyjęciu, gdy rachunki zajmą swój udział.
    expect(plan.caps.independent).toBe(4);
  });

  it("keywords have their own bucket", () => {
    expect(bucketOf("lesson_keywords")).toBe("keywords");
    expect(bucketOf("lesson_listen_choice")).toBe("listen");
  });
});
