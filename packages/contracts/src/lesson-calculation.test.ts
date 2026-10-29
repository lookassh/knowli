import { describe, expect, it } from "vitest";
import { CalculationSpecSchema } from "./index";

const scale = {
  kind: "scale_distance", params: { scaleDenominator: 25000, mapDistanceCm: 3 },
  unit: "m", templateFamilyId: "map-scale-1",
};

describe("CalculationSpecSchema", () => {
  it.each([
    scale,
    { kind: "height_difference", params: { upperHeightM: -50, lowerHeightM: -100 }, unit: "m", templateFamilyId: "height" },
    { kind: "unit_conversion", params: { value: 0.001, fromUnit: "km" }, unit: "m", templateFamilyId: "conversion", tolerance: 0 },
  ])("accepts the closed calculation shapes: $kind", (spec) => {
    expect(CalculationSpecSchema.parse(spec)).toEqual(spec);
  });

  it.each([
    { ...scale, kind: "unknown" },
    { ...scale, unit: "mm" },
    { ...scale, extra: true },
    { ...scale, params: { ...scale.params, extra: true } },
    { ...scale, params: { ...scale.params, scaleDenominator: 0 } },
    { ...scale, params: { ...scale.params, scaleDenominator: 1.5 } },
    { ...scale, params: { ...scale.params, scaleDenominator: 1000000001 } },
    { ...scale, params: { ...scale.params, mapDistanceCm: Infinity } },
    { ...scale, params: { ...scale.params, mapDistanceCm: NaN } },
    { ...scale, params: { ...scale.params, mapDistanceCm: -1 } },
    { ...scale, params: { ...scale.params, mapDistanceCm: 1000000.001 } },
    { ...scale, params: { ...scale.params, mapDistanceCm: 0.0001 } },
    { ...scale, tolerance: -0.1 },
    { ...scale, tolerance: Infinity },
    { ...scale, templateFamilyId: "Has spaces" },
    { ...scale, templateFamilyId: "a--b" },
    { ...scale, templateFamilyId: "valid-slug\n" },
    { ...scale, templateFamilyId: "a".repeat(65) },
    { ...scale, templateFamilyId: "" },
    { kind: "height_difference", params: { upperHeightM: 150, lowerHeightM: 400 }, unit: "m", templateFamilyId: "height" },
    { kind: "height_difference", params: { upperHeightM: 0, lowerHeightM: -1000001 }, unit: "m", templateFamilyId: "height" },
    { kind: "unit_conversion", params: { value: -1, fromUnit: "m" }, unit: "m", templateFamilyId: "conversion" },
    { kind: "unit_conversion", params: { value: 1, fromUnit: "mm" }, unit: "m", templateFamilyId: "conversion" },
  ])("rejects invalid local constraints: %j", (spec) => {
    expect(CalculationSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("leaves relational tolerance validation to the exact domain", () => {
    expect(CalculationSpecSchema.safeParse({ ...scale, tolerance: 7.500000001 }).success).toBe(true);
  });
});