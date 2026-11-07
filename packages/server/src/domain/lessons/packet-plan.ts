import { lessonPoolMinimums } from "./lesson-coverage";
import { outsideStagePath, stageOf } from "./stages";
import type { LearningObjective, LessonExerciseType, SubjectModule } from "./types";

/**
 * Plan paczek przebiegu bazowego (spec etapu 2 §3.1): jedna paczka = jedno zagadnienie i jeden
 * typ ćwiczenia. Cel etapu to większe z podziału agenta (`poolStageCounts` z `targetCount`) i
 * minimum publikacji (independent z rezerwą przedmiotu); cel dzielony po równo na dozwolone typy
 * etapu, każda paczka etapu z zapasem. Czysta funkcja: podział i dodatek słuchowy liczy wołający.
 */

/** Zapas paczki: ćwiczeń ponad udział, bo odrzucone ćwiczenia odpadają bez rundy naprawy (pokrętło strojenia). */
export const PACKET_RESERVE = 2;

/** Ćwiczeń `lesson_notice` (intro, poza minimum publikacji) na zagadnienie. */
const NOTICE_PER_OBJECTIVE = 2;

export interface StageCounts {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

export interface PacketPlan {
  readonly packets: readonly { readonly type: LessonExerciseType; readonly count: number }[];
  /** Najwięcej przyjętych ćwiczeń etapu po przycięciu. */
  readonly stageTargets: StageCounts;
}

const STAGES = ["guided", "productive", "independent"] as const;

export function packetPlan(subject: SubjectModule, objective: LearningObjective, stageSplit: StageCounts, listenAllowance: number): PacketPlan {
  const minimums = lessonPoolMinimums(subject);
  const stageTargets: StageCounts = {
    guided: Math.max(stageSplit.guided, minimums.guided),
    productive: Math.max(stageSplit.productive, minimums.productive),
    independent: Math.max(stageSplit.independent, minimums.independent + subject.agentPolicy.independentReserve),
  };
  const types = objective.exerciseTypes;
  const packets: { type: LessonExerciseType; count: number }[] = [];
  if (types.includes("lesson_notice")) packets.push({ type: "lesson_notice", count: NOTICE_PER_OBJECTIVE });
  for (const stage of STAGES) {
    const stageTypes = types.filter((type) => !outsideStagePath(type) && stageOf(type) === stage);
    const target = stageTargets[stage];
    stageTypes.forEach((type, index) => {
      // Reszta podziału do wcześniejszych typów (kolejność katalogu zagadnienia).
      const share = Math.floor(target / stageTypes.length) + (index < target % stageTypes.length ? 1 : 0);
      packets.push({ type, count: share + PACKET_RESERVE });
    });
  }
  if (listenAllowance > 0 && types.includes("lesson_listen_choice")) packets.push({ type: "lesson_listen_choice", count: listenAllowance });
  return { packets, stageTargets };
}
