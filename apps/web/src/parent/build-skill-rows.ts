import { REPORT_SKILLS, type ProgressDto, type ReportSkill } from "@learning/contracts";

export interface SkillRowSegments {
  mastered: number;
  needsConfirmation: number;
  practicing: number;
  notAssessed: number;
}

export interface SkillRow {
  skill: ReportSkill;
  total: number;
  known: number;
  segments: SkillRowSegments;
}

/**
 * Wiersze karty „Opanowanie" liczone per pozycja: „znane" to opanowane lub
 * seria do potwierdzenia bez zmiany znaczenia (reguła dotychczasowa);
 * needs_reconfirmation wizualnie wraca do bursztynu „do potwierdzenia".
 */
export function buildSkillRows(progress: ProgressDto): SkillRow[] {
  return REPORT_SKILLS.map((skill) => {
    let mastered = 0;
    let needsConfirmation = 0;
    let practicing = 0;
    let notAssessed = 0;
    let known = 0;
    for (const item of progress.items) {
      const status = item.skills[skill];
      if (status === "mastered") {
        mastered += 1;
        known += 1;
      } else if (status === "needs_confirmation" || status === "needs_reconfirmation") {
        needsConfirmation += 1;
        if (status === "needs_confirmation" && !item.meaningChanged) {
          known += 1;
        }
      } else if (status === "practicing") {
        practicing += 1;
      } else {
        notAssessed += 1;
      }
    }
    return {
      skill,
      total: progress.items.length,
      known,
      segments: { mastered, needsConfirmation, practicing, notAssessed },
    };
  });
}
