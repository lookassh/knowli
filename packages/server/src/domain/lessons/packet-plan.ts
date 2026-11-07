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
export const PACKET_RESERVE = 3;

/** Ćwiczeń `lesson_notice` (intro, poza minimum publikacji) na zagadnienie. */
const NOTICE_PER_OBJECTIVE = 2;

export interface StageCounts {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

/** Limit przyjęcia per „kubełek”: etap oceniany, `lesson_notice` (intro) albo słuchanie (poza ścieżką etapów). */
export type PacketBucket = keyof StageCounts | "intro" | "listen";

export interface PacketPlan {
  /** `share` — udział paczki w limicie kubełka (przyjmowany najpierw), `count` — zamówienie z zapasem. */
  readonly packets: readonly { readonly type: LessonExerciseType; readonly share: number; readonly count: number }[];
  readonly caps: Readonly<Record<PacketBucket, number>>;
}

const STAGES = ["guided", "productive", "independent"] as const;

export function bucketOf(type: LessonExerciseType): PacketBucket {
  return outsideStagePath(type) ? "listen" : (stageOf(type) as PacketBucket);
}

export function packetPlan(subject: SubjectModule, objective: LearningObjective, stageSplit: StageCounts, listenAllowance: number): PacketPlan {
  const minimums = lessonPoolMinimums(subject);
  const targets: StageCounts = {
    guided: Math.max(stageSplit.guided, minimums.guided),
    productive: Math.max(stageSplit.productive, minimums.productive),
    independent: Math.max(stageSplit.independent, minimums.independent + subject.agentPolicy.independentReserve),
  };
  return packetPlanForTargets(objective, targets, objective.exerciseTypes.includes("lesson_notice"), listenAllowance);
}

/**
 * Paczki z gotowych celów etapów (pula: z {@link packetPlan}; „dodaj N”: braki etapów + N bez podnoszenia
 * do minimum). Etap z celem 0 nie ma paczek; słuchanie tylko, gdy cel dopuszcza typ.
 */
export function packetPlanForTargets(objective: LearningObjective, targets: StageCounts, withNotice: boolean, listenAllowance: number): PacketPlan {
  const types = objective.exerciseTypes;
  const notice = withNotice ? NOTICE_PER_OBJECTIVE : 0;
  const listen = types.includes("lesson_listen_choice") ? listenAllowance : 0;
  const packets: { type: LessonExerciseType; share: number; count: number }[] = [];
  if (notice > 0) packets.push({ type: "lesson_notice", share: notice, count: notice });
  for (const stage of STAGES) {
    if (targets[stage] === 0) continue;
    const stageTypes = types.filter((type) => !outsideStagePath(type) && stageOf(type) === stage);
    stageTypes.forEach((type, index) => {
      // Reszta podziału do wcześniejszych typów (kolejność katalogu zagadnienia).
      const share = Math.floor(targets[stage] / stageTypes.length) + (index < targets[stage] % stageTypes.length ? 1 : 0);
      packets.push({ type, share, count: share + PACKET_RESERVE });
    });
  }
  if (listen > 0) packets.push({ type: "lesson_listen_choice", share: listen, count: listen });
  return { packets, caps: { ...targets, intro: notice, listen } };
}
