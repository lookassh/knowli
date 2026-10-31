"use client";

import { Anchor, Group, Stack, Text } from "@mantine/core";
import { messages, type DeckSourceDto } from "@learning/contracts";
import { ParentIcon } from "../ParentIcon";
import { routePath } from "../parent-routes";
import { plainClick } from "../plain-click";
import "./lesson-panels.css";

/**
 * Pochodzenie zestawu ze źródła (design 2026-10-30 §3.4, §6.2) — lekcji albo
 * zestawu słówek: „Ze źródła: <tytuł>” z linkiem do strony źródła, a gdy tekst
 * źródła zmieniono po utworzeniu zestawu (rewizje treści, nie sam tytuł) —
 * notka. Zestaw ma własną kopię tekstu (lekcja) albo słów (słówka); zmiana
 * źródła go nie zmienia.
 */
export default function LessonSourceNote({ source, onOpen }: { source: DeckSourceDto; onOpen: (sourceId: string) => void }) {
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
