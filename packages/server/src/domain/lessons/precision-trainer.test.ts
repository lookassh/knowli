import { describe, expect, it } from "vitest";
import { compareRevision, isUnchangedRevision, shouldOfferShorten, SESSION_PROMISE_REMAINING } from "./precision-trainer";

const verbose = { knowledge: "correct", precision: "verbose", redundantFragments: ["i jest zielona"] };
const offer = { trainingSession: true, followUp: false, details: verbose, graderCallsLeft: 3, remainingWithThisTask: 6 };

describe("shouldOfferShorten", () => {
  it("proponuje skrócenie poprawnej, rozwlekłej odpowiedzi z fragmentem do usunięcia", () => {
    expect(shouldOfferShorten(offer)).toBe(true);
    expect(shouldOfferShorten({ ...offer, details: { ...verbose, precision: "unfocused" } })).toBe(true);
  });

  it("proponuje tuż przed obietnicą końca sesji (baner pojawi się dopiero po zadaniu następczym)", () => {
    expect(shouldOfferShorten({ ...offer, remainingWithThisTask: SESSION_PROMISE_REMAINING + 1 })).toBe(true);
  });

  it("proponuje też przy naruszonej formie jednego zdania bez fragmentów", () => {
    expect(shouldOfferShorten({ ...offer, details: { knowledge: "correct", precision: "verbose", formOk: false } })).toBe(true);
  });

  it.each([
    ["zwięzła odpowiedź", { details: { ...verbose, precision: "concise" } }],
    ["niepełna wiedza", { details: { ...verbose, knowledge: "partial" } }],
    ["brak fragmentów i forma w porządku", { details: { knowledge: "correct", precision: "verbose", redundantFragments: [] } }],
    ["kartkówka", { trainingSession: false }],
    ["poprawka (bez łańcucha poprawek)", { followUp: true }],
    ["brak wywołań gradera", { graderCallsLeft: 0 }],
    ["faza obietnicy końca sesji", { remainingWithThisTask: SESSION_PROMISE_REMAINING }],
  ] as const)("nie proponuje: %s", (_label, overrides) => {
    expect(shouldOfferShorten({ ...offer, ...overrides })).toBe(false);
  });
});

describe("poprawka odpowiedzi", () => {
  it("rozpoznaje poprawkę bez zmian mimo spacji i wielkości liter", () => {
    expect(isUnchangedRevision("Roślina robi cukry.", "  roślina   robi CUKRY. ")).toBe(true);
    expect(isUnchangedRevision("Roślina robi cukry i jest zielona.", "Roślina robi cukry.")).toBe(false);
  });

  it("wykrywa utratę elementu trafionego w oryginale i skrócenie", () => {
    expect(compareRevision({
      originalMatchedElementIds: ["e1", "e2"],
      originalAnswer: "Roślina robi cukry ze światła i jest zielona.",
      revisionAnswer: "Roślina robi cukry.",
      revisionDetails: { missingElementIds: ["e2"] },
    })).toEqual({ lostElementIds: ["e2"], shorter: true });
  });

  it("brak w poprawce elementu, którego nie było w oryginale, nie jest utratą", () => {
    expect(compareRevision({
      originalMatchedElementIds: ["e1"],
      originalAnswer: "Roślina robi cukry.",
      revisionAnswer: "Roślina robi cukry, tak.",
      revisionDetails: { missingElementIds: ["e2"] },
    })).toEqual({ lostElementIds: [], shorter: false });
  });
});
