import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clip,
  defineRules,
  describeRule,
  issueFrom,
  messagesOf,
  ruleOf,
  type LessonRule,
  type RuleId,
} from "./catalog";

const catalog = defineRules({
  "x.y": { field: "answer", kind: "reject", description: "Answer must be short." },
  "x.limit": {
    field: "options",
    kind: "reject",
    description: (ctx) => `Answer is at most ${ctx.answerMaxLength} characters.`,
  },
});
const issue = issueFrom(catalog);

describe("defineRules", () => {
  it.each(["Bad-Id", "single", "a..b", "a.", ".a", "a.B"])("rzuca dla id „%s”", (id) => {
    expect(() => defineRules({ [id]: { field: "answer", kind: "reject", description: "d" } })).toThrow(id);
  });

  it("przyjmuje id `obszar.nazwa` z cyframi i podkreśleniem", () => {
    expect(() =>
      defineRules({ "cloze.gap_count": { field: "clozeText", kind: "reject", description: "d" }, "a1.b2.c_3": { field: "x", kind: "internal", description: "", internalReason: "r" } }),
    ).not.toThrow();
  });
});

describe("issueFrom", () => {
  it("bierze `field` z wpisu reguły, gdy zgłoszenie go nie podaje", () => {
    expect(issue("x.y", { pl: "p" })).toEqual({ rule: "x.y", field: "answer", pl: "p" });
  });

  it("przenosi `field` i `found` zgłoszenia", () => {
    expect(issue("x.y", { field: "sourceRefs[1].quote", pl: "p", found: '"q"' })).toEqual({
      rule: "x.y",
      field: "sourceRefs[1].quote",
      pl: "p",
      found: '"q"',
    });
  });

  it("typy: tylko klucze katalogu, a `RuleId` nie powstaje z napisu", () => {
    // @ts-expect-error — reguły spoza katalogu nie da się zgłosić.
    expect(() => issue("x.missing", { pl: "p" })).toThrow("x.missing");
    // @ts-expect-error — `RuleId` powstaje wyłącznie w fabryce zgłoszeń.
    const forged: RuleId = "x.y";
    expect(forged).toBe("x.y");
  });
});

describe("clip", () => {
  it("zamienia nowe linie i tabulatory na spację i zwija spacje", () => {
    expect(clip("a\nb")).toBe('"a b"');
    expect(clip("a\r\n\tb  c", 120, { quote: false })).toBe("a b c");
  });

  it("przycina do 120 znaków treści z wielokropkiem, w cudzysłowie", () => {
    const clipped = clip("x".repeat(200));
    expect(clipped).toHaveLength(123);
    expect(clipped).toBe(`"${"x".repeat(120)}…"`);
  });

  it("własny limit bez cudzysłowu", () => {
    expect(clip("x".repeat(60), 40, { quote: false })).toHaveLength(41);
    expect(clip("x".repeat(40), 40, { quote: false })).toBe("x".repeat(40));
  });
});

describe("messagesOf", () => {
  it("zwraca komunikaty `pl` w kolejności zgłoszeń", () => {
    expect(messagesOf([issue("x.y", { pl: "pierwszy" }), issue("x.limit", { pl: "drugi" })])).toEqual([
      "pierwszy",
      "drugi",
    ]);
    expect(messagesOf([])).toEqual([]);
  });

  it("pomija komunikat identyczny z wcześniejszym, zachowując kolejność", () => {
    expect(
      messagesOf([
        issue("x.y", { pl: "wspólny" }),
        issue("x.limit", { pl: "inny" }),
        issue("x.limit", { pl: "wspólny" }),
      ]),
    ).toEqual(["wspólny", "inny"]);
  });
});

describe("ruleOf", () => {
  it("znajduje regułę przedmiotu i dokleja id", () => {
    const id = issue("x.y", { pl: "p" }).rule;
    expect(ruleOf({ rules: catalog }, id)).toEqual({ ...catalog["x.y"], id: "x.y" });
  });

  it("nieznana reguła → undefined", () => {
    const id = issue("x.y", { pl: "p" }).rule;
    expect(ruleOf({ rules: {} }, id)).toBeUndefined();
    expect(ruleOf({ rules: catalog }, "toString" as string as RuleId)).toBeUndefined();
  });
});

describe("describeRule", () => {
  const rule: LessonRule = catalog["x.limit"];

  it("funkcja opisu korzysta z `answerMaxLength` kontekstu", () => {
    expect(describeRule(rule, { answerMaxLength: 120, groundingRequired: false })).toBe(
      "Answer is at most 120 characters.",
    );
    expect(describeRule(rule, { answerMaxLength: 300, groundingRequired: true })).toBe(
      "Answer is at most 300 characters.",
    );
  });

  it("dokleja dopisek przedmiotu po spacji", () => {
    expect(describeRule(catalog["x.y"], { answerMaxLength: 120, groundingRequired: false }, "Change the room.")).toBe(
      "Answer must be short. Change the room.",
    );
  });
});

describe("katalogi silnika bez importu wartości z catalog.ts", () => {
  // `catalog.ts` importuje katalogi silnika do `ENGINE_CATALOGS`; import wartości
  // w drugą stronę byłby cyklem modułów (strefa martwa `const` przy ładowaniu).
  const dir = dirname(fileURLToPath(import.meta.url));
  const VALUE_IMPORT_OF_CATALOG = /^import\s+(?!type\b)[^;]*from\s+["']\.\/catalog["']/m;

  it.each(["core-rules.ts", "lesson-rules.ts", "limits.ts"])("%s", (file) => {
    expect(VALUE_IMPORT_OF_CATALOG.test(readFileSync(join(dir, file), "utf8"))).toBe(false);
  });

  it("regex wykrywa import wartości (dowód czułości)", () => {
    expect(VALUE_IMPORT_OF_CATALOG.test('import { defineRules } from "./catalog";')).toBe(true);
    expect(VALUE_IMPORT_OF_CATALOG.test('import type { RuleCatalog } from "./catalog";')).toBe(false);
  });
});
