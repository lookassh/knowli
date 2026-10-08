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
    usedThisSession: 0,
    lastUsedOrdinal: null,
    readingDirections: {},
    practiceMix: { listening: 0, reading: 0 },
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
    const a = candidate({ itemRevisionId: "rev-a", position: 0, target: "Monday", source: "poniedziałek", usedThisSession: 1 });
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 2, target: "Wednesday", source: "środa" });
    const peers = [peer(a), peer(b), peer(c)] as SchedulePeer[];
    const plan = selectTask(input({ candidates: [a, b, c], peers }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-a", exerciseType: "listening", reason: "new-practice", assessed: true });
  });
});

describe("selectTask — rezerwacje należnych sprawdzeń (arch §9.3)", () => {
  it("należne sprawdzenie Recall i pisowni ma pierwszeństwo i zbiera oba wyniki z jednej odpowiedzi", () => {
    const due = candidate({
      progress: {
        recall: { status: "needs_confirmation", nextReviewAt: PAST },
        spelling: { status: "needs_confirmation", nextReviewAt: PAST },
      },
    });
    const plan = selectTask(input({ candidates: [due], peers: [peer(due)] }));
    expect(plan).toMatchObject({ exerciseType: "recall", assessed: true, reason: "due-check" });
    // polski prompt bez gotowych odpowiedzi nie ujawnia celu
    expect(plan!.revealsTargetKeys).toEqual([]);
    expect(plan!.options).toBeUndefined();
  });

  it("najstarsza należność jest sprawdzana pierwsza", () => {
    const older = candidate({
      itemRevisionId: "rev-old",
      position: 0,
      progress: { recall: { status: "needs_confirmation", nextReviewAt: "2026-10-05T16:00:00.000Z" } },
    });
    const newer = candidate({
      itemRevisionId: "rev-new",
      position: 1,
      progress: { recall: { status: "needs_confirmation", nextReviewAt: "2026-10-06T16:00:00.000Z" } },
    });
    const plan = selectTask(input({ candidates: [newer, older], peers: [peer(older), peer(newer)] }));
    expect(plan!.itemRevisionId).toBe("rev-old");
  });

  it("zarezerwowany cel nie pojawia się jako dystraktor", () => {
    const reserved = candidate({ itemRevisionId: "rev-w", position: 2, target: "Wednesday", source: "środa" });
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 0, target: "Friday", source: "piątek", usedThisSession: 1 });
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
    const b = candidate({ itemRevisionId: "rev-b", position: 1, target: "Tuesday", source: "wtorek", usedThisSession: 1 });
    const c = candidate({ itemRevisionId: "rev-c", position: 0, target: "Friday", source: "piątek", usedThisSession: 1 });
    const plan = selectTask(input({ candidates: [freed, b, c], peers: [peer(freed), peer(b), peer(c)] }));
    expect(plan!.options!.map((o) => o.text)).toContain("środa");
  });

  it("cel objęty rezerwacją nie wraca do zadań rozpoznawania", () => {
    const reserved = candidate({
      progress: { listening: { status: "needs_confirmation", nextReviewAt: PAST } },
    });
    const other = candidate({
      itemRevisionId: "rev-2",
      position: 1,
      target: "Friday",
      source: "piątek",
      progress: { listening: { status: "needs_confirmation", nextReviewAt: "2026-10-06T17:00:00.000Z" } },
    });
    const plan = selectTask(
      input({
        candidates: [reserved, other],
        peers: [peer(reserved), peer(other)],
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
});

describe("selectTask — listening zawsze z opcjami (kontrakt kid.ts: min 1)", () => {
  it("należna powtórka słuchu dostaje opcję poprawną i dystraktory z pominięciem rezerwacji", () => {
    const listener = candidate({
      usedThisSession: 2,
      progress: { listening: { status: "needs_confirmation", nextReviewAt: PAST } },
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

  it("talia z jednym elementem: opcja poprawna istnieje mimo braku dystraktorów", () => {
    const lonely = candidate({ usedThisSession: 3, practiceMix: { listening: 0, reading: 1 } });
    const plan = selectTask(input({ candidates: [lonely], peers: [peer(lonely)] }));
    expect(plan).toMatchObject({ exerciseType: "listening", reason: "filler-practice" });
    expect(plan!.options!.filter((o) => o.correct).map((o) => o.text)).toEqual(["czwartek"]);
  });
});

describe("selectTask — mikrofon i kierunki", () => {
  it("brak mikrofonu wyklucza wymowę, ale nie blokuje ćwiczenia", () => {
    const speaker = candidate({
      progress: { pronunciation: { status: "needs_confirmation", nextReviewAt: PAST } },
    });
    const withoutMic = selectTask(
      input({ candidates: [speaker], peers: [peer(speaker)], microphoneEnabled: false }),
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
      progress: { reading: { status: "needs_confirmation", nextReviewAt: PAST } },
      readingDirections: { target_to_source: 2, source_to_target: 0 },
      usedThisSession: 2,
    });
    const wednesday = peer({ itemRevisionId: "rev-w", position: 1, target: "Wednesday", source: "środa" });
    const friday = peer({ itemRevisionId: "rev-f", position: 2, target: "Friday", source: "piątek" });
    const plan = selectTask(input({ candidates: [reader], peers: [peer(reader), wednesday, friday] }));
    expect(plan).toMatchObject({
      exerciseType: "reverse_recognition",
      direction: "source_to_target",
      reason: "due-review",
    });
    const texts = plan!.options!.map((o) => o.text);
    expect(texts).toContain("Thursday");
    expect(texts).toContain("Wednesday");
    expect([...plan!.revealsTargetKeys].sort()).toEqual([KEY_THURSDAY, KEY_WEDNESDAY, KEY_FRIDAY].sort());
  });
});

describe("selectTask — rozliczone sprawdzenia nie wracają w tej sesji (arch §9.3)", () => {
  const dueThursday = candidate({
    progress: {
      recall: { status: "needs_confirmation", nextReviewAt: PAST },
      spelling: { status: "needs_confirmation", nextReviewAt: PAST },
    },
  });

  it("pominięte sprawdzenie nie jest wydawane ponownie ani rezerwowane", () => {
    const other = candidate({ itemRevisionId: "rev-2", itemId: "item-2", position: 1, target: "Friday", source: "piątek", usedThisSession: 1 });
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
      progress: { reading: { status: "needs_confirmation", nextReviewAt: PAST } },
      readingDirections: { target_to_source: 0, source_to_target: 2 },
      usedThisSession: 2,
    });
    const plan = selectTask(
      input({
        candidates: [reader, dueThursday],
        peers: [peer(reader), peer(dueThursday)],
        settledCheckTargetKeys: [KEY_THURSDAY],
        nextOrdinal: 3,
      }),
    );
    expect(plan).toMatchObject({ exerciseType: "reading", reason: "due-review" });
    expect(plan!.options!.map((o) => o.text)).toContain("czwartek");
    expect(plan!.keepsReservations).not.toContain(KEY_THURSDAY);
  });
});

describe("selectTask — extra-practice: ćwiczenie bez blokady harmonogramu", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";

  function startedCandidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
    return candidate({
      progress: { listening: { status: "learning", nextReviewAt: FUTURE } },
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
      progress: { listening: { status: "needs_confirmation", nextReviewAt: FUTURE } },
    });
    const plan = selectTask(input({ candidates: [a, b], peers: [peer(a), peer(b)] }));
    expect(plan).toMatchObject({ itemRevisionId: "rev-a", reason: "extra-practice", assessed: true });
    expect(plan!.options!.filter((o) => o.correct).map((o) => o.text)).toEqual(["czwartek"]);
  });

  it("naprzemiennie słuch i tekst wg parzystości ordinalu", () => {
    const a = startedCandidate({ itemRevisionId: "rev-a", position: 0 });
    const peers = [peer(a)];
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
    // rezerwacja utrzymywana w kontekście sesji chroni czwartek także w utrwalaniu
    const plan = selectTask(
      input({
        candidates: [reservedItem, other],
        peers: [peer(reservedItem), peer(other)],
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
      progress: { listening: { status: "mastered", nextReviewAt: FUTURE } },
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

describe("hasScheduledWork — rekomendacja zestawu na liście dziecka", () => {
  const FUTURE = "2026-10-08T16:00:00.000Z";

  it("brak postępu oznacza nowy materiał do nauki", () => {
    expect(hasScheduledWork([{ progress: [] }], NOW)).toBe(true);
  });

  it("wyłącznie niezaocenione umiejętności to nadal nowy materiał", () => {
    expect(hasScheduledWork([{ progress: [{ status: "not_assessed", nextReviewAt: PAST }] }], NOW)).toBe(true);
  });

  it("należna powtórka czyni zestaw rekomendowanym", () => {
    expect(
      hasScheduledWork([{ progress: [{ status: "learning", nextReviewAt: PAST }] }], NOW),
    ).toBe(true);
  });

  it("rozpoczęty materiał z samymi przyszłymi terminami nie jest rekomendowany", () => {
    expect(hasScheduledWork([{ progress: [{ status: "learning", nextReviewAt: FUTURE }] }], NOW)).toBe(false);
  });
});
