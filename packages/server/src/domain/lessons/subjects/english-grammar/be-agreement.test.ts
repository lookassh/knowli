import { describe, expect, it } from "vitest";

import { beAgreementInSentence, checkBePolarity, expectedBeFormNearGap } from "./be-agreement";

describe("be-agreement", () => {
  it("expectedBeFormNearGap dla podmiotów PC (bodziec po usunięciu nawiasu)", () => {
    expect(expectedBeFormNearGap("Łucja ___ a book now.")).toBe("is");
    expect(expectedBeFormNearGap("James ___ a book now.")).toBe("is");
    expect(expectedBeFormNearGap("The children ___ football now.")).toBe("are");
    expect(expectedBeFormNearGap("The mice ___ cheese now.")).toBe("are");
    expect(expectedBeFormNearGap("Tom and Ola ___ now.")).toBe("are");
    expect(expectedBeFormNearGap("They always ___ football now.")).toBe("are");
    expect(expectedBeFormNearGap("Every day Ola ___ a comic.")).toBe("is");
    expect(expectedBeFormNearGap("What ___ they doing?")).toBe("are");
  });

  it("beAgreementInSentence", () => {
    expect(beAgreementInSentence("They is playing now.")).toEqual({ form: "is", expected: "are" });
    expect(beAgreementInSentence("Look! The dogs are running.")).toEqual({ form: "are", expected: "are" });
    expect(beAgreementInSentence("Is she reading?")).toEqual({ form: "is", expected: "is" });
    expect(beAgreementInSentence("He's playing now.")).toEqual({ form: "is", expected: "is" });
    expect(beAgreementInSentence("Ola reads every day.")).toBeUndefined();
  });

  it("checkBePolarity: twierdzenie z przeczeniem i przeczenie bez not", () => {
    const errors: string[] = [];
    checkBePolarity("affirmative", true, undefined, "answer", errors);
    checkBePolarity("negative", false, undefined, "answer", errors);
    checkBePolarity("any", true, "yes", "answer", errors);
    expect(errors).toHaveLength(3);
  });
});
