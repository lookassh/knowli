import { describe, expect, it } from "vitest";
import type { ProgressDto, ProgressItemDto, ReportSkill } from "@learning/contracts";
import { buildSkillRows } from "./build-skill-rows";

function item(
  itemId: string,
  skills: Partial<Record<ReportSkill, ProgressItemDto["skills"][ReportSkill]>>,
  meaningChanged = false,
): ProgressItemDto {
  return {
    itemId,
    position: 0,
    source: "słowo",
    target: "word",
    meaningChanged,
    skills: {
      listening: "not_assessed",
      reading: "not_assessed",
      recall: "not_assessed",
      pronunciation: "not_assessed",
      spelling: "not_assessed",
      ...skills,
    },
  };
}

function progressWith(items: ProgressItemDto[]): ProgressDto {
  return {
    childId: "00000000-0000-4000-8000-000000000001",
    childName: "Ala",
    deckId: "00000000-0000-4000-8000-000000000002",
    deckTitle: "Zestaw",
    testDate: null,
    totalItems: items.length,
    skills: [],
    confusions: [],
    history: [],
    pronunciation: { assessed: false, latestScores: [] },
    activity: {
      days: 7, activeSeconds: 0, activeDays: 0, sessions: 0, answers: 0, interactions: 0, decks: [], daily: [],
    },
    items,
  };
}

describe("buildSkillRows", () => {
  it("liczy segmenty per umiejętność; suma segmentów równa totalowi", () => {
    const rows = buildSkillRows(progressWith([
      item("a", { listening: "mastered", spelling: "practicing" }),
      item("b", { listening: "needs_confirmation", spelling: "practicing" }),
      item("c", { listening: "not_assessed", spelling: "mastered" }),
    ]));
    const listening = rows.find((row) => row.skill === "listening")!;
    expect(listening).toMatchObject({ total: 3, known: 2, segments: { mastered: 1, needsConfirmation: 1, practicing: 0, notAssessed: 1 } });
    const spelling = rows.find((row) => row.skill === "spelling")!;
    expect(spelling).toMatchObject({ total: 3, known: 1, segments: { mastered: 1, needsConfirmation: 0, practicing: 2, notAssessed: 0 } });
    for (const row of rows) {
      expect(row.segments.mastered + row.segments.needsConfirmation + row.segments.practicing + row.segments.notAssessed).toBe(row.total);
    }
  });

  it("needs_confirmation po zmianie znaczenia nie wchodzi do znanych", () => {
    const rows = buildSkillRows(progressWith([
      item("a", { listening: "needs_confirmation" }, true),
      item("b", { listening: "needs_confirmation" }, false),
    ]));
    expect(rows.find((row) => row.skill === "listening")).toMatchObject({ known: 1 });
  });

  it("needs_reconfirmation liczy się jako bursztynowy segment do potwierdzenia", () => {
    const rows = buildSkillRows(progressWith([item("a", { recall: "needs_reconfirmation" })]));
    expect(rows.find((row) => row.skill === "recall")).toMatchObject({
      known: 0,
      segments: { mastered: 0, needsConfirmation: 1, practicing: 0, notAssessed: 0 },
    });
  });

  it("zachowuje kolejność REPORT_SKILLS i puste słowa dają 0/0 bez NaN", () => {
    const rows = buildSkillRows(progressWith([]));
    expect(rows.map((row) => row.skill)).toEqual(["listening", "reading", "recall", "pronunciation", "spelling"]);
    for (const row of rows) {
      expect(row.total).toBe(0);
      expect(row.known).toBe(0);
      expect(row.segments).toEqual({ mastered: 0, needsConfirmation: 0, practicing: 0, notAssessed: 0 });
    }
  });
});
