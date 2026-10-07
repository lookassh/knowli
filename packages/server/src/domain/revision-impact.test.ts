import { describe, expect, it } from "vitest";
import {
  buildSkillCriteria,
  classifyRevisionImpact,
} from "./revision-impact";
import type { VocabularyItemInput } from "@learning/contracts";

function item(overrides: Partial<VocabularyItemInput> = {}): VocabularyItemInput {
  return {
    source: "czwartek",
    target: "Thursday",
    acceptedAnswers: [],
    locales: { source: "pl-PL", target: "en-GB" },
    visualType: "image",
    ...overrides,
  };
}

function asSortedArray(skills: Set<string>): string[] {
  return [...skills].sort();
}

const ALL_FIVE = ["listening", "pronunciation", "reading", "recall", "spelling"];
const MEANING_THREE = ["listening", "reading", "recall"];

describe("classifyRevisionImpact — jawna mapa wpływu", () => {
  it("zmiana wyłącznie ilustracji zachowuje skill_version", () => {
    const impact = classifyRevisionImpact(
      item({ visualType: "image", visualData: { prompt: "kalendarz" } }),
      item({ visualType: "color", visualData: { color: "#4169e1" } }),
    );
    expect(asSortedArray(impact)).toEqual([]);
  });

  it("zmiana przykładu zdania jest kosmetyczna", () => {
    const impact = classifyRevisionImpact(
      item({ example: "See you on Thursday." }),
      item({ example: "Thursday is my favourite day." }),
    );
    expect(asSortedArray(impact)).toEqual([]);
  });

  it("zmiana znaczenia (source) zmienia listening/reading/recall", () => {
    const impact = classifyRevisionImpact(item(), item({ source: "piątek" }));
    expect(asSortedArray(impact)).toEqual([...MEANING_THREE].sort());
  });

  it("zmiana target zmienia wszystkich pięć kluczy", () => {
    const impact = classifyRevisionImpact(item(), item({ target: "Friday" }));
    expect(asSortedArray(impact)).toEqual(ALL_FIVE);
  });

  it("zmiana zatwierdzonych wariantów zmienia wszystkich pięć kluczy (mapa jawna)", () => {
    const impact = classifyRevisionImpact(
      item(),
      item({ acceptedAnswers: ["Thur." ] }),
    );
    expect(asSortedArray(impact)).toEqual(ALL_FIVE);
  });

  it("zmiana locale wpływa na wszystkie umiejętności", () => {
    const impact = classifyRevisionImpact(
      item(),
      item({ locales: { source: "pl-PL", target: "en-US" } }),
    );
    expect(asSortedArray(impact)).toEqual(ALL_FIVE);
  });

  it("identyczna treść nie zmienia żadnego klucza", () => {
    const impact = classifyRevisionImpact(item(), item());
    expect(asSortedArray(impact)).toEqual([]);
  });
});

describe("buildSkillCriteria", () => {
  it("kryteria zależą od pól właściwych umiejętności", () => {
    const { criteria } = buildSkillCriteria(item(), "recall");
    expect(criteria).toMatchObject({
      kind: "recall-v1",
      source: "czwartek",
      target: "Thursday",
      acceptedAnswers: [],
    });
  });

  it("kryteria są stabilne dla tej samej treści (powtarzalny hash)", () => {
    const a = buildSkillCriteria(item(), "spelling");
    const b = buildSkillCriteria(item(), "spelling");
    expect(a.criteriaHash).toBe(b.criteriaHash);
    expect(a.criteriaHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("kryterium pronunciation nie zależy od source (wymowa dotyczy angielskiego słowa)", () => {
    const a = buildSkillCriteria(item(), "pronunciation");
    const b = buildSkillCriteria(item({ source: "piątek" }), "pronunciation");
    expect(a.criteriaHash).toBe(b.criteriaHash);
  });

  it("kryterium listening zależy od source — zmiana znaczenia to nowy klucz", () => {
    const a = buildSkillCriteria(item(), "listening");
    const b = buildSkillCriteria(item({ source: "piątek" }), "listening");
    expect(a.criteriaHash).not.toBe(b.criteriaHash);
  });
});
