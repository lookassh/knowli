import { describe, expect, it } from "vitest";
import { qualifyAttempt } from "./independence";
import { LEARNING_V1_POLICY } from "../policies/learning-v1";
import type { AssistanceKind, EvaluationContext } from "./types";

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    receivedAt: "2026-10-07T16:00:00.000Z",
    policy: LEARNING_V1_POLICY,
    lastExposureAt: null,
    firstTry: true,
    assistance: [],
    previousSessionContactAt: null,
    timezone: "Europe/Warsaw",
    ...overrides,
  };
}

describe("qualifyAttempt — niezależność próby (SPEC §18.1)", () => {
  it("czysty kontekst jest niezależnym sprawdzeniem", () => {
    expect(qualifyAttempt(ctx())).toEqual({ independent: true, confirmationEligible: false });
  });

  it("kolejna próba w tym samym zadaniu to utrwalanie, nie niezależne sprawdzenie", () => {
    expect(qualifyAttempt(ctx({ firstTry: false }))).toMatchObject({
      independent: false,
      reason: "not_first_try",
    });
  });

  it("każde wsparcie dyskwalifikuje niezależność", () => {
    const cases: readonly (readonly AssistanceKind[])[] = [
      ["model_audio"],
      ["options"],
      ["visible_letters"],
      ["answer_reveal"],
      ["hint"],
    ];
    for (const assistance of cases) {
      expect(qualifyAttempt(ctx({ assistance }))).toMatchObject({ independent: false, reason: "assisted" });
    }
  });

  it("brak znanego ujawnienia nie blokuje niezależności", () => {
    expect(qualifyAttempt(ctx({ lastExposureAt: null })).independent).toBe(true);
  });

  it("299 sekund od ujawnienia rozwiązania nie kwalifikuje; 300 sekund kwalifikuje", () => {
    expect(
      qualifyAttempt(ctx({ lastExposureAt: "2026-10-07T15:55:01.000Z" })).reason,
    ).toBe("recent_exposure");
    expect(
      qualifyAttempt(ctx({ lastExposureAt: "2026-10-07T15:55:00.000Z" })).independent,
    ).toBe(true);
  });

  it("przyczyna jest deterministyczna: not_first_try przed assisted", () => {
    const qualified = qualifyAttempt(
      ctx({ firstTry: false, assistance: ["model_audio"], lastExposureAt: "2026-10-07T15:59:00.000Z" }),
    );
    expect(qualified.reason).toBe("not_first_try");
  });
});

describe("qualifyAttempt — potwierdzenie po przerwie (SPEC §18.3, A30)", () => {
  it("pierwszy kontakt z elementem nie jest potwierdzeniem po przerwie", () => {
    expect(qualifyAttempt(ctx({ previousSessionContactAt: null })).confirmationEligible).toBe(false);
  });

  it("23:59 → 00:01 to zmiana dnia bez wymaganych 12 godzin", () => {
    const qualified = qualifyAttempt(
      ctx({ previousSessionContactAt: "2026-10-07T21:59:00.000Z", receivedAt: "2026-10-07T22:01:00.000Z" }),
    );
    expect(qualified.independent).toBe(true);
    expect(qualified.confirmationEligible).toBe(false);
  });

  it("12 godzin w tym samym dniu lokalnym nie wystarcza — wymagany jest inny dzień", () => {
    const qualified = qualifyAttempt(
      ctx({ previousSessionContactAt: "2026-10-07T06:00:00.000Z", receivedAt: "2026-10-07T18:00:00.000Z" }),
    );
    expect(qualified.confirmationEligible).toBe(false);
  });

  it("dokładnie 12 godzin innego dnia lokalnego kwalifikuje potwierdzenie", () => {
    const qualified = qualifyAttempt(
      ctx({ previousSessionContactAt: "2026-10-06T18:00:00.000Z", receivedAt: "2026-10-07T06:00:00.000Z" }),
    );
    expect(qualified.confirmationEligible).toBe(true);
  });

  it("DST Europe/Warsaw, przejście jesienne: 12 godzin absolutnych wygrywa z 11 godzinami zegarowymi", () => {
    // 2026-10-24 23:30 CEST → 2026-10-25 10:30 CET: zegar wskazuje 11 h, absolutnie 12 h.
    const qualified = qualifyAttempt(
      ctx({ previousSessionContactAt: "2026-10-24T21:30:00.000Z", receivedAt: "2026-10-25T09:30:00.000Z" }),
    );
    expect(qualified.confirmationEligible).toBe(true);
  });

  it("DST Europe/Warsaw, przejście wiosenne: 12 godzin zegarowych to tylko 11 absolutnych", () => {
    // 2027-03-27 22:30 CET → 2027-03-28 10:30 CEST: zegar wskazuje 12 h, absolutnie 11 h.
    const qualified = qualifyAttempt(
      ctx({ previousSessionContactAt: "2027-03-27T21:30:00.000Z", receivedAt: "2027-03-28T08:30:00.000Z" }),
    );
    expect(qualified.confirmationEligible).toBe(false);
  });
});
