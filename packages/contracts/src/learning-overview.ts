import { z } from "zod";
import { DaySchema, InstantSchema, UuidSchema } from "./common";
import { REPORT_SKILLS } from "./progress";

export const LearningOverviewQuerySchema = z.strictObject({
  days: z.number().int().min(1).max(31).default(7),
  upcomingTestDays: z.number().int().min(1).max(90).default(14),
  childId: UuidSchema.optional(),
});
export type LearningOverviewQuery = z.infer<typeof LearningOverviewQuerySchema>;

export const LearningTimeDefinitionSchema = z.strictObject({
  method: z.literal("activity_intervals_v1"),
  maxGapSeconds: z.literal(120),
});

export const LearningTimeDtoSchema = z.strictObject({
  seconds: z.number().int().nonnegative().nullable(),
  estimated: z.literal(true),
});
export type LearningTimeDto = z.infer<typeof LearningTimeDtoSchema>;

const DatePeriodSchema = z.strictObject({
  from: DaySchema,
  to: DaySchema,
  days: z.number().int().min(1).max(90),
});

const AssessmentCountsSchema = z.strictObject({
  skill: z.enum(REPORT_SKILLS),
  independentCorrect: z.number().int().nonnegative(),
  correctNotIndependent: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  unassessed: z.number().int().nonnegative(),
});

const ActivityDeckSchema = z.strictObject({
  deckId: UuidSchema,
  deckVersionId: UuidSchema,
  deckTitle: z.string(),
  deckVersionNumber: z.number().int().positive(),
  assessmentCounts: z.array(AssessmentCountsSchema),
});

const MockTestSkillSchema = z.strictObject({
  skill: z.enum(REPORT_SKILLS),
  totalItems: z.number().int().nonnegative(),
  independentCorrect: z.number().int().nonnegative(),
  practiceNeeded: z.number().int().nonnegative(),
  correctNotIndependent: z.number().int().nonnegative(),
  notTested: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unassessed: z.number().int().nonnegative(),
});

const MockTestSchema = z.strictObject({
  sessionId: UuidSchema,
  deckId: UuidSchema,
  deckVersionId: UuidSchema,
  deckTitle: z.string(),
  deckVersionNumber: z.number().int().positive(),
  endedAt: InstantSchema,
  complete: z.boolean(),
  taskBudget: z.number().int().positive(),
  skills: z.array(MockTestSkillSchema),
});

const DailyActivitySchema = z.strictObject({
  date: DaySchema,
  learningTime: LearningTimeDtoSchema,
  isPartialDay: z.boolean(),
  hasRecordedActivity: z.boolean(),
  sessionsWithActivity: z.number().int().nonnegative(),
  submittedAttempts: z.number().int().nonnegative(),
  pendingAttempts: z.number().int().nonnegative(),
  decks: z.array(ActivityDeckSchema),
  mockTests: z.array(MockTestSchema),
});

const ProgressSkillSchema = z.strictObject({
  skill: z.enum(REPORT_SKILLS),
  mastered: z.number().int().nonnegative(),
  needsConfirmation: z.number().int().nonnegative(),
  needsReconfirmation: z.number().int().nonnegative(),
  practicing: z.number().int().nonnegative(),
  notAssessed: z.number().int().nonnegative(),
});

const PracticeItemSchema = z.strictObject({
  itemId: UuidSchema,
  source: z.string(),
  target: z.string(),
  skills: z.array(z.enum(REPORT_SKILLS)).min(1),
  lastDifficultyDate: DaySchema,
});

const CurrentProgressSchema = z.strictObject({
  deckId: UuidSchema,
  deckVersionId: UuidSchema,
  deckTitle: z.string(),
  deckVersionNumber: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  skills: z.array(ProgressSkillSchema),
  practiceItems: z.array(PracticeItemSchema).max(5),
  practiceItemsTruncated: z.boolean(),
});

const PlannedTestSchema = z.strictObject({
  assignmentId: UuidSchema,
  deckId: UuidSchema,
  deckTitle: z.string(),
  date: DaySchema,
  daysUntil: z.number().int().nonnegative(),
  goals: z.array(z.enum(["recall", "spelling", "listening"])),
  source: z.literal("umiem_assignment"),
});

const ChildOverviewSchema = z.strictObject({
  childId: UuidSchema,
  childName: z.string(),
  learningTime: LearningTimeDtoSchema,
  dailyActivity: z.array(DailyActivitySchema),
  currentProgress: z.array(CurrentProgressSchema),
  plannedTests: z.array(PlannedTestSchema),
});

const uniqueBy = <T>(values: readonly T[], key: (value: T) => string): boolean =>
  new Set(values.map(key)).size === values.length;

const isSequentialDateList = (dates: readonly string[]): boolean =>
  dates.every((date, index) => {
    if (index === 0) return true;
    const previous = Date.parse(`${dates[index - 1]}T00:00:00.000Z`);
    const expected = new Date(previous + 86_400_000).toISOString().slice(0, 10);
    return date === expected;
  });

function periodIsValid(period: z.infer<typeof DatePeriodSchema>): boolean {
  const from = Date.parse(`${period.from}T00:00:00.000Z`);
  const to = Date.parse(`${period.to}T00:00:00.000Z`);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from &&
    Math.round((to - from) / 86_400_000) + 1 === period.days;
}

export const LearningOverviewDtoSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    learningTimeDefinition: LearningTimeDefinitionSchema,
    generatedAt: InstantSchema,
    timezone: z.string().min(1),
    period: DatePeriodSchema,
    plannedTestsPeriod: DatePeriodSchema,
    children: z.array(ChildOverviewSchema),
  })
  .superRefine((overview, ctx) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: overview.timezone });
    } catch {
      ctx.addIssue({ code: "custom", path: ["timezone"], message: "Invalid IANA timezone" });
    }

    if (!periodIsValid(overview.period)) {
      ctx.addIssue({ code: "custom", path: ["period"], message: "Period bounds do not match days" });
    }
    if (!periodIsValid(overview.plannedTestsPeriod)) {
      ctx.addIssue({ code: "custom", path: ["plannedTestsPeriod"], message: "Planned test bounds do not match days" });
    }

    const dates = overview.children[0]?.dailyActivity.map(({ date }) => date) ?? [];
    if (overview.children.length > 0 && (dates.length !== overview.period.days || dates[0] !== overview.period.from ||
      dates.at(-1) !== overview.period.to || !isSequentialDateList(dates))) {
      ctx.addIssue({ code: "custom", path: ["children"], message: "Daily activity must cover every period date" });
    }
    if (!uniqueBy(overview.children, ({ childId }) => childId)) {
      ctx.addIssue({ code: "custom", path: ["children"], message: "Child identifiers must be unique" });
    }

    for (const [childIndex, child] of overview.children.entries()) {
      const childDates = child.dailyActivity.map(({ date }) => date);
      if (childDates.length !== overview.period.days ||
        childDates.some((date, index) => date !== dates[index])) {
        ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity"], message: "Daily activity must match the report period" });
      }
      if (child.dailyActivity.some((day, index) => day.isPartialDay !== (index === child.dailyActivity.length - 1))) {
        ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity"], message: "Only the current final day may be partial" });
      }
      for (const [dayIndex, day] of child.dailyActivity.entries()) {
        if (!day.hasRecordedActivity && day.learningTime.seconds !== 0) {
          ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity", dayIndex, "learningTime"], message: "A day without recorded activity must have zero seconds" });
        }
        if (!uniqueBy(day.decks, ({ deckId }) => deckId)) {
          ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity", dayIndex, "decks"], message: "Decks must be unique within a day" });
        }
        for (const [deckIndex, deck] of day.decks.entries()) {
          if (!uniqueBy(deck.assessmentCounts, ({ skill }) => skill)) {
            ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity", dayIndex, "decks", deckIndex, "assessmentCounts"], message: "Assessment skills must be unique" });
          }
        }
        for (const [testIndex, test] of day.mockTests.entries()) {
          if (!uniqueBy(test.skills, ({ skill }) => skill) || test.skills.some((skill) =>
            skill.independentCorrect + skill.practiceNeeded + skill.correctNotIndependent + skill.notTested + skill.skipped + skill.unassessed !== skill.totalItems)) {
            ctx.addIssue({ code: "custom", path: ["children", childIndex, "dailyActivity", dayIndex, "mockTests", testIndex, "skills"], message: "Mock test counts must cover each skill denominator exactly" });
          }
        }
      }

      const daySeconds = child.dailyActivity.map(({ learningTime }) => learningTime.seconds);
      const expectedTotal = daySeconds.some((seconds) => seconds === null)
        ? null
        : (daySeconds as number[]).reduce((sum, seconds) => sum + seconds, 0);
      if (child.learningTime.seconds !== expectedTotal) {
        ctx.addIssue({ code: "custom", path: ["children", childIndex, "learningTime"], message: "Period learning time must match daily totals" });
      }

      for (const [progressIndex, deck] of child.currentProgress.entries()) {
        if (!uniqueBy(deck.skills, ({ skill }) => skill) ||
          deck.skills.length !== REPORT_SKILLS.length || deck.skills.some((skill) =>
            skill.mastered + skill.needsConfirmation + skill.needsReconfirmation + skill.practicing + skill.notAssessed !== deck.totalItems)) {
          ctx.addIssue({ code: "custom", path: ["children", childIndex, "currentProgress", progressIndex, "skills"], message: "Progress skills must cover the current deck denominator exactly" });
        }
      }
      if (!uniqueBy(child.plannedTests, ({ assignmentId }) => assignmentId)) {
        ctx.addIssue({ code: "custom", path: ["children", childIndex, "plannedTests"], message: "Assignment identifiers must be unique" });
      }
    }
  });

export type LearningOverviewDto = z.infer<typeof LearningOverviewDtoSchema>;

/** JSON Schema is the portable structural contract; cross-field invariants stay in this Zod schema. */
export function exportLearningOverviewJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(LearningOverviewDtoSchema, { target: "draft-2020-12" });
}
