import { describe, expect, it, vi } from "vitest";
import { messages } from "@learning/contracts";
import LessonSourceNote from "./LessonSourceNote";
import { renderParentMarkup } from "../test-render";

const SOURCE_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("LessonSourceNote", () => {
  it("pokazuje źródło z linkiem do jego strony", () => {
    const markup = renderParentMarkup(
      <LessonSourceNote source={{ id: SOURCE_ID, title: "Unit 3 — Food", copiedRevision: 2, currentRevision: 2 }} onOpen={vi.fn()} />,
    );
    expect(markup).toContain('data-testid="lesson-source-link"');
    expect(markup).toContain(`href="/parent/sources/${SOURCE_ID}"`);
    expect(markup).toContain(messages.sources.fromSource.replace("{title}", "Unit 3 — Food"));
    expect(markup).not.toContain('data-testid="lesson-source-changed"');
    expect(markup).not.toContain(messages.sources.sourceChanged);
  });

  it("tytuł z `$&` i `$$` wstawiony dosłownie (nie jako wzorzec zamiany)", () => {
    const markup = renderParentMarkup(
      <LessonSourceNote source={{ id: SOURCE_ID, title: "Ceny $& rabaty $$ 5", copiedRevision: 2, currentRevision: 2 }} onOpen={vi.fn()} />,
    );
    // statyczny HTML koduje `&` jako `&amp;`
    expect(markup).toContain("Ze źródła: Ceny $&amp; rabaty $$ 5");
    expect(markup).not.toContain("{title}");
  });

  it("gdy źródło zmieniono po utworzeniu zestawu — notka o zmianie", () => {
    const markup = renderParentMarkup(
      <LessonSourceNote source={{ id: SOURCE_ID, title: "Unit 3", copiedRevision: 1, currentRevision: 3 }} onOpen={vi.fn()} />,
    );
    expect(markup).toContain('data-testid="lesson-source-changed"');
    expect(markup).toContain(messages.sources.sourceChanged);
  });
});
