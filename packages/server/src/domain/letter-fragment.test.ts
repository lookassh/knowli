import { describe, expect, it } from "vitest";
import { buildLetterFragment } from "./letter-fragment";

describe("buildLetterFragment", () => {
  it("reveals every other letter while hiding at least one", () => {
    expect(buildLetterFragment("Monday")).toBe("M_n_a_");
    expect(buildLetterFragment("A")).toBe("_");
    expect(buildLetterFragment("Hi")).toBe("H_");
  });

  it("keeps spaces and punctuation while masking letters only", () => {
    expect(buildLetterFragment("New York!")).toBe("N_w Y_r_!");
  });
});
