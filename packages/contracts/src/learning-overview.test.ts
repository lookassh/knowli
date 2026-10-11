import { describe, expect, it } from "vitest";
import sample from "../../../docs/superpowers/specs/2026-10-11-hermes-learning-overview.example.json";
import { LearningOverviewDtoSchema, LearningOverviewQuerySchema } from "./learning-overview";

type MutableOverview = { [key: string]: any };
const cloneSample = (): MutableOverview => JSON.parse(JSON.stringify(sample)) as MutableOverview;

describe("LearningOverviewQuerySchema", () => {
  it("defaults the requested period and rejects values outside the public contract", () => {
    expect(LearningOverviewQuerySchema.parse({})).toEqual({ days: 7, upcomingTestDays: 14 });
    expect(LearningOverviewQuerySchema.parse({ days: 3, upcomingTestDays: 30 })).toEqual({
      days: 3,
      upcomingTestDays: 30,
    });

    for (const days of [0, 32, 1.5, null, true, "7"]) {
      expect(LearningOverviewQuerySchema.safeParse({ days }).success).toBe(false);
    }
    for (const upcomingTestDays of [0, 91, 1.5, null, true]) {
      expect(LearningOverviewQuerySchema.safeParse({ upcomingTestDays }).success).toBe(false);
    }
    expect(
      LearningOverviewQuerySchema.safeParse({ childId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      LearningOverviewQuerySchema.safeParse({ days: 7, surprise: "ignored?" }).success,
    ).toBe(false);
  });
});

describe("LearningOverviewDtoSchema", () => {
  it("accepts the complete synthetic API example, including estimated study time", () => {
    expect(LearningOverviewDtoSchema.parse(sample)).toEqual(sample);
  });

  it("allows a family with no child profiles and a scheduled test without selected goals", () => {
    const emptyFamily = cloneSample();
    emptyFamily.children = [];
    expect(LearningOverviewDtoSchema.safeParse(emptyFamily).success).toBe(true);

    const testWithoutGoals = cloneSample();
    testWithoutGoals.children[0].plannedTests[0].goals = [];
    expect(LearningOverviewDtoSchema.safeParse(testWithoutGoals).success).toBe(true);
  });

  it("requires day coverage, unique skills, and complete progress denominators", () => {
    const missingDay = cloneSample();
    missingDay.children[0].dailyActivity.pop();
    expect(LearningOverviewDtoSchema.safeParse(missingDay).success).toBe(false);

    const duplicateSkill = cloneSample();
    duplicateSkill.children[0].currentProgress[0].skills.push(
      duplicateSkill.children[0].currentProgress[0].skills[0],
    );
    expect(LearningOverviewDtoSchema.safeParse(duplicateSkill).success).toBe(false);

    const incompleteProgress = cloneSample();
    incompleteProgress.children[0].currentProgress[0].skills[0].notAssessed -= 1;
    expect(LearningOverviewDtoSchema.safeParse(incompleteProgress).success).toBe(false);

    const extraField = cloneSample();
    extraField.secret = "answer key";
    expect(LearningOverviewDtoSchema.safeParse(extraField).success).toBe(false);
  });

  it("enforces daily and period study-time semantics", () => {
    const accepted = cloneSample();
    expect(LearningOverviewDtoSchema.safeParse(accepted).success).toBe(true);

    const negativeSeconds = cloneSample();
    negativeSeconds.children[0].dailyActivity[0].learningTime.seconds = -1;
    expect(LearningOverviewDtoSchema.safeParse(negativeSeconds).success).toBe(false);

    const fractionalSeconds = cloneSample();
    fractionalSeconds.children[0].dailyActivity[0].learningTime.seconds = 1.5;
    expect(LearningOverviewDtoSchema.safeParse(fractionalSeconds).success).toBe(false);

    const notEstimated = cloneSample();
    notEstimated.children[0].dailyActivity[0].learningTime.estimated = false;
    expect(LearningOverviewDtoSchema.safeParse(notEstimated).success).toBe(false);

    const missingDefinition = cloneSample();
    delete missingDefinition.learningTimeDefinition;
    expect(LearningOverviewDtoSchema.safeParse(missingDefinition).success).toBe(false);

    const wrongGap = cloneSample();
    wrongGap.learningTimeDefinition.maxGapSeconds = 121;
    expect(LearningOverviewDtoSchema.safeParse(wrongGap).success).toBe(false);

    const wrongTotal = cloneSample();
    wrongTotal.children[0].learningTime.seconds = 1;
    expect(LearningOverviewDtoSchema.safeParse(wrongTotal).success).toBe(false);

    const uncertainDay = cloneSample();
    uncertainDay.children[0].dailyActivity[0].learningTime.seconds = null;
    uncertainDay.children[0].learningTime.seconds = null;
    expect(LearningOverviewDtoSchema.safeParse(uncertainDay).success).toBe(true);

    const emptyDayCannotBeUnknown = cloneSample();
    emptyDayCannotBeUnknown.children[0].dailyActivity[1].learningTime.seconds = null;
    expect(LearningOverviewDtoSchema.safeParse(emptyDayCannotBeUnknown).success).toBe(false);
  });
});
