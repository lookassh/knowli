import { describe, expect, it } from "vitest";
import {
  hasScheduledWork,
  selectTask,
  type ScheduleCandidate,
  type ScheduleInput,
  type SchedulePeer,
} from "./scheduler";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import { computeTargetKey } from "./target-key";

const NOW = "2026-10-07T16:00:00.000Z";
const PAST = "2026-10-06T16:00:00.000Z";

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return {
    itemRevisionId: "rev-1",
    itemId: "item-1",
    position: 0,
    target: "Thursday",
    source: "czwartek",
    acceptedAnswers: [],
    targetLocale: "en-GB",
    progress: {},
    failuresThisSession: 0,
    supportedThisSession: false,
    recognitionFallbackUsedThisSession: true,
    usedThisSession: 0,
    presentationsThisSession: 0,
    lastContactAt: null,
    lastUsedOrdinal: null,
    readingDirections: {},
    practiceMix: { listening: 0, reading: 0 },
    introducedSkills: { recall: false, pronunciation: false },
    ...overrides,
  };
}

function peer(overrides: Partial<SchedulePeer> = {}): SchedulePeer {
  return {
    itemRevisionId: "rev-1",
    position: 0,
    target: "Thursday",
    source: "czwartek",
    targetLocale: "en-GB",
    acceptedAnswers: [],
    ...overrides,
  };
}

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    now: NOW,
    policy: LEARNING_V1_POLICY,
    microphoneEnabled: true,
    assessedRemaining: 12,
    nextOrdinal: 0,
    candidates: [],
    peers: [],
    reservedTargetKeys: [],
    ...overrides,
  };
}

const KEY_THURSDAY = computeTargetKey("Thursday", "en-GB");
const KEY_WEDNESDAY = computeTargetKey("Wednesday", "en-GB");
const KEY_FRIDAY = computeTargetKey("Friday", "en-GB");

describe("selectTask — puste wejścia i budżet", () => {
  it("brak kandydatów daje null", () => {
    expect(selectTask(input())).toBeNull();
  });

  it("wyczerpany budżet zadań ocenianych nie wydaje ani zadań naprawczych", () => {
    const plan = selectTask(input({ assessedRemaining: 0, candidates: [candidate()] }));
    expect(plan).toBeNull();
  });
});

describe("selectTask — nowy materiał (SPEC §13)", () => {
  it("nieznany element zaczyna się prezentacją, która ujawnia cel i nie zużywa budżetu", () => {
    const plan = selectTask(input({ candidates: [candidate()], peers: [peer()] }));
    expect(plan).toMatchObject({
      itemRevisionId: "rev-1",
      exerciseType: "exposure",
      assessed: false,
      reason: "new-material",
    });
    expect(plan!.revealsTargetKeys).toEqual([KEY_THURSDAY]);
  });

  it("nieznane słowa nie są sprawdzane przed nauką — brak zadań recall/spelling", () => {
    const plan = selectTask(input({ candidates: [candidate()], peers: [peer()] }));
    expect(plan!.exerciseType).not.toBe("recall");
    expect(plan!.exerciseType).not.toBe("spelling");
  });

  it("porcje 2–3: po dwóch prezentacjach łatwe rozpoznawanie najstarszego elementu", () => {
    const a = candidate({ itemRevisionId: "rev-a", position: 0, target: "Monday", source: "poniedziałek", usedThisSession: 1, presentationsThisSession: 1 });
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1, presentationsThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 2, target: "Wednesday", source: "środa" });
    const peers = [peer(a), peer(b), peer(c)] as SchedulePeer[];
    const plan = selectTask(input({ candidates: [a, b, c], peers }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-a", exerciseType: "listening", reason: "new-practice", assessed: true });
  });

  it("nie emituje tekstowych zadań z rozpoznawania dla profilu picture bez czytania", () => {
    const red = candidate({
      itemRevisionId: "rev-red", target: "red", source: "czerwony", visual: { kind: "color", color: "#ff0000" },
      ownPresentationCompleted: true, usedThisSession: 2, presentationsThisSession: 2,
      practiceMix: { listening: 2, reading: 1 },
    });
    const blue = candidate({
      itemRevisionId: "rev-blue", position: 1, target: "blue", source: "niebieski", visual: { kind: "color", color: "#0000ff" },
      ownPresentationCompleted: true, usedThisSession: 2, presentationsThisSession: 2,
    });
    const plan = selectTask(input({
      canRead: false, microphoneEnabled: true, vocabularyFormat: "picture", nextOrdinal: 2,
      candidates: [red, blue], peers: [peer(red), peer(blue)],
    }));
    expect(plan).toMatchObject({ exerciseType: "listening" });
    expect(plan?.options?.every((option) => option.visual !== undefined)).toBe(true);
  });

  it("zwalnia nieaktywne rezerwacje Recall po wyłączeniu mikrofonu, aby słuchanie mogło trwać", () => {
    const red = candidate({
      itemRevisionId: "rev-red", target: "red", source: "czerwony", visual: { kind: "color", color: "#ff0000" },
      ownPresentationCompleted: true, usedThisSession: 2, presentationsThisSession: 2,
    });
    const blue = candidate({
      itemRevisionId: "rev-blue", position: 1, target: "blue", source: "niebieski", visual: { kind: "color", color: "#0000ff" },
      ownPresentationCompleted: true, usedThisSession: 2, presentationsThisSession: 2,
    });
    const plan = selectTask(input({
      canRead: false, microphoneEnabled: false, vocabularyFormat: "picture", nextOrdinal: 2,
      candidates: [red, blue], peers: [peer(red), peer(blue)],
      reservedTargetKeys: [computeTargetKey("red", "en-GB"), computeTargetKey("blue", "en-GB")],
    }));
    expect(plan).toMatchObject({ exerciseType: "listening" });
    expect(plan?.keepsReservations).toEqual([]);
  });
});

describe("selectTask — rezerwacje należnych sprawdzeń (arch §9.3)", () => {
  it("nie blokuje nieczytającego dziecka należna pisownia", () => {
    const dueSpelling = candidate({
      progress: { spelling: { status: "needs_confirmation", nextReviewAt: PAST, streak: 2 } },
      usedThisSession: 1,
      presentationsThisSession: 0,
      ownPresentationCompleted: true,
    });
    const plan = selectTask(input({ canRead: false, microphoneEnabled: true, candidates: [dueSpelling], peers: [peer(dueSpelling)] }));
    expect(plan?.skillAtIssue).not.toBe("spelling");
  });

  it("pisownia jako jedyna należność nie rekomenduje nauki bez czytania", () => {
    expect(hasScheduledWork([{
      progress: [],
      pendingCheckAt: PAST,
      pendingChecks: [{ skill: "spelling", dueAt: PAST }],
    }], NOW, { canRead: false, microphoneEnabled: true })).toBe(false);
  });

  it("należne sprawdzenie Recall i pisowni ma pierwszeństwo i zbiera oba wyniki z jednej odpowiedzi", () => {
    const due = candidate({
      progress: {
        recall: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 },
        spelling: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 },
      },
    });
    const plan = selectTask(input({ candidates: [due], peers: [peer(due)] }));
    expect(plan).toMatchObject({ exerciseType: "recall", assessed: true, reason: "due-check", skillAtIssue: "recall", statusAtIssue: "needs_confirmation" });
    // polski prompt bez gotowych odpowiedzi nie ujawnia celu
    expect(plan!.revealsTargetKeys).toEqual([]);
    expect(plan!.options).toBeUndefined();
  });

  it("najstarsza należność jest sprawdzana pierwsza", () => {
    const older = candidate({
      itemRevisionId: "rev-old",
      position: 0,
      progress: { recall: { status: "needs_confirmation", nextReviewAt: "2026-10-05T16:00:00.000Z", streak: 3 } },
    });
    const newer = candidate({
      itemRevisionId: "rev-new",
      position: 1,
      progress: { recall: { status: "needs_confirmation", nextReviewAt: "2026-10-06T16:00:00.000Z", streak: 3 } },
    });
    const plan = selectTask(input({ candidates: [newer, older], peers: [peer(older), peer(newer)] }));
    expect(plan!.itemRevisionId).toBe("rev-old");
  });

  it("oznacza wcześniejszy skill przy wspólnym sprawdzeniu Recall i pisowni", () => {
    const due = candidate({ progress: {
      recall: { status: "learning", nextReviewAt: "2026-10-06T16:00:00.000Z", streak: 1 },
      spelling: { status: "needs_reconfirmation", nextReviewAt: "2026-10-05T16:00:00.000Z", streak: 0 },
    } });
    const plan = selectTask(input({ candidates: [due], peers: [peer(due)] }));
    expect(plan).toMatchObject({ skillAtIssue: "spelling", statusAtIssue: "needs_reconfirmation" });
  });

  it("zarezerwowany cel nie pojawia się jako dystraktor", () => {
    const reserved = candidate({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" });
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1, presentationsThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 0, target: "Friday", source: "piątek", usedThisSession: 1, presentationsThisSession: 1 });
    const peers = [peer(reserved), peer(b), peer(c)];
    const plan = selectTask(
      input({
        candidates: [reserved, b, c],
        peers,
        reservedTargetKeys: [computeTargetKey("Wednesday", "en-GB")],
      }),
    );
    expect(plan).toMatchObject({ itemRevisionId: "rev-c", exerciseType: "listening" });
    const texts = plan!.options!.map((o) => o.text);
    expect(texts).toContain("piątek");
    expect(texts).not.toContain("środa");
  });

  it("zwolniona rezerwacja przywraca cel w puli dystraktorów", () => {
    const freed = candidate({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" });
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1, presentationsThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 0, target: "Friday", source: "piątek", usedThisSession: 1, presentationsThisSession: 1 });
    const plan = selectTask(input({ candidates: [freed, b, c], peers: [peer(freed), peer(b), peer(c)] }));
    expect(plan!.options!.map((o) => o.text)).toContain("środa");
  });

  it("cel objęty rezerwacją nie wraca do zadań rozpoznawania", () => {
    const reserved = candidate({
      progress: { listening: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
    });
    const other = candidate({
      itemRevisionId: "rev-2",
      position: 1,
      target: "Friday",
      source: "piątek",
      progress: { listening: { status: "needs_confirmation", nextReviewAt: "2026-10-06T17:00:00.000Z", streak: 3 } },
    });
    const plan = selectTask(
      input({
        candidates: [reserved, other],
        peers: [peer(reserved), peer(other), peer({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" })],
        reservedTargetKeys: [KEY_THURSDAY],
      }),
    );
    expect(plan!.itemRevisionId).toBe("rev-2");
    expect(plan!.revealsTargetKeys).not.toContain(KEY_THURSDAY);
  });
});

describe("selectTask — wsparcie po dwóch błędach (SPEC §16)", () => {
  it("dwa błędy dają prezentację wsparcia ujawniającą wzorzec", () => {
    const struggling = candidate({
      failuresThisSession: 2,
      usedThisSession: 2,
      lastUsedOrdinal: 3,
    });
    const plan = selectTask(
      input({ candidates: [struggling], peers: [peer(struggling)], nextOrdinal: 4 }),
    );
    expect(plan).toMatchObject({
      itemRevisionId: "rev-1",
      exerciseType: "exposure",
      reason: "support",
      assessed: false,
    });
    expect(plan!.revealsTargetKeys).toEqual([KEY_THURSDAY]);
  });

  it("po wsparciu element wraca dopiero po przerwie od innych zadań", () => {
    const supported = candidate({
      failuresThisSession: 2,
      supportedThisSession: true,
      usedThisSession: 3,
      lastUsedOrdinal: 4,
    });
    const other = candidate({
      itemRevisionId: "rev-2",
      position: 1,
      target: "Friday",
      source: "piątek",
      usedThisSession: 1,
    });
    // przerwa za krótka: ostatnie zadanie elementu było 1 zadanie temu
    const tooSoon = selectTask(
      input({ candidates: [supported, other], peers: [peer(supported), peer(other)], nextOrdinal: 5 }),
    );
    expect(tooSoon!.itemRevisionId).toBe("rev-2");

    const afterGap = selectTask(
      input({ candidates: [supported, other], peers: [peer(supported), peer(other)], nextOrdinal: 7 }),
    );
    expect(afterGap).toMatchObject({ itemRevisionId: "rev-1", reason: "retry-after-support", exerciseType: "listening" });
    expect(afterGap!.options!.filter((o) => o.correct).map((o) => o.text)).toEqual(["czwartek"]);
    expect(afterGap!.options!.map((o) => o.text)).toContain("piątek");
  });

  it("odtwarza terminalny cykl jako settled i kieruje trudną pisownię do letter completion", () => {
    const source = candidate({
      support: { phase: "waiting", cycleId: "task-source", sourceTaskId: "task-source", retryType: "letter_completion" },
      supportedThisSession: true,
      lastUsedOrdinal: 4,
    });
    const plan = selectTask(input({ candidates: [source], peers: [peer(source)], nextOrdinal: 6, microphoneEnabled: false }));
    expect(plan).toMatchObject({
      itemRevisionId: "rev-1", exerciseType: "letter_completion", reason: "retry-after-support", supportCycleId: "task-source",
    });
    expect(plan).not.toHaveProperty("options");

    const settled = candidate({
      support: { phase: "settled", cycleId: "task-source", sourceTaskId: "task-source", retryType: "letter_completion" },
      supportedThisSession: true,
      lastUsedOrdinal: 4,
    });
    expect(selectTask(input({ candidates: [settled], peers: [peer(settled)], nextOrdinal: 8 }))?.reason).not.toBe("retry-after-support");
  });

  it("uzupełnia historycznie brakujący kierunek reading przed rotacją sesji", () => {
    const target = candidate({
      progress: { reading: { status: "learning", nextReviewAt: PAST, streak: 3 } },
      readingEvidenceDirections: { target_to_source: 3, source_to_target: 0 },
    });
    const plan = selectTask(input({ candidates: [target], peers: [peer(target), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })], nextOrdinal: 2 }));
    expect(plan).toMatchObject({ exerciseType: "reverse_recognition", direction: "source_to_target" });
  });

  it("gdy oba kierunki są już potwierdzone, wybiera mniej ćwiczony w tej sesji", () => {
    const target = candidate({
      progress: { reading: { status: "mastered", nextReviewAt: "2026-11-07T16:00:00.000Z", streak: 3 } },
      introducedSkills: { recall: true, pronunciation: true },
      usedThisSession: 1,
      readingEvidenceDirections: { target_to_source: 1, source_to_target: 2 },
      readingDirections: { source_to_target: 1 },
    });
    const plan = selectTask(input({
      candidates: [target], peers: [peer(target), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })], nextOrdinal: 2,
    }));
    expect(plan).toMatchObject({ exerciseType: "reading", direction: "target_to_source" });
  });
});

describe("selectTask — wprowadzanie kolejnych etapów (SPEC §13)", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";

  /** Element z jednym samodzielnym sukcesem rozpoznawania ze słuchu. */
  function recognized(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
    return candidate({
      progress: { listening: { status: "learning", nextReviewAt: FUTURE, streak: 1 } },
      ...overrides,
    });
  }

  it("po samodzielnym sukcesie rozpoznawania element przechodzi do przypominania", () => {
    const plan = selectTask(
      input({ candidates: [recognized()], peers: [peer()], nextOrdinal: 1 }),
    );
    expect(plan).toMatchObject({
      itemRevisionId: "rev-1",
      exerciseType: "recall",
      assessed: true,
      reason: "stage-introduction",
    });
    // polski prompt bez gotowych odpowiedzi nie ujawnia celu
    expect(plan!.revealsTargetKeys).toEqual([]);
    expect(plan!.options).toBeUndefined();
  });

  it("wprowadzenie bierze co drugi slot — parzysty zostaje bieżącej strategii", () => {
    const plan = selectTask(
      input({ candidates: [recognized({ usedThisSession: 2 })], peers: [peer(), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })], nextOrdinal: 0 }),
    );
    expect(plan).toMatchObject({ reason: "filler-practice" });
    expect(plan!.exerciseType).not.toBe("recall");
  });

  it("wprowadzenie przeplata się z nowym materiałem, nie czeka na koniec zestawu", () => {
    const fresh = candidate({ itemRevisionId: "rev-new", position: 1, target: "Friday", source: "piątek" });
    const introduction = selectTask(
      input({ candidates: [recognized(), fresh], peers: [peer(), peer(fresh)], nextOrdinal: 1 }),
    );
    expect(introduction).toMatchObject({ itemRevisionId: "rev-1", reason: "stage-introduction" });
    const material = selectTask(
      input({ candidates: [recognized(), fresh], peers: [peer(), peer(fresh)], nextOrdinal: 0 }),
    );
    expect(material).toMatchObject({ itemRevisionId: "rev-new", reason: "new-material", exerciseType: "exposure" });
  });

  it("para etapów per element: wymowa wprowadzonego elementu wyprzedza falę nowych przypomnień", () => {
    const deeper = recognized({
      itemRevisionId: "rev-deep",
      position: 1,
      target: "Friday",
      source: "piątek",
      introducedSkills: { recall: true, pronunciation: false },
    });
    const fresh = recognized({ itemRevisionId: "rev-fresh", position: 0 });
    const plan = selectTask(
      input({ candidates: [fresh, deeper], peers: [peer(), peer(deeper)], nextOrdinal: 1 }),
    );
    expect(plan).toMatchObject({ itemRevisionId: "rev-deep", exerciseType: "speech" });
  });

  it("przypominanie wprowadzone — kolejnym etapem jest wymowa z mikrofonem", () => {
    const plan = selectTask(
      input({
        candidates: [recognized({ introducedSkills: { recall: true, pronunciation: false } })],
        peers: [peer(), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
        nextOrdinal: 1,
      }),
    );
    expect(plan).toMatchObject({ exerciseType: "speech", assessed: true, reason: "stage-introduction" });
    // widok wymowy pokazuje angielskie słowo (SPEC §12.6)
    expect(plan!.revealsTargetKeys).toEqual([KEY_THURSDAY]);
  });

  it("bez mikrofonu wymowa się nie pojawia — zostaje utrwalanie rozpoznawania", () => {
    const plan = selectTask(
      input({
        candidates: [
          recognized({
            usedThisSession: 2,
            introducedSkills: { recall: true, pronunciation: false },
          }),
        ],
        peers: [peer(), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
        nextOrdinal: 1,
        microphoneEnabled: false,
      }),
    );
    expect(plan!.exerciseType).not.toBe("speech");
    expect(plan).toMatchObject({ reason: "filler-practice" });
  });

  it("element z wprowadzonymi etapami nie wraca jako wprowadzenie", () => {
    const plan = selectTask(
      input({
        candidates: [
          recognized({
            usedThisSession: 2,
            introducedSkills: { recall: true, pronunciation: true },
          }),
        ],
        peers: [peer(), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
        nextOrdinal: 1,
      }),
    );
    expect(plan?.reason).not.toBe("stage-introduction");
    expect(plan).toMatchObject({ reason: "filler-practice" });
  });

  it("bez samodzielnego sukcesu rozpoznawania etapy się nie zaczynają", () => {
    const plan = selectTask(
      input({
        candidates: [
          recognized({ progress: { listening: { status: "learning", nextReviewAt: FUTURE, streak: 0 } } }),
        ],
        peers: [peer()],
        nextOrdinal: 1,
      }),
    );
    expect(plan?.reason).not.toBe("stage-introduction");
  });

  it("cel objęty rezerwacją nie jest wprowadzany — wymowa ujawniłaby słowo", () => {
    const plan = selectTask(
      input({
        candidates: [recognized({ introducedSkills: { recall: true, pronunciation: false } })],
        peers: [peer()],
        nextOrdinal: 1,
        reservedTargetKeys: [KEY_THURSDAY],
      }),
    );
    // jedyny element jest zarezerwowany: żadne zadanie nie może ujawnić celu
    expect(plan).toBeNull();
  });
});

describe("selectTask — listening zawsze z opcjami (kontrakt kid.ts: min 1)", () => {
  it("należna powtórka słuchu dostaje opcję poprawną i dystraktory z pominięciem rezerwacji", () => {
    const listener = candidate({
      usedThisSession: 2,
      progress: { listening: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
    });
    const sroda = peer({ itemRevisionId: "rev-w", position: 1, target: "Wednesday", source: "środa" });
    const piatek = peer({ itemRevisionId: "rev-f", position: 2, target: "Friday", source: "piątek" });
    const plan = selectTask(
      input({
        candidates: [listener],
        peers: [peer(listener), sroda, piatek],
        reservedTargetKeys: [KEY_WEDNESDAY],
      }),
    );
    expect(plan).toMatchObject({ exerciseType: "listening", reason: "due-review" });
    expect(plan!.options!.map((o) => o.text)).toEqual(["czwartek", "piątek"]);
    expect(plan!.options!.filter((o) => o.correct)).toHaveLength(1);
  });

  it("utrwalanie bez należności: słuch ma komplet opcji", () => {
    const seen = candidate({ usedThisSession: 3, practiceMix: { listening: 0, reading: 2 } });
    const piatek = peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" });
    const sroda = peer({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" });
    const plan = selectTask(input({ candidates: [seen], peers: [peer(seen), piatek, sroda] }));
    expect(plan).toMatchObject({ exerciseType: "listening", reason: "filler-practice" });
    expect(plan!.options!.map((o) => o.text)).toEqual(["czwartek", "piątek", "środa"]);
    expect(plan!.options!.filter((o) => o.correct)).toHaveLength(1);
  });

  it("talia z jednym elementem: po pierwszej prezentacji jednorazowo pokazuje bezpieczną ekspozycję", () => {
    const lonely = candidate({ usedThisSession: 3, recognitionFallbackUsedThisSession: false, practiceMix: { listening: 0, reading: 1 } });
    const plan = selectTask(input({ candidates: [lonely], peers: [peer(lonely)] }));
    expect(plan).toMatchObject({ exerciseType: "exposure", reason: "recognition-fallback", assessed: false });
    expect(plan!.revealsTargetKeys).toEqual([KEY_THURSDAY]);
  });

  it("po ukończonej ekspozycji singleton przechodzi do samodzielnego przypominania", () => {
    const lonely = candidate({ ownPresentationCompleted: true, usedThisSession: 2 });
    const plan = selectTask(input({ candidates: [lonely], peers: [peer(lonely)], microphoneEnabled: false }));
    expect(plan).toMatchObject({ exerciseType: "recall", reason: "stage-introduction", assessed: true });
  });

  it("jednorazowa ekspozycja awaryjna nie zapętla się", () => {
    const lonely = candidate({ usedThisSession: 3, recognitionFallbackUsedThisSession: true });
    expect(selectTask(input({ candidates: [lonely], peers: [peer(lonely)] }))).toBeNull();
  });

  it("chwilowo zarezerwowany dystraktor nie uruchamia ekspozycji awaryjnej", () => {
    const lonely = candidate({ usedThisSession: 3 });
    const other = peer({ itemRevisionId: "rev-other", position: 1, target: "Friday", source: "piątek" });
    expect(selectTask(input({
      candidates: [lonely],
      peers: [peer(lonely), other],
      reservedTargetKeys: [computeTargetKey("Friday", "en-GB")],
    }))).toBeNull();
  });

  it("brak dystraktora nie zastępuje należnej samodzielnej powtórki ekspozycją", () => {
    const lonely = candidate({
      usedThisSession: 3,
      recognitionFallbackUsedThisSession: false,
      progress: { listening: { status: "needs_confirmation", nextReviewAt: PAST, streak: 2 } },
    });
    expect(selectTask(input({ candidates: [lonely], peers: [peer(lonely)] }))).toBeNull();
  });
});

describe("selectTask — mikrofon i kierunki", () => {
  it("brak mikrofonu wyklucza wymowę, ale nie blokuje ćwiczenia", () => {
    const speaker = candidate({
      progress: { pronunciation: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
    });
    const withoutMic = selectTask(
      input({ candidates: [speaker], peers: [peer(speaker), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })], microphoneEnabled: false }),
    );
    expect(withoutMic).toMatchObject({ reason: "extra-practice", assessed: true });
    expect(withoutMic!.exerciseType).not.toBe("speech");
    expect(selectTask(input({ candidates: [speaker], peers: [peer(speaker)] }))).toMatchObject({
      exerciseType: "speech",
      reason: "due-review",
    });
  });

  it("reading ćwiczy kierunek o mniejszej liczbie wystąpień, dystraktory ujawniają cele", () => {
    const reader = candidate({
      progress: { reading: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
      readingDirections: { target_to_source: 2, source_to_target: 0 },
      usedThisSession: 2,
      introducedSkills: { recall: true, pronunciation: true },
    });
    const wednesday = peer({ itemRevisionId: "rev-w", position: 1, target: "Wednesday", source: "środa" });
    const friday = peer({ itemRevisionId: "rev-f", position: 2, target: "Friday", source: "piątek" });
    const plan = selectTask(input({
      candidates: [reader], peers: [peer(reader), wednesday, friday], nextOrdinal: 1,
      confusions: [{ expectedItemRevisionId: "rev-1", answeredItemRevisionId: "rev-w", exerciseType: "reverse_recognition", direction: "source_to_target", count: 2 }],
    }));
    expect(plan).toMatchObject({
      exerciseType: "reverse_recognition",
      direction: "source_to_target",
      reason: "due-review",
    });
    const texts = plan!.options!.map((o) => o.text);
    expect(texts).toContain("Thursday");
    expect(texts).toContain("Wednesday");
    expect(plan!.options?.[1]?.itemRevisionId).toBe("rev-w");
    expect([...plan!.revealsTargetKeys].sort()).toEqual([KEY_THURSDAY, KEY_WEDNESDAY, KEY_FRIDAY].sort());
  });

});

describe("selectTask — rozliczone sprawdzenia nie wracają w tej sesji (arch §9.3)", () => {
  const dueThursday = candidate({
    progress: {
      recall: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 },
      spelling: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 },
    },
  });

  it("pominięte sprawdzenie nie jest wydawane ponownie ani rezerwowane", () => {
    const other = candidate({ itemRevisionId: "rev-2", itemId: "item-2", position: 1, target: "Friday", source: "piątek", usedThisSession: 1, presentationsThisSession: 1 });
    const plan = selectTask(
      input({
        candidates: [dueThursday, other],
        peers: [peer(dueThursday), peer(other)],
        settledCheckTargetKeys: [KEY_THURSDAY],
      }),
    );
    // czwartek rozliczony: nie wraca jako due-check, nie blokuje dystraktorów ani zadań
    expect(plan).toMatchObject({ itemRevisionId: "rev-2", reason: "new-practice", exerciseType: "listening" });
    expect(plan!.options!.map((o) => o.text)).toContain("czwartek");
  });

  it("rozliczony cel może znów służyć jako dystraktor", () => {
    const reader = candidate({
      progress: { reading: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
      readingDirections: { target_to_source: 0, source_to_target: 2 },
      usedThisSession: 2,
      introducedSkills: { recall: true, pronunciation: true },
    });
    const plan = selectTask(
      input({
        candidates: [reader, dueThursday],
        peers: [peer(reader), peer(dueThursday), peer({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" })],
        settledCheckTargetKeys: [KEY_THURSDAY],
        nextOrdinal: 3,
      }),
    );
    expect(plan).toMatchObject({ exerciseType: "reading", reason: "due-review" });
    expect(plan!.options!.map((o) => o.text)).toContain("czwartek");
    expect(plan!.keepsReservations).not.toContain(KEY_THURSDAY);
  });

  it("należna powtórka rozpoznawania ma pierwszeństwo przed nowym materiałem", () => {
    const due = candidate({
      hasBeenPresented: true, usedThisSession: 2,
      progress: { listening: { status: "learning", nextReviewAt: PAST, streak: 1 } },
    });
    const unseen = candidate({ itemRevisionId: "rev-new", itemId: "item-new", position: 0, target: "Friday", source: "piątek" });
    const plan = selectTask(input({ candidates: [unseen, due], peers: [peer(unseen), peer(due), peer({ itemRevisionId: "rev-other", position: 2, target: "Monday", source: "poniedziałek" })] }));
    expect(plan).toMatchObject({ itemRevisionId: due.itemRevisionId, reason: "due-review" });
  });

  it("nie powtarza terminalnego due-review tej samej umiejętności w jednej sesji", () => {
    const settled = candidate({
      itemRevisionId: "rev-settled", position: 0, target: "Monday", source: "poniedziałek", hasBeenPresented: true,
      progress: { reading: { status: "learning", nextReviewAt: PAST, streak: 1 } }, settledReviewSkills: ["reading"],
    });
    const nextDue = candidate({
      itemRevisionId: "rev-next", position: 1, target: "Tuesday", source: "wtorek", hasBeenPresented: true,
      progress: { listening: { status: "learning", nextReviewAt: PAST, streak: 1 } },
    });
    const plan = selectTask(input({ candidates: [settled, nextDue], peers: [peer(settled), peer(nextDue), peer({ itemRevisionId: "rev-other", position: 2, target: "Friday", source: "piątek" })] }));
    expect(plan).toMatchObject({ itemRevisionId: nextDue.itemRevisionId, reason: "due-review" });
  });

  it("ponawia należną pierwszą próbę wymowy bez projekcji postępu", () => {
    const pendingSpeech = candidate({
      introducedSkills: { recall: true, pronunciation: true },
      ownPresentationCompleted: true,
      hasBeenPresented: true,
      work: { pronunciation: { reviewDueAt: PAST, eligibleAt: PAST, dueNow: true } },
    });
    const plan = selectTask(input({ candidates: [pendingSpeech], peers: [peer(pendingSpeech)] }));

    expect(plan).toMatchObject({
      itemRevisionId: pendingSpeech.itemRevisionId,
      exerciseType: "speech",
      reason: "due-review",
      skillAtIssue: "pronunciation",
    });
  });

  it("bez mikrofonu pomija należną wymowę i wybiera inne należne rozpoznawanie", () => {
    const speech = candidate({
      itemRevisionId: "rev-speech", position: 0, target: "Monday", source: "poniedziałek", usedThisSession: 2, hasBeenPresented: true,
      progress: { pronunciation: { status: "learning", nextReviewAt: "2026-10-05T00:00:00.000Z", streak: 1 } },
    });
    const reading = candidate({
      itemRevisionId: "rev-reading", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 2, hasBeenPresented: true,
      progress: { listening: { status: "learning", nextReviewAt: PAST, streak: 1 } },
    });
    const plan = selectTask(input({
      microphoneEnabled: false,
      candidates: [speech, reading],
      peers: [peer(speech), peer(reading), peer({ itemRevisionId: "rev-friday", position: 2, target: "Friday", source: "piątek" })],
    }));
    expect(plan).toMatchObject({ itemRevisionId: reading.itemRevisionId, exerciseType: "listening", reason: "due-review" });
  });

  it("po dwóch trudnych powtórkach planuje jedno bezpieczne łatwe zadanie", () => {
    const known = candidate({ usedThisSession: 2, presentationsThisSession: 1, hasBeenPresented: true });
    const plan = selectTask(input({
      candidates: [known],
      peers: [peer(known), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
      recentAssessedTasks: [
        { reason: "due-review", skill: "reading", statusAtIssue: "learning" },
        { reason: "due-check", skill: "recall", statusAtIssue: "needs_reconfirmation" },
      ],
    }));
    expect(plan).toMatchObject({ reason: "difficulty-break", assessed: true });
  });

  it("nie traktuje skipu bez oceny jako trudności przy planowaniu przerwy", () => {
    const known = candidate({ usedThisSession: 2, presentationsThisSession: 1, hasBeenPresented: true });
    const plan = selectTask(input({
      candidates: [known], peers: [peer(known), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
      recentAssessedTasks: [
        { reason: "due-review", skill: "reading", statusAtIssue: "learning" },
        { reason: "new-practice", skill: "listening", statusAtIssue: null },
      ],
    }));
    expect(plan?.reason).not.toBe("difficulty-break");
  });

  it("nie ujawnia zarezerwowanego celu jako przerwy po trudnych zadaniach", () => {
    const reserved = candidate({
      progress: { recall: { status: "needs_confirmation", nextReviewAt: PAST, streak: 3 } },
      usedThisSession: 2, presentationsThisSession: 1,
    });
    const plan = selectTask(input({
      candidates: [reserved], peers: [peer(reserved), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })],
      recentAssessedTasks: [
        { reason: "due-review", skill: "listening", statusAtIssue: "learning" },
        { reason: "due-check", skill: "recall", statusAtIssue: "learning" },
      ],
    }));
    expect(plan).toMatchObject({ reason: "due-check", assessed: true });
    expect(plan!.revealsTargetKeys).toEqual([]);
  });

  it("nie ujawnia zarezerwowanego celu jako nowego materiału, gdy brak bezpiecznego kandydata na przerwę", () => {
    const unseen = candidate();
    const plan = selectTask(input({
      candidates: [unseen], peers: [peer(unseen)], reservedTargetKeys: [KEY_THURSDAY],
      recentAssessedTasks: [
        { reason: "due-review", skill: "listening", statusAtIssue: "learning" },
        { reason: "due-review", skill: "reading", statusAtIssue: "needs_reconfirmation" },
      ],
    }));
    expect(plan).toBeNull();
  });
});

describe("selectTask — extra-practice: ćwiczenie bez blokady harmonogramu", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";

  function startedCandidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
    return candidate({
      progress: { listening: { status: "learning", nextReviewAt: FUTURE, streak: 0 } },
      ...overrides,
    });
  }

  it("świeża sesja z samymi przyszłymi powtórkami wydaje utrwalanie rozpoznawania", () => {
    const a = startedCandidate({ itemRevisionId: "rev-a", position: 0 });
    const b = startedCandidate({
      itemRevisionId: "rev-b",
      position: 1,
      target: "Friday",
      source: "piątek",
      progress: { listening: { status: "needs_confirmation", nextReviewAt: FUTURE, streak: 3 } },
    });
    const plan = selectTask(input({ candidates: [a, b], peers: [peer(a), peer(b)] }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-a", reason: "extra-practice", assessed: true });
    expect(plan!.options!.filter((o) => o.correct).map((o) => o.text)).toEqual(["czwartek"]);
  });

  it("naprzemiennie słuch i tekst wg parzystości ordinalu", () => {
    const a = startedCandidate({ itemRevisionId: "rev-a", position: 0 });
    const peers = [peer(a), peer({ itemRevisionId: "rev-f", position: 1, target: "Friday", source: "piątek" })];
    const listening = selectTask(input({ candidates: [a], peers, nextOrdinal: 0 }));
    expect(listening).toMatchObject({ exerciseType: "listening", reason: "extra-practice" });
    const reading = selectTask(input({ candidates: [a], peers, nextOrdinal: 1 }));
    expect(reading).toMatchObject({
      exerciseType: "reading",
      direction: "target_to_source",
      reason: "extra-practice",
    });
  });

  it("cel objęty rezerwacją kontekstu nie jest celem utrwalania", () => {
    const reservedItem = startedCandidate({ itemRevisionId: "rev-r", position: 0 });
    const other = startedCandidate({
      itemRevisionId: "rev-o",
      position: 1,
      target: "Friday",
      source: "piątek",
    });
    const third = peer({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" });
    // rezerwacja utrzymywana w kontekście sesji chroni czwartek także w utrwalaniu
    const plan = selectTask(
      input({
        candidates: [reservedItem, other],
        peers: [peer(reservedItem), peer(other), third],
        reservedTargetKeys: [KEY_THURSDAY],
        nextOrdinal: 2,
      }),
    );
    expect(plan).toMatchObject({ itemRevisionId: "rev-o", reason: "extra-practice" });
    expect(plan!.options!.map((o) => o.text)).not.toContain("czwartek");
  });

  it("elementy w pełni opanowane idą na koniec kolejki", () => {
    const mastered = startedCandidate({
      itemRevisionId: "rev-m",
      position: 0,
      progress: { listening: { status: "mastered", nextReviewAt: FUTURE, streak: 3 } },
    });
    const learning = startedCandidate({
      itemRevisionId: "rev-l",
      position: 1,
      target: "Friday",
      source: "piątek",
    });
    const plan = selectTask(input({ candidates: [mastered, learning], peers: [peer(mastered), peer(learning)] }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-l", reason: "extra-practice" });
  });

  it("nieprzerobiony element to nadal nowy materiał, nie utrwalanie", () => {
    const plan = selectTask(input({ candidates: [candidate()], peers: [peer()] }));
    expect(plan).toMatchObject({ reason: "new-material", exerciseType: "exposure" });
  });
});

describe("selectTask — rotacja rozpoczętego zestawu (regresja „zawsze styczeń”)", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";
  const MONTHS = [
    "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
    "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
  ];

  /** Element „Miesiący”: listening w trakcie nauki, powtórka dopiero jutro. */
  function monthCandidate(position: number, lastContactAt: string | null): ScheduleCandidate {
    return candidate({
      itemRevisionId: `rev-${position}`,
      itemId: `item-${position}`,
      position,
      target: `target-${position}`,
      source: MONTHS[position]!,
      lastContactAt,
      progress: { listening: { status: "learning", nextReviewAt: FUTURE, streak: 0 } },
    });
  }

  function monthPeers(items: readonly ScheduleCandidate[]): SchedulePeer[] {
    return items.map((c) =>
      peer({ itemRevisionId: c.itemRevisionId, position: c.position, target: c.target, source: c.source }),
    );
  }

  /** 12 miesięcy rozpoczętych o 08:38; „styczeń” (pozycja 0) miał kontakt najpóźniej. */
  function startedMonths(): ScheduleCandidate[] {
    return MONTHS.map((_, position) =>
      monthCandidate(position, position === 0 ? "2026-10-08T11:56:00.000Z" : "2026-10-08T08:38:43.000Z"),
    );
  }

  /** Puszcza budżet sesji, lokalnie licząc użycia; zwraca kolejne wybory. */
  function runSession(items: ScheduleCandidate[], steps: number): string[] {
    const used = new Map(items.map((c) => [c.itemRevisionId, 0]));
    const picks: string[] = [];
    for (let ordinal = 0; ordinal < steps; ordinal++) {
      const plan = selectTask(
        input({
          candidates: items.map((c) => ({ ...c, usedThisSession: used.get(c.itemRevisionId) ?? 0 })),
          peers: monthPeers(items),
          nextOrdinal: ordinal,
          assessedRemaining: steps - ordinal,
        }),
      );
      if (!plan) break;
      picks.push(plan.itemRevisionId);
      used.set(plan.itemRevisionId, (used.get(plan.itemRevisionId) ?? 0) + 1);
    }
    return picks;
  }

  it("start sesji omija pozycję 0: najpierw najdawniej widziany element", () => {
    const items = startedMonths();
    const [first] = runSession(items, 1);
    expect(first).toBe("rev-1"); // luty — kontakt z 08:38, „styczeń” widziany później
  });

  it("pełny budżet rozkłada się na wszystkie elementy bez powtórek pod rząd", () => {
    const picks = runSession(startedMonths(), 12);
    expect(picks).toHaveLength(12);
    expect(new Set(picks).size).toBe(12); // każdy element dokładnie raz
    // „styczeń” (najświeższy kontakt) idzie na koniec kolejki
    expect(picks.indexOf("rev-0")).toBe(11);
  });

  it("po dwóch błędach wsparcie, potem inne elementy i retry dopiero po przerwie", () => {
    const items = startedMonths();
    // czerwiec (rev-5): dwa błędy w tej sesji
    const withFailure = items.map((c) =>
      c.itemRevisionId === "rev-5"
        ? { ...c, failuresThisSession: 2, usedThisSession: 2, lastUsedOrdinal: 3 }
        : c,
    );
    const support = selectTask(input({ candidates: withFailure, peers: monthPeers(items), nextOrdinal: 4 }));
    expect(support).toMatchObject({ itemRevisionId: "rev-5", exerciseType: "exposure", reason: "support" });

    const afterSupport = withFailure.map((c) =>
      c.itemRevisionId === "rev-5"
        ? { ...c, supportedThisSession: true, usedThisSession: 3, lastUsedOrdinal: 4 }
        : c,
    );
    // przerwa za krótka (1 zadanie): czerwiec czeka, sesja idzie dalej innym elementem
    const gap1 = selectTask(input({ candidates: afterSupport, peers: monthPeers(items), nextOrdinal: 5 }));
    expect(gap1!.itemRevisionId).not.toBe("rev-5");
    // po dwóch innych zadaniach wraca łatwe rozpoznawanie ze słuchu
    const retry = selectTask(input({ candidates: afterSupport, peers: monthPeers(items), nextOrdinal: 6 }));
    expect(retry).toMatchObject({ itemRevisionId: "rev-5", exerciseType: "listening", reason: "retry-after-support" });
  });

  it("zadanie utrwalania nie czyni elementu „raz pokazanym” do natychmiastowej powtórki", () => {
    const items = startedMonths();
    // po pierwszym zadaniu „lutego” (utrwalanie, nie prezentacja) kolejne zadanie
    // nie może być natychmiastową powtórką tego samego elementu
    const afterFirst = items.map((c) => (c.itemRevisionId === "rev-1" ? { ...c, usedThisSession: 1 } : c));
    const plan = selectTask(input({ candidates: afterFirst, peers: monthPeers(afterFirst), nextOrdinal: 1 }));
    expect(plan!.itemRevisionId).not.toBe("rev-1");
  });
});

describe("hasScheduledWork — rekomendacja zestawu na liście dziecka", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";

  it("brak postępu oznacza nowy materiał do nauki", () => {
    expect(hasScheduledWork([{ progress: [] }], NOW)).toBe(true);
  });

  it("wyłącznie niezaocenione umiejętności to nadal nowy materiał", () => {
    expect(
      hasScheduledWork([{ progress: [{ skill: "listening", status: "not_assessed", nextReviewAt: PAST, streak: 0 }] }], NOW),
    ).toBe(true);
  });

  it("należna powtórka czyni zestaw rekomendowanym", () => {
    expect(
      hasScheduledWork([{ progress: [{ skill: "listening", status: "learning", nextReviewAt: PAST, streak: 0 }] }], NOW),
    ).toBe(true);
  });

  it("rozpoczęty materiał z samymi przyszłymi terminami nie jest rekomendowany", () => {
    expect(
      hasScheduledWork([{ progress: [{ skill: "listening", status: "learning", nextReviewAt: FUTURE, streak: 0 }] }], NOW),
    ).toBe(false);
  });

  it("rekomenduje zachowany sprawdzian dopiero po jego terminie", () => {
    const item = { progress: [], pendingCheckAt: FUTURE };
    expect(hasScheduledWork([item], NOW)).toBe(false);
    expect(hasScheduledWork([item], FUTURE)).toBe(true);
  });

  it("nie odkłada wprowadzenia Recall po rozpoznaniu materiału", () => {
    expect(hasScheduledWork([{ progress: [], recallIntroductionNeeded: true }], NOW)).toBe(true);
  });

  it("rozpoznany element bez wprowadzonego przypominania ma zaplanowane wprowadzenie etapu", () => {
    expect(
      hasScheduledWork([{ progress: [{ skill: "listening", status: "learning", nextReviewAt: FUTURE, streak: 1 }] }], NOW),
    ).toBe(true);
  });

  it("przypominanie sprawdzone, wymowa nie — rekomendacja nie zależy od mikrofonu", () => {
    expect(
      hasScheduledWork(
        [
          {
            progress: [
              { skill: "listening", status: "learning", nextReviewAt: FUTURE, streak: 1 },
              { skill: "recall", status: "learning", nextReviewAt: FUTURE, streak: 1 },
            ],
          },
        ],
        NOW,
      ),
    ).toBe(false);
  });
});
