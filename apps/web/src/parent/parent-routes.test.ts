import { describe, expect, it } from "vitest";
import { sectionFromPath, sectionPath } from "./parent-routes";

describe("parent routes", () => {
  it("reads the section from its address", () => {
    expect(sectionFromPath("/parent/decks")).toBe("decks");
    expect(sectionFromPath("/parent/children/")).toBe("children");
    expect(sectionFromPath("/parent/progress")).toBe("progress");
    expect(sectionFromPath("/parent/work-card")).toBe("work-card");
  });

  it("has no section for the panel root and unknown addresses", () => {
    expect(sectionFromPath("/parent")).toBeNull();
    expect(sectionFromPath("/parent/")).toBeNull();
    expect(sectionFromPath("/parent/unknown")).toBeNull();
    expect(sectionFromPath("/parent/decks/extra")).toBeNull();
    expect(sectionFromPath("/kids/x/learn")).toBeNull();
  });

  it("round-trips every section", () => {
    for (const section of ["decks", "children", "progress", "work-card"] as const) {
      expect(sectionFromPath(sectionPath(section))).toBe(section);
    }
  });
});
