"use client";

import { Anchor, Group, Stack, Text } from "@mantine/core";
import { messages, type LessonDeckSourceDto } from "@learning/contracts";
import { ParentIcon } from "../ParentIcon";
import { routePath } from "../parent-routes";
import { plainClick } from "../plain-click";

/**
 * Pochodzenie lekcji ze źródła (design 2026-10-30 §3.4): „Ze źródła: <tytuł>”
 * z linkiem do strony źródła, a gdy tekst źródła zmieniono po utworzeniu
 * zestawu (rewizje treści, nie sam tytuł) — notka. Lekcja ma własną kopię
 * tekstu; zmiana źródła jej nie zmienia.
 */
export default function LessonSourceNote({ source, onOpen }: { source: LessonDeckSourceDto; onOpen: (sourceId: string) => void }) {
  const changed = source.currentRevision > source.copiedRevision;
  return (
    <Stack gap={4} mb="md" data-testid="lesson-source-note">
      <Anchor
        href={routePath({ section: "sources", sourceId: source.id })}
        size="sm"
        className="pp-lesson-source-link"
        data-testid="lesson-source-link"
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          onOpen(source.id);
        }}
      >
        <ParentIcon name="file-text" />
        {messages.sources.fromSource.replace("{title}", source.title)}
      </Anchor>
      {changed && (
        <Group gap={6} wrap="nowrap" align="flex-start" className="pp-editor-muted" data-testid="lesson-source-changed">
          <ParentIcon name="info" className="pp-lesson-source-info" />
          <Text size="sm">{messages.sources.sourceChanged}</Text>
        </Group>
      )}
    </Stack>
  );
}
