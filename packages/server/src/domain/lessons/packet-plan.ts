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

/** Keywords na zagadnienie (`typeRules.lesson_keywords`: „at most one per objective”); jedyne miejsce limitu. */
export const KEYWORDS_PER_OBJECTIVE = 1;

/** Ćwiczeń `lesson_notice` (intro, poza minimum publikacji) na zagadnienie. */
const NOTICE_PER_OBJECTIVE = 2;

export interface StageCounts {
  readonly guided: number;
  readonly productive: number;
  readonly independent: number;
}

/** Limit przyjęcia per „kubełek”: etap oceniany, `lesson_notice` (intro), słuchanie albo keywords (oba poza ścieżką etapów). */
export type PacketBucket = keyof StageCounts | "intro" | "listen" | "keywords";

export interface PacketPlan {
  /**
   * `share` — udział paczki w limicie kubełka (przyjmowany najpierw), `count` — zamówienie z zapasem;
   * `companion` — typ zamawiany w tej samej paczce poza `count` (keywords przy pytaniach otwartych, spec etapu 5 §5.1).
   */
  readonly packets: readonly {
    readonly type: LessonExerciseType;
    readonly share: number;
    readonly count: number;
    readonly companion?: "lesson_keywords";
  }[];
  readonly caps: Readonly<Record<PacketBucket, number>>;
}

const STAGES = ["guided", "productive", "independent"] as const;

export function bucketOf(type: LessonExerciseType): PacketBucket {
  if (type === "lesson_keywords") return "keywords";
  return outsideStagePath(type) ? "listen" : (stageOf(type) as PacketBucket);
}

export function packetPlan(subject: SubjectModule, objective: LearningObjective, stageSplit: StageCounts, listenAllowance: number): PacketPlan {
  const minimums = lessonPoolMinimums(subject);
  const targets: StageCounts = {
    guided: Math.max(stageSplit.guided, minimums.guided),
    productive: Math.max(stageSplit.productive, minimums.productive),
    independent: Math.max(stageSplit.independent, minimums.independent + subject.agentPolicy.independentReserve),
  };
  return packetPlanForTargets(objective, targets, objective.exerciseTypes.includes("lesson_notice"), listenAllowance, objective.exerciseTypes.includes("lesson_keywords"));
}

/**
 * Paczki z gotowych celów etapów (pula: z {@link packetPlan}; „dodaj N”: braki etapów + N bez podnoszenia
 * do minimum). Etap z celem 0 i typ z udziałem 0 nie mają paczek; słuchanie tylko, gdy cel dopuszcza typ.
 * `withKeywords`: paczka pytań otwartych zamawia też keywords swojej rodziny („dodaj N” bez keywords —
 * limit kubełka liczy tylko bieżący run).
 */
export function packetPlanForTargets(
  objective: LearningObjective,
  targets: StageCounts,
  withNotice: boolean,
  listenAllowance: number,
  withKeywords = false,
): PacketPlan {
  const types = objective.exerciseTypes;
  const notice = withNotice ? NOTICE_PER_OBJECTIVE : 0;
  const listen = types.includes("lesson_listen_choice") ? listenAllowance : 0;
  const packets: { type: LessonExerciseType; share: number; count: number; companion?: "lesson_keywords" }[] = [];
  if (notice > 0) packets.push({ type: "lesson_notice", share: notice, count: notice });
  for (const stage of STAGES) {
    if (targets[stage] === 0) continue;
    const stageTypes = types.filter((type) => !outsideStagePath(type) && stageOf(type) === stage);
    // Reszta podziału do wcześniejszych typów (kolejność katalogu zagadnienia).
    const shareOf = (index: number) => Math.floor(targets[stage] / stageTypes.length) + (index < targets[stage] % stageTypes.length ? 1 : 0);
    // Rachunki są puste, gdy materiał nie uczy obsługiwanej metody (typeRules przedmiotu): paczka pytań
    // otwartych tego etapu zamawia też ich udział, a limit etapu odcina nadmiar przy przyjęciu (runda 0 szkoły).
    const calculationShare = stageTypes.includes("lesson_calculation") ? shareOf(stageTypes.indexOf("lesson_calculation")) : 0;
    stageTypes.forEach((type, index) => {
      const share = shareOf(index);
      // Typ bez udziału (cel etapu mniejszy niż liczba typów, zwykle w „dodaj N”) nie zamawia samego zapasu.
      if (share === 0) return;
      const companion = withKeywords && type === "lesson_open_answer" ? { companion: "lesson_keywords" as const } : {};
      const extra = type === "lesson_open_answer" ? calculationShare : 0;
      packets.push({ type, share, count: share + extra + PACKET_RESERVE, ...companion });
    });
  }
  if (listen > 0) packets.push({ type: "lesson_listen_choice", share: listen, count: listen });
  const keywords = packets.some((packet) => packet.companion !== undefined) ? KEYWORDS_PER_OBJECTIVE : 0;
  return { packets, caps: { ...targets, intro: notice, listen, keywords } };
}
