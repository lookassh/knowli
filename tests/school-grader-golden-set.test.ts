import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Case { id: string; question: string; category: string; childAnswer: string; input?: string; pairOf?: string; disputed?: boolean; expected: { knowledge: string; precision: string } }
const golden = JSON.parse(readFileSync(new URL("./probes/fixtures/school-grader-golden-set.json", import.meta.url), "utf8")) as {
  gate: { hardCategoriesMustPass: string[] }; questions: Record<string, unknown>; cases: Case[];
};
const speech = golden.cases.filter((c) => c.input === "speech");
const written = golden.cases.filter((c) => c.input === undefined);
const SPEECH_CATEGORIES = [
  "mowa — wypełniacze", "mowa — restart zdania", "mowa — powtórzenia", "mowa — autokorekta faktu",
  "mowa — przekręcona nazwa lub termin", "mowa — dygresja nie na temat", "mowa — kilka zdań z pauz",
  "mowa — częściowa z wypełniaczami", "mowa — błąd rzeczowy z wypełniaczami", "mowa — słowa do otoczenia",
];

describe("school grader golden set — speech cases", () => {
  it("has at least 10 speech cases covering every speech category", () => {
    expect(speech.length).toBeGreaterThanOrEqual(10);
    for (const category of SPEECH_CATEGORIES) expect(speech.map((c) => c.category)).toContain(category);
  });
  it("pairs at least 5 speech cases with a written twin on the same question and expectation", () => {
    const paired = speech.filter((c) => c.pairOf !== undefined);
    expect(paired.length).toBeGreaterThanOrEqual(5);
    for (const c of paired) {
      const twin = written.find((w) => w.id === c.pairOf);
      expect(twin, c.id).toBeDefined();
      expect(twin!.question).toBe(c.question);
      expect(twin!.expected.knowledge).toBe(c.expected.knowledge);
      expect(twin!.expected.precision).toBe(c.expected.precision);
    }
  });
  it("keeps every case well-formed", () => {
    const ids = golden.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of golden.cases) {
      expect(golden.questions[c.question], c.id).toBeDefined();
      expect(["correct", "partial", "incorrect"]).toContain(c.expected.knowledge);
      expect(["concise", "verbose", "unfocused"]).toContain(c.expected.precision);
      expect([undefined, "speech"]).toContain(c.input);
      expect([...c.childAnswer].length, c.id).toBeLessThanOrEqual(600);
    }
    expect(written.every((c) => c.pairOf === undefined && c.disputed === undefined)).toBe(true);
  });
  it("keeps the 27 written cases and the gate untouched", () => {
    expect(written).toHaveLength(27);
    expect(golden.gate.hardCategoriesMustPass).toEqual(["błędna zależność mimo słów kluczowych", "istotny błąd rzeczowy"]);
    expect(speech.every((c) => !golden.gate.hardCategoriesMustPass.includes(c.category))).toBe(true);
  });
});
