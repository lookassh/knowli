import { CalculationSpecSchema, type CalculationSpec, type LengthUnit } from "@learning/contracts";

/** Exact decimal fractions are private: no bigint crosses the JSON boundary. */
type Fraction = { numerator: bigint; denominator: bigint };
const CENTIMETERS: Record<LengthUnit, bigint> = { cm: 1n, m: 100n, km: 100000n };

function decimalFraction(text: string): Fraction {
  const [coefficient, exponent = "0"] = text.toLowerCase().split("e");
  const [integer, decimal = ""] = coefficient.split(".");
  const numerator = BigInt(integer + decimal);
  const places = decimal.length - Number(exponent);
  return places >= 0
    ? { numerator, denominator: 10n ** BigInt(places) }
    : { numerator: numerator * 10n ** BigInt(-places), denominator: 1n };
}

function fromNumber(value: number): Fraction {
  return decimalFraction(String(value));
}

function convert(value: Fraction, from: LengthUnit, to: LengthUnit): Fraction {
  return {
    numerator: value.numerator * CENTIMETERS[from],
    denominator: value.denominator * CENTIMETERS[to],
  };
}

function subtract(left: Fraction, right: Fraction): Fraction {
  return {
    numerator: left.numerator * right.denominator - right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function withinTolerance(difference: Fraction, tolerance: Fraction): boolean {
  return absolute(difference.numerator) * tolerance.denominator
    <= tolerance.numerator * difference.denominator;
}

/** All denominators come from decimals and cm/m/km, so decimal expansion terminates. */
function formatFraction(value: Fraction): string {
  const numerator = absolute(value.numerator);
  const integer = numerator / value.denominator;
  let remainder = numerator % value.denominator;
  let decimal = "";
  while (remainder !== 0n) {
    remainder *= 10n;
    decimal += String(remainder / value.denominator);
    remainder %= value.denominator;
  }
  return `${value.numerator < 0n ? "-" : ""}${integer}${decimal ? `,${decimal}` : ""}`;
}

function computeExact(spec: CalculationSpec): Fraction {
  switch (spec.kind) {
    case "scale_distance": {
      const distance = fromNumber(spec.params.mapDistanceCm);
      return convert({
        numerator: distance.numerator * BigInt(spec.params.scaleDenominator),
        denominator: distance.denominator,
      }, "cm", spec.unit);
    }
    case "height_difference":
      return convert(subtract(fromNumber(spec.params.upperHeightM), fromNumber(spec.params.lowerHeightM)), "m", spec.unit);
    case "unit_conversion":
      return convert(fromNumber(spec.params.value), spec.params.fromUnit, spec.unit);
  }
}

function validatedCalculation(input: CalculationSpec): { spec: CalculationSpec; result: Fraction; tolerance: Fraction } {
  const spec = CalculationSpecSchema.parse(input);
  const result = computeExact(spec);
  const tolerance = fromNumber(spec.tolerance ?? 0);
  // tolerance <= abs(result) / 100, compared without rounding either side.
  if (tolerance.numerator * result.denominator * 100n > absolute(result.numerator) * tolerance.denominator) {
    throw new Error("Tolerancja nie może przekraczać 1% wartości bezwzględnej wyniku.");
  }
  return { spec, result, tolerance };
}

export function computeCalculationAnswer(spec: CalculationSpec): { value: number; unit: LengthUnit; answer: string } {
  const { spec: validated, result } = validatedCalculation(spec);
  const exactText = formatFraction(result);
  return {
    // Approximation for JSON consumers only; formatting and evaluation use result.
    value: Number(exactText.replace(",", ".")),
    unit: validated.unit,
    answer: `${exactText} ${validated.unit}`,
  };
}

export function renderCalculationPrompt(input: CalculationSpec): string {
  const { spec } = validatedCalculation(input);
  const format = (value: number) => formatFraction(fromNumber(value));
  switch (spec.kind) {
    case "scale_distance": {
      const denominator = String(spec.params.scaleDenominator).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      return `Na mapie w skali 1:${denominator} odcinek ma ${format(spec.params.mapDistanceCm)} cm. Oblicz odległość w terenie w ${spec.unit}.`;
    }
    case "height_difference":
      return `Punkt wyższy: ${format(spec.params.upperHeightM)} m n.p.m., punkt niższy: ${format(spec.params.lowerHeightM)} m n.p.m. Oblicz różnicę wysokości w ${spec.unit}.`;
    case "unit_conversion":
      return `Przelicz ${format(spec.params.value)} ${spec.params.fromUnit} na ${spec.unit}.`;
  }
}

/** Unit symbol or its Polish word form (metr, metry, metr\u00f3w, metra\u2026). */
const UNIT_PATTERN = "cm|centymetr(?:a|y|\u00f3w)?|km|kilometr(?:a|y|\u00f3w)?|m|metr(?:a|y|\u00f3w)?";
// Only the listed spaces can group digits. No partial parsing, decimal dot,
// exponent or free-form explanation is accepted as a numeric answer. Accepted
// school notation around the number: a typographic minus, "m n.p.m." (copied
// from height prompts) and one closing period, as in "750 m.".
const ANSWER_PATTERN = new RegExp(
  "^([+\\-\\u2212]?(?:[0-9]{1,3}(?:[ \\u00a0\\u202f][0-9]{3})+|[0-9]+)(?:,[0-9]{1,9})?)" +
    `[ \\u00a0\\u202f]*(?:(${UNIT_PATTERN})(?:[ \\u00a0\\u202f]*n\\.?[ \\u00a0\\u202f]*p\\.?[ \\u00a0\\u202f]*m)?)?` +
    "[ \\u00a0\\u202f]*\\.?$",
  "iu",
);

function unitOf(token: string | undefined): LengthUnit | null {
  if (token === undefined) return null;
  const lower = token.toLowerCase();
  if (lower.startsWith("c")) return "cm";
  if (lower.startsWith("k")) return "km";
  return "m";
}

function parseExactAnswer(text: string): { value: Fraction; unit: LengthUnit | null } | null {
  const match = ANSWER_PATTERN.exec(text.trim());
  if (!match) return null;
  const numberText = match[1].replace(/[ \u00a0\u202f]/g, "").replace("\u2212", "-").replace(",", ".");
  if (!Number.isFinite(Number(numberText))) return null;
  return { value: decimalFraction(numberText), unit: unitOf(match[2]) };
}

export function parseCalculationAnswer(text: string): { value: number; unit: LengthUnit | null } | null {
  const parsed = parseExactAnswer(text);
  return parsed ? { value: Number(formatFraction(parsed.value).replace(",", ".")), unit: parsed.unit } : null;
}

export function evaluateCalculationAnswer(text: string, input: CalculationSpec): "correct" | "incorrect" | "unevaluated" {
  const { spec, result, tolerance } = validatedCalculation(input);
  const parsed = parseExactAnswer(text);
  if (!parsed) return "unevaluated";
  const candidate = convert(parsed.value, parsed.unit ?? spec.unit, spec.unit);
  return withinTolerance(subtract(candidate, result), tolerance) ? "correct" : "incorrect";
}