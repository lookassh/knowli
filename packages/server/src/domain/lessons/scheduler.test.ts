import { describe, expect, it } from "vitest";
import {
  selectLessonTask,
  type LessonExerciseCandidate,
  type LessonScheduleInput,
  type LessonSessionTask,
  type ObjectiveProgressSnapshot,
} from "./scheduler";
import { DEFAULT_LESSON_POLICY, defaultPoolSize } from "./lesson-policy";
import type { LessonExerciseType } from "./types";
import type { ProgressStatus } from "../types";

const NOW = "2026-10-12T12:00:00.000Z";
const O1 = "subj.topic.o1";
const O2 = "subj.topic.o2";
const O3 = "subj.topic.o3";

/**
 * Fixture puli: dla każdego celu po jednym ćwiczeniu każdego etapu, ze stabilną
 * kolejnością i deterministycznym `targetKey`/`itemId`. Pozwala składać wejście
 * punktowo bez powielania pola.
 */
const STAGE_TYPE: Readonly<Record<"guided" | "productive" | "independent", LessonExerciseType>> = {
  guided: "lesson_choice",
  productive: "lesson_gap",
  independent: "lesson_open_answer",
};

function ex(
  objectiveId: string,
  stage: "guided" | "productive" | "independent",
  variant = "a",
): LessonExerciseCandidate {
  const key = `${objectiveId}:${stage}:${variant}`;
  return {
    itemId: `item:${key}`,
    itemRevisionId: `rev:${key}`,
    objectiveId,
    exerciseType: STAGE_TYPE[stage],
    targetKey: key,
  };
}

function notice(objectiveId: string): LessonExerciseCandidate {
  const key = `${objectiveId}:notice`;
  return {
    itemId: `item:${key}`,
    itemRevisionId: `rev:${key}`,
    objectiveId,
    exerciseType: "lesson_notice",
    targetKey: key,
  };
}

/** Pełna pula dla celu: guided×2, productive, independent (bez notice). */
function poolFor(objectiveId: string): LessonExerciseCandidate[] {
  return [
    ex(objectiveId, "guided", "a"),
    ex(objectiveId, "guided", "b"),
    ex(objectiveId, "productive", "a"),
    ex(objectiveId, "independent", "a"),
  ];
}

function prog(status: ProgressStatus, nextReviewAt: string | null = null): ObjectiveProgressSnapshot {
  return { status, nextReviewAt };
}

let ordinalSeq = 0;
function task(partial: Partial<LessonSessionTask> & { objectiveId: string }): LessonSessionTask {
  ordinalSeq += 1;
  return {
    ordinal: ordinalSeq,
    itemId: partial.itemId ?? null,
    objectiveId: partial.objectiveId,
    exerciseType: partial.exerciseType ?? "lesson_choice",
    kind: partial.kind ?? "exercise",
    ...(partial.outcome ? { outcome: partial.outcome } : {}),
  };
}

function input(overrides: Partial<LessonScheduleInput> = {}): LessonScheduleInput {
  return {
    exercises: overrides.exercises ?? poolFor(O1),
    objectiveOrder: overrides.objectiveOrder ?? [O1, O2, O3],
    progress: overrides.progress ?? {},
    ...(overrides.initialProgress === undefined ? {} : { initialProgress: overrides.initialProgress }),
    ...(overrides.planningMode === undefined ? {} : { planningMode: overrides.planningMode }),
    ...(overrides.reservedDueCheckObjectives === undefined ? {} : { reservedDueCheckObjectives: overrides.reservedDueCheckObjectives }),
    ...(overrides.supportObjectives === undefined ? {} : { supportObjectives: overrides.supportObjectives }),
    ...(overrides.precisionHistory === undefined ? {} : { precisionHistory: overrides.precisionHistory }),
    exposedTargetKeys: overrides.exposedTargetKeys ?? new Set<string>(),
    sessionHistory: overrides.sessionHistory ?? [],
    lastSeenAt: overrides.lastSeenAt ?? {},
    cardCountByObjective: overrides.cardCountByObjective ?? {},
    assessedRemaining: overrides.assessedRemaining ?? 10,
    testWindowOpen: overrides.testWindowOpen ?? false,
    graderAvailable: overrides.graderAvailable ?? true,
    graderCallsLeft: overrides.graderCallsLeft ?? 10,
    policy: overrides.policy ?? DEFAULT_LESSON_POLICY,
    now: overrides.now ?? NOW,
  };
}

describe("defaultPoolSize", () => {
  it("1 cel → 60 (base wygrywa z perObjective)", () => {
    expect(defaultPoolSize(1)).toBe(60);
  });
  it("7 celów → 84 (perObjective × n)", () => {
    expect(defaultPoolSize(7)).toBe(84);
  });
  it("20 celów → 120 (clamp max)", () => {
    expect(defaultPoolSize(20)).toBe(120);
  });
});

describe("selectLessonTask — zakończenie sesji", () => {
  it("assessedRemaining = 0 → null (także karty nie wychodzą)", () => {
    expect(selectLessonTask(input({ assessedRemaining: 0, cardCountByObjective: { [O1]: 2 } }))).toBeNull();
  });

  it("pusta pula → null", () => {
    expect(selectLessonTask(input({ exercises: [] }))).toBeNull();
  });
});

describe("selectLessonTask — wprowadzenie nowego celu (priorytet 5)", () => {
  it("nowy cel: najpierw karty, jedna karta = jedno zadanie card (intro)", () => {
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 2 } }));
    expect(plan).toEqual({ kind: "card", objectiveId: O1, cardPurpose: "intro" });
  });

  it("po wszystkich kartach: lesson_notice, jeśli jest w puli", () => {
    const sessionHistory = [
      task({ objectiveId: O1, kind: "card" }),
      task({ objectiveId: O1, kind: "card" }),
    ];
    const plan = selectLessonTask(
      input({
        exercises: [...poolFor(O1), notice(O1)],
        cardCountByObjective: { [O1]: 2 },
        sessionHistory,
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_notice", reason: "introduce" });
  });

  it("po kartach i notice: ćwiczenie etapu guided", () => {
    const sessionHistory = [
      task({ objectiveId: O1, kind: "card" }),
      task({ objectiveId: O1, kind: "card" }),
      task({ objectiveId: O1, exerciseType: "lesson_notice", outcome: "correct" }),
    ];
    const plan = selectLessonTask(
      input({ exercises: [...poolFor(O1), notice(O1)], cardCountByObjective: { [O1]: 2 }, sessionHistory }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice", reason: "introduce" });
  });

  it("cel bez kart (cardCount 0) i bez notice → od razu guided", () => {
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 } }));
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice", reason: "introduce" });
  });

  it("max 2 nowe cele na sesję — trzeci nowy cel nie jest wprowadzany", () => {
    // O1 i O2 już wprowadzone w sesji (guided wydany), O3 byłby trzecim nowym.
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "x" }),
      task({ objectiveId: O2, exerciseType: "lesson_choice", outcome: "correct", itemId: "y" }),
    ];
    const exercises = [...poolFor(O1), ...poolFor(O2), ...poolFor(O3)];
    const plan = selectLessonTask(input({ exercises, cardCountByObjective: { [O3]: 2 }, sessionHistory }));
    // Nie wolno zacząć O3; wybór pada na kontynuację O1/O2, nigdy na O3 intro.
    expect(plan?.objectiveId).not.toBe(O3);
  });
});

describe("selectLessonTask — kontynuacja celu w toku (priorytet 4)", () => {
  it("plan sesji zachowuje niewidzianą możliwość ćwiczenia na kolejną sesję", () => {
    const exercises = [ex(O1, "productive", "a"), ex(O1, "productive", "b"), ex(O1, "productive", "c")];
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_gap", itemId: "item:one" }),
      task({ objectiveId: O1, exerciseType: "lesson_gap", itemId: "item:two" }),
    ];
    const plan = selectLessonTask(input({
      exercises,
      objectiveOrder: [O1],
      initialProgress: { [O1]: prog("learning") },
      progress: { [O1]: prog("learning") },
      planningMode: true,
      sessionHistory,
    }));
    expect(plan).toBeNull();
  });

  it("awans na productive po 2 kolejnych correct na guided", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g2" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_gap", reason: "continue" });
  });

  it("fixed plan does not advance stages from planned slots without historical success", () => {
    const exercises = [...poolFor(O1)];
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", itemId: `item:${O1}:guided:a` }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", itemId: `item:${O1}:guided:b` }),
    ];
    const plan = selectLessonTask(input({ exercises, planningMode: true, cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).toBeNull();
  });

  it("błąd zeruje licznik etapu — 1 correct, incorrect, (wsparcie), 1 correct → wciąż guided (brak awansu)", () => {
    // 1 correct → błąd (zeruje licznik, otwiera cykl wsparcia) → pełny cykl
    // wsparcia (support_card + ćwiczenie guided nieocenione = neutralne) →
    // 1 correct. Licznik etapu po błędzie = 0, więc jedno correct nie wystarcza
    // do awansu (advanceAfterCorrect = 2): cel wciąż na guided.
    const withSupport = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "g2" }),
      task({ objectiveId: O1, kind: "support_card" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "unevaluated", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g2" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory: withSupport }));
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice", reason: "continue" });
    expect((plan as { exerciseType: string }).exerciseType).not.toBe("lesson_gap");
  });

  it("unevaluated/skipped są neutralne dla licznika etapu", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "unevaluated", itemId: "g2" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "gx" }),
    ];
    // 2 correct (neutralny w środku) → awans na productive.
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).toMatchObject({ objectiveId: O1, exerciseType: "lesson_gap", reason: "continue" });
  });

  it("cel z wcześniejszej sesji (status ≠ not_assessed) startuje od productive bez kart", () => {
    const plan = selectLessonTask(
      input({
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 2 },
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_gap", reason: "continue" });
  });
});

describe("selectLessonTask — cykl wsparcia (priorytet 1)", () => {
  it("po incorrect: karta support, potem guided (reason support), raz na cel", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "g1" }),
    ];
    const first = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(first).toEqual({ kind: "card", objectiveId: O1, cardPurpose: "support" });

    const afterCard = [...sessionHistory, task({ objectiveId: O1, kind: "support_card" })];
    const second = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory: afterCard }));
    expect(second).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice", reason: "support" });
  });

  it("dont_remember też uruchamia cykl wsparcia", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "dont_remember", itemId: "g1" }),
    ];
    expect(selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }))).toEqual({
      kind: "card",
      objectiveId: O1,
      cardPurpose: "support",
    });
  });

  it("unevaluated/skipped NIE uruchamia cyklu wsparcia", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "unevaluated", itemId: "g1" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).not.toEqual({ kind: "card", objectiveId: O1, cardPurpose: "support" });
  });

  it("limit cykli: po jednym pełnym cyklu wsparcia drugi błąd nie daje kolejnej karty support", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "g1" }),
      task({ objectiveId: O1, kind: "support_card" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "g2" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).not.toEqual({ kind: "card", objectiveId: O1, cardPurpose: "support" });
  });
});

describe("selectLessonTask — należne niezależne sprawdzenie (priorytet 2)", () => {
  it("nextReviewAt <= now wybiera niewidziane ćwiczenie i independentCheck: true", () => {
    const plan = selectLessonTask(
      input({
        progress: { [O1]: prog("mastered", "2026-10-10T00:00:00.000Z") },
        cardCountByObjective: { [O1]: 0 },
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, reason: "due_check", independentCheck: true });
    // Nie guided (guided nigdy nie jest independentCheck).
    expect((plan as { exerciseType: string }).exerciseType).not.toBe("lesson_choice");
  });

  it("sprawdzenie wyprzedza wprowadzanie nowego celu", () => {
    const plan = selectLessonTask(
      input({
        exercises: [...poolFor(O1), ...poolFor(O2)],
        progress: { [O1]: prog("mastered", "2026-10-01T00:00:00.000Z") },
        cardCountByObjective: { [O2]: 2 },
      }),
    );
    expect(plan).toMatchObject({ objectiveId: O1, reason: "due_check" });
  });

  it("fixed plan reserves due checks before support from historical difficulty", () => {
    const plan = selectLessonTask(input({
      planningMode: true,
      supportObjectives: new Set([O1]),
      progress: { [O1]: prog("mastered", "2026-10-10T00:00:00.000Z") },
      cardCountByObjective: { [O1]: 0 },
    }));
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, reason: "due_check", independentCheck: true });
  });

  it("fixed plan reserves at most one due check per objective and session", () => {
    const exercises = [ex(O1, "independent", "a"), ex(O1, "independent", "b"),
      ...["a", "b", "c", "d"].map((variant) => ex(O1, "productive", variant))];
    const plan = selectLessonTask(input({
      exercises,
      planningMode: true,
      reservedDueCheckObjectives: new Set([O1]),
      progress: { [O1]: prog("learning", "2026-10-10T00:00:00.000Z") },
    }));

    expect(plan).not.toMatchObject({ reason: "due_check" });
  });
});

describe("selectLessonTask — okno sprawdzianu (priorytet 3)", () => {
  it("preferuje etap samodzielny dla nieopanowanych celów", () => {
    const plan = selectLessonTask(
      input({
        testWindowOpen: true,
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_open_answer", reason: "test_preparation" });
  });
});

describe("selectLessonTask — wybór ćwiczenia", () => {
  it("preferuje niewidziane przed widzianymi", () => {
    const exposed = new Set<string>([`${O1}:guided:a`]);
    // Po incorrect pełny cykl wsparcia (support_card + ćwiczenie guided
    // nieocenione) wyczerpuje wsparcie; selektor wraca do guided i wybiera
    // niewidziany `guided:b` zamiast wcześniej ujawnionego `guided:a`.
    const withSupportDone = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: `item:${O1}:guided:a` }),
      task({ objectiveId: O1, kind: "support_card" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "unevaluated", itemId: `item:${O1}:guided:a` }),
    ];
    const plan = selectLessonTask(
      input({ exposedTargetKeys: exposed, cardCountByObjective: { [O1]: 0 }, sessionHistory: withSupportDone }),
    );
    expect((plan as { itemId: string }).itemId).toBe(`item:${O1}:guided:b`);
  });

  it("nie powtarza ćwiczenia wydanego w sesji, gdy istnieje inne", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: `item:${O1}:guided:a` }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect((plan as { itemId: string }).itemId).not.toBe(`item:${O1}:guided:a`);
  });

  it("spośród widzianych wybiera najdawniej widziane (lastSeenAt)", () => {
    const exposed = new Set<string>([`${O1}:guided:a`, `${O1}:guided:b`]);
    const lastSeenAt = {
      [`item:${O1}:guided:a`]: "2026-10-11T00:00:00.000Z",
      [`item:${O1}:guided:b`]: "2026-10-09T00:00:00.000Z",
    };
    const plan = selectLessonTask(
      input({ exposedTargetKeys: exposed, lastSeenAt, cardCountByObjective: { [O1]: 0 } }),
    );
    expect((plan as { itemId: string }).itemId).toBe(`item:${O1}:guided:b`);
  });
});

describe("selectLessonTask — brak modelu / zerowy limit (req 6.8)", () => {
  it("preferuje typ nieoceniany modelowo, gdy na tym etapie jest alternatywa (gap vs error_fix)", () => {
    // Cel kontynuowany na etapie productive. Pula productive ma zarówno
    // lesson_gap (nieoceniany modelowo) jak i lesson_error_fix (zależny od
    // modelu). Bez gradera selektor PREFERUJE gap, nie wydaje error_fix.
    const gap: LessonExerciseCandidate = {
      itemId: "pg", itemRevisionId: "rpg", objectiveId: O1,
      exerciseType: "lesson_gap", targetKey: "pg",
    };
    const errorFix: LessonExerciseCandidate = {
      itemId: "pe", itemRevisionId: "rpe", objectiveId: O1,
      exerciseType: "lesson_error_fix", targetKey: "pe",
    };
    const plan = selectLessonTask(
      input({
        graderAvailable: false,
        graderCallsLeft: 0,
        progress: { [O1]: prog("learning") }, // start productive, bez awansu
        cardCountByObjective: { [O1]: 0 },
        exercises: [errorFix, gap], // error_fix pierwszy w kolejności puli
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_gap" });
  });

  it("grader niedostępny, w puli dla celu/etapu tylko open-answer → open-answer MIMO to (req 6.8)", () => {
    // Cel kontynuowany (start productive); 2 correct na productive → awans na
    // independent. Pula dla O1 ma tylko open-answer (independent). „prefer
    // closed” to preferencja, nie wykluczenie: brak alternatywy → selektor i
    // tak wydaje open-answer zamiast kończyć sesję.
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p1" }),
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p2" }),
    ];
    const plan = selectLessonTask(
      input({
        graderAvailable: false,
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
        exercises: [ex(O1, "independent", "a"), ex(O1, "independent", "b")],
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_open_answer" });
  });

  it("graderCallsLeft = 0, tylko open-answer → open-answer MIMO to, nie null", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p1" }),
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p2" }),
    ];
    const plan = selectLessonTask(
      input({
        graderAvailable: true,
        graderCallsLeft: 0,
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
        exercises: [ex(O1, "independent", "a")],
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_open_answer" });
  });
});

describe("selectLessonTask — kontrakt budżetu ocenianego", () => {
  it("assessedRemaining = 1, następny krok to karta intro → karta (karta nie liczy się do budżetu)", () => {
    const plan = selectLessonTask(input({ assessedRemaining: 1, cardCountByObjective: { [O1]: 2 } }));
    expect(plan).toEqual({ kind: "card", objectiveId: O1, cardPurpose: "intro" });
  });

  it("assessedRemaining = 1, następny krok to notice → notice (oceniany, mieści się w budżecie 1)", () => {
    const sessionHistory = [
      task({ objectiveId: O1, kind: "card" }),
      task({ objectiveId: O1, kind: "card" }),
    ];
    const plan = selectLessonTask(
      input({
        assessedRemaining: 1,
        exercises: [...poolFor(O1), notice(O1)],
        cardCountByObjective: { [O1]: 2 },
        sessionHistory,
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", exerciseType: "lesson_notice" });
  });

  it("assessedRemaining = 0 → null, nawet gdy następnym krokiem byłaby karta", () => {
    expect(selectLessonTask(input({ assessedRemaining: 0, cardCountByObjective: { [O1]: 2 } }))).toBeNull();
  });
});

describe("selectLessonTask — ekspozycja vs wydanie w sesji (collision targetKey)", () => {
  it("sprawdzenie nie wybiera ćwiczenia współdzielącego targetKey z wydanym w sesji", () => {
    // Dwa ćwiczenia independent dzielą ten sam targetKey; jedno wydano w sesji.
    const shared = "shared-key";
    const a: LessonExerciseCandidate = {
      itemId: "ind-a", itemRevisionId: "rev-a", objectiveId: O1,
      exerciseType: "lesson_open_answer", targetKey: shared,
    };
    const b: LessonExerciseCandidate = {
      itemId: "ind-b", itemRevisionId: "rev-b", objectiveId: O1,
      exerciseType: "lesson_open_answer", targetKey: shared,
    };
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_open_answer", outcome: "correct", itemId: "ind-a" }),
    ];
    const plan = selectLessonTask(
      input({
        progress: { [O1]: prog("mastered", "2026-10-01T00:00:00.000Z") },
        cardCountByObjective: { [O1]: 0 },
        exercises: [a, b],
        sessionHistory,
      }),
    );
    // targetKey `shared` został ujawniony (ind-a wydane w sesji), więc ind-b
    // NIE jest „niewidziane” — niezależne sprawdzenie (due_check,
    // independentCheck) nie może na nie trafić, bo wzorzec już ujawniony.
    const isIndependentCheckOnB =
      plan !== null &&
      plan.kind === "exercise" &&
      plan.reason === "due_check" &&
      plan.itemId === "ind-b";
    expect(isIndependentCheckOnB).toBe(false);
    // I szerzej: żadne due_check nie powinno wyjść, skoro brak niewidzianego
    // ćwiczenia dla tego celu.
    if (plan && plan.kind === "exercise" && plan.reason === "due_check") {
      throw new Error("due_check nie powinno wybrać ćwiczenia o ujawnionym targetKey");
    }
  });

  it("sameDoesExposureIsStillAssistedInAnotherObjective", () => {
    const shared = "answer:does";
    const prior: LessonExerciseCandidate = {
      itemId: "question-does", itemRevisionId: "rev-question-does", objectiveId: O1,
      exerciseType: "lesson_gap", targetKey: shared,
    };
    const nextObjective: LessonExerciseCandidate = {
      itemId: "short-answer-does", itemRevisionId: "rev-short-answer-does", objectiveId: O2,
      exerciseType: "lesson_gap", targetKey: shared,
    };
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: prior.itemId }),
    ];
    const plan = selectLessonTask(input({
      objectiveOrder: [O2],
      progress: { [O1]: prog("mastered"), [O2]: prog("mastered", "2026-10-12T11:00:00.000Z") },
      exercises: [prior, nextObjective],
      sessionHistory,
    }));
    expect(plan?.kind === "exercise" && plan.reason === "due_check" && plan.itemId === nextObjective.itemId).toBe(false);
  });
});

describe("selectLessonTask — okno sprawdzianu: cel wprowadzony w tej sesji i nieopanowany", () => {
  it("nowy cel wprowadzony w sesji (not_assessed), nieopanowany → etap samodzielny", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
    ];
    const plan = selectLessonTask(
      input({
        testWindowOpen: true,
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, reason: "test_preparation" });
  });
});

describe("selectLessonTask — etap zamrożony przy starcie sesji (P2-6)", () => {
  it("nowy cel w sesji NIE przeskakuje do productive, gdy bieżąca projekcja (odczytana po ocenie) ma już status learning", () => {
    // Scenariusz luki: cel wprowadzony w TEJ sesji; po poprawnym lesson_notice
    // projekcja postępu jest aktualizowana (status learning) i ponownie
    // odczytana przy nextTask. Etap musi wynikać z HISTORII sesji (start
    // guided), nie z re-odczytu bieżącej projekcji — inaczej guided jest
    // pomijany mimo wymaganych dwóch sukcesów.
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_notice", outcome: "correct" }),
    ];
    const plan = selectLessonTask(
      input({
        exercises: [...poolFor(O1), notice(O1)],
        progress: { [O1]: prog("learning") }, // projekcja po ocenie notice
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
      }),
    );
    // Kolejne zadanie to guided (lesson_choice), NIE productive (lesson_gap).
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice" });
    expect((plan as { exerciseType: string }).exerciseType).not.toBe("lesson_gap");
  });

  it("wymagane dwa sukcesy guided są egzekwowane dla celu wprowadzonego w sesji mimo statusu learning", () => {
    // Po jednym poprawnym guided (i statusie learning z projekcji) wciąż
    // guided — jeden sukces nie wystarcza (advanceAfterCorrect = 2).
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_notice", outcome: "correct" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: `item:${O1}:guided:a` }),
    ];
    const plan = selectLessonTask(
      input({
        exercises: [...poolFor(O1), notice(O1)],
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_choice" });
    expect((plan as { exerciseType: string }).exerciseType).not.toBe("lesson_gap");
  });

  it("po DWÓCH sukcesach guided cel wprowadzony w sesji awansuje na productive", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_notice", outcome: "correct" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: `item:${O1}:guided:a` }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: `item:${O1}:guided:b` }),
    ];
    const plan = selectLessonTask(
      input({
        exercises: [...poolFor(O1), notice(O1)],
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
      }),
    );
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_gap", reason: "continue" });
  });
});

describe("snapshot początkowy celu", () => {
  it("znany cel pozostaje productive po jednym sukcesie, mimo historii sesji", () => {
    const plan = selectLessonTask({ ...input({ progress: { [O1]: prog("learning") },
      sessionHistory: [task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "previous-gap" })],
    }), initialProgress: { [O1]: prog("learning") } });
    expect(plan).toMatchObject({ exerciseType: "lesson_gap" });
  });

  it("dwa nowe cele nadal zużywają limit, gdy bieżąca projekcja już ma learning", () => {
    const plan = selectLessonTask({ ...input({
      exercises: poolFor(O3),
      progress: { [O1]: prog("learning"), [O2]: prog("learning") },
      sessionHistory: [O1, O2].map((objectiveId) => task({ objectiveId, exerciseType: "lesson_notice", outcome: "correct" })),
    }), initialProgress: {} });
    expect(plan).toBeNull();
  });
});

describe("selectLessonTask — determinizm", () => {
  it("to samo wejście → ten sam wynik", () => {
    const build = () =>
      input({
        exercises: [...poolFor(O1), ...poolFor(O2)],
        cardCountByObjective: { [O1]: 2, [O2]: 2 },
      });
    expect(selectLessonTask(build())).toEqual(selectLessonTask(build()));
  });
});


describe("calculation due checks", () => {
  it("issues a calculation without a grader and protects previously exposed targets", () => {
    const calculation = { ...ex(O1, "independent"), exerciseType: "lesson_calculation" as const };
    const options = input({ exercises: [calculation], progress: { [O1]: prog("needs_confirmation", "2000-01-01T00:00:00Z") }, graderAvailable: false, graderCallsLeft: 0 });
    expect(selectLessonTask(options)).toMatchObject({ kind: "exercise", exerciseType: "lesson_calculation", independentCheck: true, reason: "due_check" });
    const exposed = selectLessonTask({ ...options, exposedTargetKeys: new Set([calculation.targetKey]) });
    expect(exposed?.kind === "exercise" && exposed.independentCheck).not.toBe(true);
  });
});

describe("selectLessonTask — trener precyzji (Etap 4)", () => {
  function open(variant: string, familyId: string, expectedForm = "explanation"): LessonExerciseCandidate {
    return { ...ex(O1, "independent", variant), familyId, expectedForm };
  }
  function keywords(familyId: string, variant = "kw"): LessonExerciseCandidate {
    const key = `${O1}:keywords:${variant}`;
    return { itemId: `item:${key}`, itemRevisionId: `rev:${key}`, objectiveId: O1, exerciseType: "lesson_keywords", targetKey: key, familyId };
  }
  // Cel opanowany bez należnej powtórki: utrwalanie wybiera odpowiedź otwartą bez samodzielnego sprawdzenia.
  const mastered = { [O1]: prog("mastered") };
  const base = { objectiveOrder: [O1], progress: mastered, initialProgress: mastered, planningMode: true };

  it("po odpowiedzi nie na temat poprzedza odpowiedź otwartą słowami kluczowymi tej samej rodziny", () => {
    const plan = selectLessonTask(input({
      ...base, exercises: [open("a", "def"), keywords("inna", "x"), keywords("def")],
      precisionHistory: { [O1]: { knowledge: "correct", precision: "unfocused" } },
    }));
    expect(plan).toEqual({
      kind: "exercise", itemId: "item:subj.topic.o1:keywords:kw", itemRevisionId: "rev:subj.topic.o1:keywords:kw",
      objectiveId: O1, exerciseType: "lesson_keywords", reason: "precision_practice", independentCheck: false,
      pairedWith: { itemId: "item:subj.topic.o1:independent:a", itemRevisionId: "rev:subj.topic.o1:independent:a" },
    });
  });

  it("para także po odpowiedzi niepełnej", () => {
    const plan = selectLessonTask(input({ ...base, exercises: [open("a", "def"), keywords("def")], precisionHistory: { [O1]: { knowledge: "partial", precision: "concise" } } }));
    expect(plan).toMatchObject({ exerciseType: "lesson_keywords", pairedWith: { itemRevisionId: "rev:subj.topic.o1:independent:a" } });
  });

  it.each([
    ["zwięzła poprawna odpowiedź", { precisionHistory: { [O1]: { knowledge: "correct", precision: "concise" } } }],
    ["brak historii precyzji", {}],
    ["sesja bez planu (legacy)", { planningMode: false, precisionHistory: { [O1]: { knowledge: "correct", precision: "unfocused" } } }],
    ["budżet tylko na jedno zadanie", { assessedRemaining: 1, precisionHistory: { [O1]: { knowledge: "correct", precision: "unfocused" } } }],
    ["brak gradera", { graderAvailable: false, precisionHistory: { [O1]: { knowledge: "correct", precision: "unfocused" } } }],
  ] as const)("bez pary: %s", (_label, overrides) => {
    const plan = selectLessonTask(input({ ...base, exercises: [open("a", "def"), keywords("def")], ...overrides } as Partial<LessonScheduleInput>));
    expect(plan).toMatchObject({ exerciseType: "lesson_open_answer", itemId: "item:subj.topic.o1:independent:a" });
  });

  it("nie paruje samodzielnego sprawdzenia należnego celu", () => {
    const due = { [O1]: prog("learning", "2026-10-11T00:00:00.000Z") };
    const plan = selectLessonTask(input({
      objectiveOrder: [O1], progress: due, initialProgress: due, planningMode: true,
      exercises: [open("a", "def"), keywords("def")], precisionHistory: { [O1]: { knowledge: "correct", precision: "unfocused" } },
    }));
    expect(plan).toMatchObject({ exerciseType: "lesson_open_answer", reason: "due_check", independentCheck: true });
  });

  it("nigdy nie wydaje słów kluczowych jako zwykłego ćwiczenia prowadzonego", () => {
    const plan = selectLessonTask(input({ objectiveOrder: [O1], exercises: [keywords("def"), ex(O1, "guided", "a")] }));
    expect(plan).toMatchObject({ exerciseType: "lesson_choice", reason: "introduce" });
    expect(selectLessonTask(input({ objectiveOrder: [O1], exercises: [keywords("def")] }))).toBeNull();
  });

  it("po poprawnej, rozwlekłej odpowiedzi preferuje pytanie o formie zwięzłej", () => {
    const exercises = [open("a", "def"), open("b", "zwiezle", "one_sentence")];
    const verbose = selectLessonTask(input({ ...base, exercises, precisionHistory: { [O1]: { knowledge: "correct", precision: "verbose" } } }));
    expect(verbose).toMatchObject({ itemId: "item:subj.topic.o1:independent:b" });
    const concise = selectLessonTask(input({ ...base, exercises, precisionHistory: { [O1]: { knowledge: "correct", precision: "concise" } } }));
    expect(concise).toMatchObject({ itemId: "item:subj.topic.o1:independent:a" });
  });
});
