"use client";

import { Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { messages } from "@learning/contracts";
import { orpc } from "./query-client";
import "./deck-editor.css";

/**
 * Do jakiej usługi trafia opis rodzica przy generowaniu zestawu słówek (#395) — jak
 * `serviceInfo.generation` w formularzu lekcji. Słówka generuje `UMIEM_LLM`, więc etykietą
 * jest katalogowe `generationService`; bez niego (albo przed wczytaniem katalogu) nic nie pokazujemy.
 */
export default function DeckGenerationServiceNote() {
  const service = useQuery(orpc.lessonCatalog.get.queryOptions()).data?.generationService;
  if (!service) return null;
  return (
    <Text size="sm" className="pp-editor-muted" data-testid="deck-generation-service">
      {messages.decks.generationServiceInfo.replace("{service}", () => service)}
    </Text>
  );
}
