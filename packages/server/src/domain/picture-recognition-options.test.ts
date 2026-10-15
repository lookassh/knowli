import { describe, expect, it } from "vitest";
import * as server from "../index";

const api = server as unknown as Record<string, (input: Record<string, unknown>) => unknown>;
const red = { itemRevisionId: "00000000-0000-4000-8000-000000000001", position: 0, source: "czerwony", target: "red", targetLocale: "en-GB", acceptedAnswers: ["scarlet"], visual: { kind: "color", color: "#ff0000" } };
const blue = { itemRevisionId: "00000000-0000-4000-8000-000000000002", position: 1, source: "niebieski", target: "blue", targetLocale: "en-GB", acceptedAnswers: [], visual: { kind: "color", color: "#0000ff" } };
const cat = { itemRevisionId: "00000000-0000-4000-8000-000000000003", position: 2, source: "kot", target: "cat", targetLocale: "en-GB", acceptedAnswers: [], visual: { kind: "image", imageAssetId: "00000000-0000-4000-8000-000000000103" } };

describe("bezpieczne opcje rozpoznawania obrazków", () => {
  it("tworzy 2–3 rozróżnialne wizualnie opcje i nie ujawnia angielskiego celu", () => {
    expect(api.buildPictureRecognitionOptions).toBeTypeOf("function");
    const result = api.buildPictureRecognitionOptions({ target: red, peers: [blue, cat], reservedTargetKeys: [], rotateBy: 0 }) as { options: Array<Record<string, unknown>>; revealsTargetKeys: string[] };
    expect(result.options).toHaveLength(3);
    expect(result.options.filter((option) => option.correct)).toHaveLength(1);
    expect(result.options.map((option) => option.text)).toEqual(["czerwony", "niebieski", "kot"]);
    expect(result.options.map((option) => option.visual)).toEqual([red.visual, blue.visual, cat.visual]);
    expect(result.options.flatMap((option) => Object.keys(option))).not.toContain("target");
    expect(result.options.flatMap((option) => Object.keys(option))).not.toContain("answerKey");
    expect(result.revealsTargetKeys).toHaveLength(4);
  });

  it("wyklucza rezerwacje oraz kolizje semantycznych odpowiedzi i wizualizacji", () => {
    const result = api.buildPictureRecognitionOptions({
      target: red,
      peers: [
        { ...blue, acceptedAnswers: ["red"] },
        { ...cat, visual: red.visual },
      ],
      reservedTargetKeys: ["blue"],
      rotateBy: 0,
    });
    expect(result).toBeNull();
  });
});
