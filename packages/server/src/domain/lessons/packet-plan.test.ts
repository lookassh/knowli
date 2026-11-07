import { describe, expect, it } from "vitest";
import { PACKET_RESERVE, packetPlan, packetPlanForTargets } from "./packet-plan";
import { stageOf } from "./stages";
import { englishGrammarSubject } from "./subjects/english-grammar/module";

const objective = (slug: string) => {
  const found = englishGrammarSubject.topics.flatMap((topic) => topic.objectives).find((item) => item.id.endsWith(`.${slug}`));
  if (found === undefined) throw new Error(slug);
  return found;
};

describe("packetPlan", () => {
  it("splits stage targets over the objective's types and adds the packet reserve", () => {
    const plan = packetPlan(englishGrammarSubject, objective("present_continuous.affirmative"), { guided: 4, productive: 6, independent: 2 }, 2);
    expect(plan.caps).toEqual({ guided: 4, productive: 6, independent: 3, intro: 2, listen: 2 });
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
    expect(plan.caps).toEqual({ guided: 3, productive: 4, independent: 3, intro: 2, listen: 0 });
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
    expect(plan.caps).toEqual({ guided: 0, productive: 2, independent: 1, intro: 0, listen: 1 });
    expect(plan.packets).toEqual([
      { type: "lesson_gap", share: 1, count: 4 },
      { type: "lesson_error_fix", share: 1, count: 4 },
      { type: "lesson_open_answer", share: 1, count: 4 },
      { type: "lesson_listen_choice", share: 1, count: 1 },
    ]);
  });
});
