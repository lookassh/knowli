import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorkCardPanel from "./WorkCardPanel";

describe("WorkCardPanel", () => {
  it("shows the child and date filters and a neutral no-children state", () => {
    const child = { id: "00000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "fox", birthYear: 2018,
      canRead: true, recordingMode: "hold" as const, pronunciation: null };
    const markup = renderToStaticMarkup(createElement(WorkCardPanel, { childrenList: [child], onAuthExpired: () => undefined }));
    expect(markup).toContain("Ola");
    expect(markup).toContain('type="date"');
    expect(markup).toContain("Dzień");
    expect(renderToStaticMarkup(createElement(WorkCardPanel, { childrenList: [], onAuthExpired: () => undefined }))).toContain("Nie masz jeszcze profili dzieci.");
  });
});
