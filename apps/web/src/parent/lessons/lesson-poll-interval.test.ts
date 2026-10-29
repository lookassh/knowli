import { describe, expect, it } from "vitest";
import type { LessonDeckDto } from "@learning/contracts";
import { lessonPollInterval } from "./LessonEditor";

type Version = NonNullable<LessonDeckDto["draft"]>;

function lesson(overrides: { generation?: LessonDeckDto["generation"]; draftAssets?: string[]; publishedAssets?: string[] }): LessonDeckDto {
  const version = (states: string[]) => ({ assets: states.map((state) => ({ state })) }) as unknown as Version;
  return {
    generation: overrides.generation ?? null,
    draft: overrides.draftAssets ? version(overrides.draftAssets) : null,
    published: overrides.publishedAssets ? version(overrides.publishedAssets) : null,
  } as unknown as LessonDeckDto;
}

describe("lessonPollInterval", () => {
  it("odpytuje co sekundę, gdy generowanie czeka albo trwa", () => {
    expect(lessonPollInterval(lesson({ generation: { state: "queued" } as LessonDeckDto["generation"] }))).toBe(1000);
    expect(lessonPollInterval(lesson({ generation: { state: "running" } as LessonDeckDto["generation"] }))).toBe(1000);
  });

  it("odpytuje, gdy media pokazanej wersji czekają (szkic przesłania opublikowaną)", () => {
    expect(lessonPollInterval(lesson({ draftAssets: ["approved", "pending"] }))).toBe(1000);
    expect(lessonPollInterval(lesson({ publishedAssets: ["pending"] }))).toBe(1000);
    expect(lessonPollInterval(lesson({ draftAssets: ["approved"], publishedAssets: ["pending"] }))).toBe(false);
  });

  it("nie odpytuje bez danych, po błędzie generowania ani gdy media są gotowe", () => {
    expect(lessonPollInterval(undefined)).toBe(false);
    expect(lessonPollInterval(lesson({ draftAssets: ["approved", "failed"] }))).toBe(false);
    expect(lessonPollInterval(lesson({ generation: { state: "failed" } as LessonDeckDto["generation"], draftAssets: ["approved"] }))).toBe(false);
  });
});
