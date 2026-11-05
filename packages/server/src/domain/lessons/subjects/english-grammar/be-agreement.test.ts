import { describe, expect, it } from "vitest";

import { checkBePolarity, expectedBeFormNearGap } from "./be-agreement";

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

  it("checkBePolarity: twierdzenie z przeczeniem i przeczenie bez not", () => {
    const errors: string[] = [];
    checkBePolarity("affirmative", true, undefined, "answer", errors);
    checkBePolarity("negative", false, undefined, "answer", errors);
    checkBePolarity("any", true, "yes", "answer", errors);
    expect(errors).toEqual([
      "answer: forma przecząca nie pasuje do celu twierdzącego",
      "answer: brak przeczenia (not) wymaganego przez cel",
      "answer: odpowiedź po „Yes” nie może być przeczeniem",
    ]);
  });

  it("checkBePolarity: dowolna biegunowość bez Yes/No nie zgłasza błędu", () => {
    const errors: string[] = [];
    checkBePolarity("any", true, undefined, "answer", errors);
    checkBePolarity("any", false, undefined, "answer", errors);
    expect(errors).toEqual([]);
  });
});
