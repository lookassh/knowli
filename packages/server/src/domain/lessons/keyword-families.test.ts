import { describe, expect, it } from "vitest";
import { familyRunSuffix } from "./keyword-families";

describe("familyRunSuffix", () => {
  const scope = "A1b2-C3d4:9f8e7d6c-0000:3:0";

  it("sufiks: „-r” i 6 pierwszych znaków szesnastkowych zakresu małymi literami", () => {
    expect(familyRunSuffix(scope)).toBe("-ra1b2c3");
    expect(familyRunSuffix("xyz")).toBe("-r");
  });
});
