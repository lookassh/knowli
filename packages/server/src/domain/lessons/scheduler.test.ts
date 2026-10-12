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
  it("awans na productive po 2 kolejnych correct na guided", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g2" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory }));
    expect(plan).toMatchObject({ kind: "exercise", objectiveId: O1, exerciseType: "lesson_gap", reason: "continue" });
  });

  it("błąd zeruje licznik etapu — 1 correct, incorrect, 1 correct → wciąż guided", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "g2" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g1" }),
    ];
    // Po błędzie uruchamia się najpierw cykl wsparcia; sprawdzamy brak awansu,
    // dając cel z już wyczerpanym cyklem wsparcia (support_card wydany).
    const withSupport = [
      sessionHistory[0]!,
      sessionHistory[1]!,
      task({ objectiveId: O1, kind: "support_card" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "support" as never, itemId: "g1" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: "g2" }),
    ];
    const plan = selectLessonTask(input({ cardCountByObjective: { [O1]: 0 }, sessionHistory: withSupport }));
    expect(plan).toMatchObject({ objectiveId: O1, exerciseType: "lesson_choice" });
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
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "correct", itemId: `item:${O1}:guided:a` }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: "zzz" }),
    ];
    // Niech etap wraca guided (po incorrect wsparcie wyczerpane): wybór guided b (niewidziany).
    const withSupportDone = [
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "incorrect", itemId: `item:${O1}:guided:a` }),
      task({ objectiveId: O1, kind: "support_card" }),
      task({ objectiveId: O1, exerciseType: "lesson_choice", outcome: "support" as never, itemId: `item:${O1}:guided:a` }),
    ];
    void sessionHistory;
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
  it("pomija typy otwarte, gdy istnieje alternatywa zamknięta/gap", () => {
    const sessionHistory = [
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p1" }),
      task({ objectiveId: O1, exerciseType: "lesson_gap", outcome: "correct", itemId: "p2" }),
    ];
    // Etap productive→independent; bez gradera independent (open_answer) odpada,
    // selektor spada do innego priorytetu zamiast wydać otwarte.
    const plan = selectLessonTask(
      input({
        graderAvailable: false,
        graderCallsLeft: 0,
        progress: { [O1]: prog("learning") },
        cardCountByObjective: { [O1]: 0 },
        sessionHistory,
        exercises: [...poolFor(O1), ...poolFor(O2)],
      }),
    );
    expect((plan as { exerciseType?: string })?.exerciseType).not.toBe("lesson_open_answer");
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
