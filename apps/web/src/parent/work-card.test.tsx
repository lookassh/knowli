import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkCardPanel from "./WorkCardPanel";

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MantineProvider, null, element)),
  );
}

describe("WorkCardPanel", () => {
  it("shows the child and date filters and a neutral no-children state", () => {
    const child = { id: "00000000-0000-4000-8000-000000000001", displayName: "Ola", avatarKey: "fox", birthYear: 2018,
      canRead: true, recordingMode: "hold" as const, pronunciation: null };
    const markup = render(createElement(WorkCardPanel, { childrenList: [child] }));
    expect(markup).toContain("Ola");
    expect(markup).toContain('type="date"');
    expect(markup).toContain("Dzień");
    expect(render(createElement(WorkCardPanel, { childrenList: [] }))).toContain("Nie masz jeszcze profili dzieci.");
  });
});
