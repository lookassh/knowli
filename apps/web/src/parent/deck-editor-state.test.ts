import { describe, expect, it } from "vitest";
import type { DraftDto } from "@learning/contracts";
import { compareEditorForms, createEditorSnapshot, toDraftPatch } from "./deck-editor-state";

function draft(editNumber = 3): DraftDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    deckId: "00000000-0000-4000-8000-000000000002",
    editNumber,
    status: "draft",
    title: "Dni tygodnia",
    items: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        revisionId: "00000000-0000-4000-8000-000000000021",
        source: "poniedziałek",
        target: "Monday",
        acceptedAnswers: ["Mon"],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "sequence",
        visualData: { position: 1, total: 7, sequenceStart: "Monday" },
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        revisionId: "00000000-0000-4000-8000-000000000022",
        source: "wtorek",
        target: "Tuesday",
        acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "sequence",
        visualData: { position: 2, total: 7, sequenceStart: "Monday" },
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        revisionId: "00000000-0000-4000-8000-000000000023",
        source: "środa",
        target: "Wednesday",
        acceptedAnswers: [],
        locales: { source: "pl-PL", target: "en-GB" },
        visualType: "sequence",
        visualData: { position: 3, total: 7, sequenceStart: "Monday" },
      },
    ],
    assets: [],
  };
}

describe("editor snapshot and draft patch", () => {
  it("keeps the edit number and IDs from the original form after a remote refresh", () => {
    const snapshot = createEditorSnapshot(draft(3), () => "unused");
    const remote = draft(4);
    expect(remote.editNumber).toBe(4);
    expect(toDraftPatch(snapshot).expectedEditNumber).toBe(3);
  });

  it("keeps item identity and visual data when the middle item is removed", () => {
    const snapshot = createEditorSnapshot(draft(), () => "unused");
    const afterRemoval = { ...snapshot, form: { ...snapshot.form, items: [snapshot.form.items[0]!, snapshot.form.items[2]!] } };
    const patch = toDraftPatch(afterRemoval);
    expect(patch.items?.map((item) => item.id)).toEqual([
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000013",
    ]);
    expect(patch.items?.map((item) => item.visualData)).toEqual([
      { position: 1, total: 7, sequenceStart: "Monday" },
      { position: 3, total: 7, sequenceStart: "Monday" },
    ]);
  });

  it("assigns distinct local keys to new items without sending those keys to the API", () => {
    const snapshot = createEditorSnapshot(draft(), (() => {
      let count = 0;
      return () => `new-${++count}`;
    })());
    snapshot.form.items.push(
      { clientKey: "local:new-1", source: "czwartek", target: "Thursday", accepted: "", example: "", visualType: "none", locales: { source: "pl-PL", target: "en-GB" } },
      { clientKey: "local:new-2", source: "piątek", target: "Friday", accepted: "", example: "", visualType: "none", locales: { source: "pl-PL", target: "en-GB" } },
    );
    expect(snapshot.form.items[3]!.clientKey).not.toBe(snapshot.form.items[4]!.clientKey);
    const newItems = toDraftPatch(snapshot).items!.slice(-2);
    expect(newItems.every((item) => !("clientKey" in item))).toBe(true);
    expect(newItems.every((item) => item.id === undefined)).toBe(true);
  });

  it("does not send an invalid empty items array for an empty draft", () => {
    const snapshot = createEditorSnapshot({ ...draft(), items: [] }, () => "unused");
    expect(toDraftPatch(snapshot).items).toBeUndefined();
  });
});

describe("editor form comparison", () => {
  it("matches existing cards by ID after reorder and keeps removed/new cards distinct", () => {
    const local = createEditorSnapshot(draft(), () => "unused").form;
    local.items = [
      local.items[2]!,
      { clientKey: "local:new-1", source: "czwartek", target: "Thursday", accepted: "", example: "", visualType: "none", locales: { source: "pl-PL", target: "en-GB" } },
      { clientKey: "local:new-2", source: "piątek", target: "Friday", accepted: "", example: "", visualType: "none", locales: { source: "pl-PL", target: "en-GB" } },
    ];
    const remote = createEditorSnapshot(draft(), () => "unused").form;
    const comparison = compareEditorForms(local, remote);

    const removed = comparison.rows.find((row) => row.key === "00000000-0000-4000-8000-000000000012");
    expect(removed?.local).toBeNull();
    expect(removed?.remote?.source).toBe("wtorek");
    const moved = comparison.rows.find((row) => row.key === "00000000-0000-4000-8000-000000000013");
    expect(moved?.local?.target).toBe("Wednesday");
    expect(moved?.remote?.target).toBe("Wednesday");
    expect(comparison.rows.filter((row) => row.key.startsWith("local:")).map((row) => row.key)).toEqual([
      "local:new-1",
      "local:new-2",
    ]);
  });
});
