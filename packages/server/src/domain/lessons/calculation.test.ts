import { describe, expect, it } from "vitest";
import type { CalculationSpec } from "@learning/contracts";
import { computeCalculationAnswer, renderCalculationPrompt, parseCalculationAnswer, evaluateCalculationAnswer } from "./calculation";

const scale: CalculationSpec = {
  kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 },
  unit: "m", templateFamilyId: "map-scale",
};
const height: CalculationSpec = {
  kind: "height_difference", params: { upperHeightM: 400, lowerHeightM: 150 },
  unit: "m", templateFamilyId: "height",
};
const conversion: CalculationSpec = {
  kind: "unit_conversion", params: { value: 0.75, fromUnit: "km" },
  unit: "m", templateFamilyId: "conversion",
};

describe("exact calculation answers and prompts", () => {
  it.each([
    [scale, { value: 750, unit: "m", answer: "750 m" }, "Na mapie w skali 1:25 000 odcinek ma 3 cm. Oblicz odległość w terenie w m."],
    [height, { value: 250, unit: "m", answer: "250 m" }, "Punkt wyższy: 400 m n.p.m., punkt niższy: 150 m n.p.m. Oblicz różnicę wysokości w m."],
    [conversion, { value: 750, unit: "m", answer: "750 m" }, "Przelicz 0,75 km na m."],
    [{ ...height, params: { upperHeightM: -50, lowerHeightM: -100 } }, { value: 50, unit: "m", answer: "50 m" }, "Punkt wyższy: -50 m n.p.m., punkt niższy: -100 m n.p.m. Oblicz różnicę wysokości w m."],
  ] as const)("computes and renders %j", (spec, answer, prompt) => {
    expect(computeCalculationAnswer(spec)).toEqual(answer);
    expect(renderCalculationPrompt(spec)).toBe(prompt);
  });

  it("keeps fractional and large answers exact instead of formatting the approximate number", () => {
    const large: CalculationSpec = { ...scale, params: { mapDistanceCm: 999999.999, scaleDenominator: 999999999 } };
    expect(computeCalculationAnswer(large).answer).toBe("9999999980000,00001 m");
    expect(evaluateCalculationAnswer("9999999980000,00001 m", large)).toBe("correct");
    expect(evaluateCalculationAnswer("9999999980000 m", large)).toBe("incorrect");
    expect(evaluateCalculationAnswer("9999999980000,000010001 m", large)).toBe("incorrect");
    expect(computeCalculationAnswer({ ...conversion, params: { value: 0.001, fromUnit: "cm" }, unit: "km" }).answer).toBe("0,00000001 km");
  });
});

describe("Polish calculation answer parser", () => {
  it.each([
    ["1\u00a0234,5 m", { value: 1234.5, unit: "m" }],
    ["+1\u202f234\u202f567,123456789 KM", { value: 1234567.123456789, unit: "km" }],
    [" -1 234,5 cm ", { value: -1234.5, unit: "cm" }],
    ["1\u202f234", { value: 1234, unit: null }],
    ["-0,001", { value: -0.001, unit: null }],
    ["750m", { value: 750, unit: "m" }],
    ["0", { value: 0, unit: null }],
  ])("parses the entire answer %j", (text, expected) => {
    expect(parseCalculationAnswer(text as string)).toEqual(expected);
  });

  it.each(["1,2,3", "12 34", "750 m bo tak", "NaN", "Infinity", "1e3", "1.234", "1.5", "1,", ",5", "1,1234567890", "750 mm", "", " ", "--1", "1 2345", "1\n234", "750 m\nbo tak"])("rejects ambiguous or partial input %j", (text) => {
    expect(parseCalculationAnswer(text)).toBeNull();
  });
});

describe("deterministic calculation evaluation", () => {
  it.each([
    ["750", "correct"], ["0,75 km", "correct"], ["75 000 cm", "correct"],
    ["750 km", "incorrect"], ["-750 m", "incorrect"], ["749,999999999 m", "incorrect"],
    ["nie wiem", "unevaluated"], ["750 m bo tak", "unevaluated"],
  ])("evaluates %j as %s", (text, result) => {
    expect(evaluateCalculationAnswer(text, scale)).toBe(result);
  });

  it("includes the exact tolerance boundary without adding an epsilon", () => {
    const spec = { ...scale, tolerance: 0.5 };
    expect(evaluateCalculationAnswer("750,5", spec)).toBe("correct");
    expect(evaluateCalculationAnswer("749,5", spec)).toBe("correct");
    expect(evaluateCalculationAnswer("0,7505 km", spec)).toBe("correct");
    expect(evaluateCalculationAnswer("750,500000001", spec)).toBe("incorrect");
    expect(evaluateCalculationAnswer("749,499999999", spec)).toBe("incorrect");
  });

  it("checks the one-percent tolerance limit using the exact result", () => {
    expect(computeCalculationAnswer({ ...scale, tolerance: 7.5 }).answer).toBe("750 m");
    const fractional: CalculationSpec = { ...conversion, params: { value: 0.1, fromUnit: "m" }, tolerance: 0.001 };
    expect(evaluateCalculationAnswer("0,101", fractional)).toBe("correct");
    expect(() => computeCalculationAnswer({ ...fractional, tolerance: 0.001000000001 })).toThrow();
    const large: CalculationSpec = { ...scale, params: { mapDistanceCm: 999999.999, scaleDenominator: 999999999 }, tolerance: 99999999800.0000001 };
    // JS rounds this tolerance to 99999999800: below the exact 1% boundary.
    expect(evaluateCalculationAnswer("10099999979800,00001 m", large)).toBe("correct");
    expect(evaluateCalculationAnswer("10099999979800,000010001 m", large)).toBe("incorrect");
  });

  it.each([
    { ...scale, tolerance: 7.500000001 },
    { ...height, params: { upperHeightM: 0, lowerHeightM: 0 }, tolerance: 0.001 },
    { ...scale, params: { ...scale.params, scaleDenominator: 0 } },
    { ...height, params: { upperHeightM: -100, lowerHeightM: -50 } },
    { ...scale, extra: true },
  ])("validates persisted JSONB input in every spec-taking function: %j", (invalid) => {
    const spec = invalid as CalculationSpec;
    expect(() => computeCalculationAnswer(spec)).toThrow();
    expect(() => renderCalculationPrompt(spec)).toThrow();
    expect(() => evaluateCalculationAnswer("750", spec)).toThrow();
    expect(() => evaluateCalculationAnswer("unparseable", spec)).toThrow();
  });

  it("accepts zero with zero tolerance", () => {
    const zero = { ...height, params: { upperHeightM: -100, lowerHeightM: -100 }, tolerance: 0 };
    expect(computeCalculationAnswer(zero)).toEqual({ value: 0, unit: "m", answer: "0 m" });
    expect(evaluateCalculationAnswer("0 km", zero)).toBe("correct");
  });
});